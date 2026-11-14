/**
 * Document pipeline: pages → Claude (vision) → draft questions.
 *
 *   1. Load the stored files.
 *   2. Turn them into model inputs: photos are auto-rotated and downsized, PDFs go in
 *      whole as document blocks, DOCX is converted to text.
 *   3. Pass 1, per page: question number, text, options, answer if printed, diagram flag,
 *      and any answer key printed in the document (often on the last page).
 *   4. Answer key file, if one was attached. Keys are matched to options once every
 *      question is read, so an answer can be a letter, a roman numeral, a number or the option's text.
 *   5. Pass 2, in batches of 10: explanation, trap, worked steps, topic, difficulty,
 *      a proposed answer where none was given, and a confidence score.
 *   6. Validate (option count, continuous numbering, empty fields) and detect repeats.
 *   7. Write drafts + a draft paper; the upload moves to "in review".
 *
 * Runs in the background inside the API process (no queue). The daily job retries
 * anything stuck in "processing" for over an hour.
 *
 * Without ANTHROPIC_API_KEY (or with EXTRACTOR=local), steps 3–5 use the built-in parser in
 * parse-paper.ts instead: typed DOCX/TXT/PDF only, no explanations or topics drafted.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import sharp from "sharp";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { claude, MODEL } from "../lib/claude";
import { getObject } from "../lib/storage";
import { parseAnswerKey, parsePaper, resolveAnswer } from "./parse-paper";
import { docxText } from "./docx-text";
import { LETTERS } from "@/shared/game";

const { uploads, questions, papers, paperQuestions, topics, courses } = schema;

const TOTAL_STEPS = 6;
const MAX_IMAGE_EDGE = 2000;

/* ───────────── Schemas the model must return ───────────── */

const PageExtraction = z.object({
  questions: z.array(
    z.object({
      number: z.number().int().describe("Question number as printed on the paper"),
      page: z.number().int().describe("1-based page the question starts on"),
      text: z.string().describe("Question stem, verbatim. Use LaTeX between $...$ for maths."),
      options: z
        .array(z.string())
        .describe("Option texts in printed order, without their markers (A., (a), i., 1., bullets or none). The first option is A"),
      printed_answer: z
        .string()
        .nullable()
        .describe("Letter of the correct option by position (first option = A) if the paper marks it next to the question: an Answer line, an asterisk, tick, bold, underline or circle on one option. Else null"),
      has_diagram: z.boolean(),
      box: z
        .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
        .nullable()
        .describe("Where the question and its options sit on the page, as fractions of page width/height (0 to 1) from the top-left. Null if unsure."),
      issues: z.array(z.string()).describe("Short notes on anything unreadable, smudged, cut off or split across pages"),
      confidence: z.number().describe("0 to 1: how sure you are the text and options were read correctly"),
    }),
  ),
  answer_key: z
    .array(z.object({ number: z.number().int(), answer: z.string().describe("As printed: a letter, roman numeral, number or the answer's text") }))
    .describe("Every entry of an answer key, answer list or marking scheme printed anywhere in this input, often on the last page or after the questions. Empty if there is none"),
  page_issues: z.array(z.object({ page: z.number().int(), issue: z.string() })),
});
type ExtractedQuestion = z.infer<typeof PageExtraction>["questions"][number];

const AnswerKey = z.object({
  answers: z.array(z.object({ number: z.number().int(), letter: z.string().describe("As printed: a letter, roman numeral, number or the answer's text") })),
});

const Enrichment = z.object({
  items: z.array(
    z.object({
      number: z.number().int(),
      proposed_answer: z.string().describe("The correct option letter"),
      answer_confidence: z.number().describe("0 to 1"),
      explanation: z.string().describe("3 to 6 plain sentences on why the answer is right"),
      trap: z.string().nullable().describe("One line on why the most tempting wrong option is wrong, or null"),
      worked_steps: z.array(z.string()).nullable().describe("Numbered working for calculation questions, else null"),
      topic: z.string().describe("Best topic from the list; a new short topic name only if none fit"),
      difficulty: z.enum(["easy", "medium", "hard"]),
    }),
  ),
});

/* ───────────── Inputs ───────────── */

type Input =
  | { kind: "image"; page: number; block: Anthropic.ImageBlockParam }
  | { kind: "pdf"; block: Anthropic.DocumentBlockParam; bytes: Buffer }
  | { kind: "text"; page: number; text: string };

async function toInputs(files: { path: string; mime: string; name: string }[]): Promise<Input[]> {
  const out: Input[] = [];
  let page = 1;
  for (const f of files) {
    const bytes = await getObject(env.STORAGE_BUCKET_UPLOADS, f.path);
    if (f.mime === "application/pdf") {
      out.push({
        kind: "pdf",
        block: { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } },
        bytes,
      });
    } else if (f.mime.includes("wordprocessingml") || f.name.endsWith(".docx")) {
      out.push({ kind: "text", page: page++, text: await docxText(bytes) });
    } else if (f.mime.startsWith("image/")) {
      const jpeg = await sharp(bytes)
        .rotate() // honour EXIF orientation from phone cameras
        .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      out.push({
        kind: "image",
        page: page++,
        block: { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
      });
    } else if (f.mime === "text/plain") {
      out.push({ kind: "text", page: page++, text: bytes.toString("utf8") });
    }
  }
  return out;
}

/* ───────────── Model calls ───────────── */

const EXTRACT_SYSTEM = `You transcribe Nigerian university past-question papers (CBT multiple choice) into structured data.
Copy question stems and options exactly as printed: keep the wording, fix nothing, invent nothing.
If a word or option can't be read, give your best reading and say so in "issues"; never silently guess.
Lecturers mark options in many ways: A–E, (a)–(e), i–iv, 1–4, bullets, dashes, or no marker at all (one option per line).
Return the options in printed order with the markers removed; the first option is A whatever its printed marker was.
Statements numbered i, ii, iii inside a question ("Which of these are true? i. … ii. …") belong to the question text, not the options, when lettered options follow; keep them on separate lines.
Answers can sit under each question ("Answer: B", "Ans – (c)"), be marked on an option (asterisk, tick, bold, underline, circled), or be gathered in an answer key or marking scheme, usually at the end of the document. Look for all of them. Put marks next to a question in printed_answer and every key entry in answer_key.
In text input, **double asterisks** mean bold or underlined in the original document.
Write mathematical notation as LaTeX between $...$.
Skip headers, instructions and anything that isn't a numbered question.`;

async function runParse<T extends z.ZodType>(schemaDef: T, system: string, content: Anthropic.ContentBlockParam[]) {
  const stream = claude().messages.stream({
    model: MODEL,
    max_tokens: 64000,
    system,
    output_config: { effort: "high", format: zodOutputFormat(schemaDef) },
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined this page");
  if (msg.stop_reason === "max_tokens") throw new Error("The page produced too much output to read in one go");
  if (!msg.parsed_output) throw new Error("The model returned no structured output");
  return msg.parsed_output as z.infer<T>;
}

async function extractInput(input: Input, optionCount: number) {
  const hint = `Papers in this course use ${optionCount} options (A–${LETTERS[optionCount - 1]}).`;
  if (input.kind === "pdf") {
    return runParse(PageExtraction, EXTRACT_SYSTEM, [
      input.block,
      { type: "text", text: `${hint} Extract every question in this PDF. Use the PDF's own page numbers.` },
    ]);
  }
  if (input.kind === "image") {
    const r = await runParse(PageExtraction, EXTRACT_SYSTEM, [
      input.block,
      { type: "text", text: `${hint} This photo is page ${input.page}. Extract every question on it.` },
    ]);
    r.questions.forEach((q) => (q.page = input.page));
    return r;
  }
  return runParse(PageExtraction, EXTRACT_SYSTEM, [
    { type: "text", text: `${hint} The paper's text (page ${input.page}):\n\n${input.text}` },
  ]);
}

/** Run async jobs with a small concurrency limit so a 10-page upload doesn't hit rate limits. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = { status: "fulfilled", value: await fn(items[i], i) };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

const letterToIndex = (l: string | null | undefined) => {
  if (!l) return null;
  const i = LETTERS.indexOf(l.trim().toUpperCase().replace(/[^A-E]/g, "") as (typeof LETTERS)[number]);
  return i >= 0 ? i : null;
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* ───────────── Built-in parser (no API key) ───────────── */

/** Text of each PDF page, or [] for a scanned PDF with no text layer. */
async function pdfPages(bytes: Buffer): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.some((t) => t.trim().length > 20) ? text : [];
}

const NEEDS_KEY = "Photos and scanned PDFs need AI reading. Add ANTHROPIC_API_KEY to .env.local, or upload the typed DOCX/PDF.";

/** Pass 1 without Claude. Returns the same shape the model would. */
async function extractLocal(input: Input, optionCount: number): Promise<z.infer<typeof PageExtraction> & { explanations: Map<number, string> }> {
  let pages: string[];
  let first = 1;
  if (input.kind === "image") throw new Error(NEEDS_KEY);
  if (input.kind === "pdf") {
    pages = await pdfPages(input.bytes);
    if (!pages.length) throw new Error(`This PDF is a scan with no text in it. ${NEEDS_KEY}`);
  } else {
    pages = [input.text];
    first = input.page;
  }
  const { questions: parsed, key } = parsePaper(pages, optionCount);
  const explanations = new Map(parsed.filter((q) => q.explanation).map((q) => [q.number, q.explanation!]));
  return {
    questions: parsed.map((q) => ({
      number: q.number,
      page: input.kind === "pdf" ? q.page : first,
      text: q.text,
      options: q.options,
      printed_answer: q.answer != null ? LETTERS[q.answer] : null,
      // "figure of speech" is common in English papers, so only "figure 2", "fig. 3", diagrams and graphs count.
      has_diagram: /\b(diagram|graph|figure\s*\d|fig\.\s*\d|shown below|the image|the figure (?:above|below))\b/i.test(q.text),
      box: null,
      issues: q.issues,
      confidence: q.issues.length ? 0.6 : 0.9,
    })),
    answer_key: [...key].map(([number, answer]) => ({ number, answer })),
    page_issues: [],
    explanations,
  };
}

/** Answer-key file without Claude. */
async function readKeyLocal(file: { path: string; mime: string; name: string }) {
  const [inp] = await toInputs([file]);
  if (inp.kind === "image") throw new Error(NEEDS_KEY);
  const text = inp.kind === "pdf" ? (await pdfPages(inp.bytes)).join("\n") : inp.text;
  return parseAnswerKey(text);
}

/* ───────────── Pipeline ───────────── */

async function progress(uploadId: string, step: number, label: string, logLine?: string) {
  await db
    .update(uploads)
    .set({
      progress: { step, total: TOTAL_STEPS, label },
      updatedAt: new Date(),
      ...(logLine ? { log: sql`${uploads.log} || ${JSON.stringify([logLine])}::jsonb` } : {}),
    })
    .where(eq(uploads.id, uploadId));
}

async function log(uploadId: string, line: string) {
  await db
    .update(uploads)
    .set({ log: sql`${uploads.log} || ${JSON.stringify([line])}::jsonb`, updatedAt: new Date() })
    .where(eq(uploads.id, uploadId));
}

/** Fire-and-forget entry point used by POST /admin/uploads. */
export function startExtraction(uploadId: string) {
  void runExtraction(uploadId).catch(async (err) => {
    console.error("[extraction]", uploadId, err);
    await db
      .update(uploads)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: new Date() })
      .where(eq(uploads.id, uploadId));
  });
}

export async function runExtraction(uploadId: string) {
  const [upload] = await db.select().from(uploads).where(eq(uploads.id, uploadId));
  if (!upload) throw new Error("Upload not found");
  await db.update(uploads).set({ status: "processing", error: null, log: [] }).where(eq(uploads.id, uploadId));

  // 1–2. Files → model inputs
  await progress(uploadId, 1, "Preparing pages");
  const inputs = await toInputs(upload.files);
  await progress(uploadId, 2, `Reading ${inputs.length} page${inputs.length === 1 ? "" : "s"}`, `✓ prepared ${inputs.length} input(s)`);

  // 3. Pass 1: transcription
  const local = env.extractor === "local";
  if (local) await log(uploadId, "· built-in parser (no ANTHROPIC_API_KEY): typed files only, no explanations drafted");
  // Answers as printed in a key, by question number; matched to options once all questions are read.
  const rawKey = new Map<number, string>();
  const parsedExplanations = new Map<number, string>();
  const settled = await pool(inputs, local ? 1 : 3, async (inp) => {
    if (!local) return extractInput(inp, upload.optionCount);
    const r = await extractLocal(inp, upload.optionCount);
    r.explanations.forEach((v, k) => parsedExplanations.set(k, v));
    return r;
  });
  let extracted: ExtractedQuestion[] = [];
  const failedPages: number[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const page = inputs[i].kind === "pdf" ? null : (inputs[i] as { page: number }).page;
    if (r.status === "fulfilled") {
      extracted.push(...r.value.questions);
      for (const a of r.value.answer_key ?? []) rawKey.set(a.number, a.answer);
      for (const pi of r.value.page_issues) await log(uploadId, `! p${pi.page} · ${pi.issue}`);
      const avg = r.value.questions.reduce((s, q) => s + q.confidence, 0) / Math.max(1, r.value.questions.length);
      const pagesSeen = new Set(r.value.questions.map((q) => q.page)).size;
      await log(uploadId, `✓ ${page ? `p${page}` : `PDF · ${pagesSeen} page${pagesSeen === 1 ? "" : "s"}`} · ${r.value.questions.length} questions · conf ${avg.toFixed(2)}`);
    } else {
      if (page) failedPages.push(page);
      await log(uploadId, `✕ ${page ? `p${page}` : "document"} · ${(r.reason as Error)?.message ?? "failed"}`);
    }
  }

  // Keep the first reading of each number (a question split across pages can appear twice).
  const byNumber = new Map<number, ExtractedQuestion>();
  for (const q of extracted.sort((a, b) => a.number - b.number)) if (!byNumber.has(q.number)) byNumber.set(q.number, q);
  extracted = [...byNumber.values()];

  if (extracted.length === 0) {
    throw new Error(
      failedPages.length
        ? `No questions could be read. Pages ${failedPages.join(", ")} failed. Retake them flat, in daylight, with the whole page in view.`
        : "No questions were found in this upload.",
    );
  }

  if (rawKey.size) await log(uploadId, `✓ answer key in the paper · ${rawKey.size} answers`);

  // 4. Separate answer key
  if (upload.answerKeyFile) {
    await progress(uploadId, 3, "Reading the answer key");
    try {
      // A separate key file wins over a key printed in the paper.
      let fileKey: Map<number, string>;
      if (local) fileKey = await readKeyLocal(upload.answerKeyFile);
      else {
        const [keyInput] = await toInputs([upload.answerKeyFile]);
        const block: Anthropic.ContentBlockParam = keyInput.kind === "text" ? { type: "text", text: keyInput.text } : keyInput.block;
        const key = await runParse(AnswerKey, "You read answer keys for multiple-choice exams.", [
          block,
          { type: "text", text: "List every question number with its answer exactly as printed (a letter, roman numeral, number or the answer's text)." },
        ]);
        fileKey = new Map(key.answers.map((a) => [a.number, a.letter]));
      }
      fileKey.forEach((v, n) => rawKey.set(n, v));
      await log(uploadId, `✓ answer key file · ${fileKey.size} answers`);
    } catch (e) {
      await log(uploadId, `✕ answer key · ${(e as Error).message}`);
    }
  }

  // Match key answers to options ("B", "ii", "2" or "Abuja" all work).
  const keyByNumber = new Map<number, number>();
  const unmatched: number[] = [];
  for (const [n, token] of rawKey) {
    const q = byNumber.get(n);
    if (!q) continue;
    const i = resolveAnswer(token, q.options);
    if (i != null) keyByNumber.set(n, i);
    else unmatched.push(n);
  }
  const keyless = extracted.filter((q) => !keyByNumber.has(q.number) && resolveAnswer(q.printed_answer, q.options) == null).length;
  if (rawKey.size) await log(uploadId, `✓ answers matched · ${keyByNumber.size} of ${extracted.length} questions from the key`);
  if (unmatched.length) await log(uploadId, `! answer key · Q${unmatched.sort((a, b) => a - b).join(", Q")} didn't match an option`);
  if (keyless) await log(uploadId, `! ${keyless} question${keyless === 1 ? "" : "s"} with no answer in the paper`);

  // 5. Pass 2: explanations, topics, proposed answers
  await progress(uploadId, 4, "Drafting explanations and topic tags");
  const [course] = await db.select().from(courses).where(eq(courses.id, upload.courseId));
  const courseTopics = await db.select().from(topics).where(eq(topics.courseId, upload.courseId));
  const enrichByNumber = new Map<number, z.infer<typeof Enrichment>["items"][number]>();
  const batches: ExtractedQuestion[][] = [];
  for (let i = 0; i < extracted.length; i += 10) batches.push(extracted.slice(i, i + 10));

  const enrichSystem = `You are a patient tutor writing answer explanations for first-year students preparing for ${course.code} (${course.title}).
Write plainly and calmly, no jokes, no filler. Explanations are 3 to 6 sentences.
For calculation questions give short numbered working steps. Answer with the option letter.
Known topics for this course: ${courseTopics.map((t) => t.name).join("; ") || "(none yet: propose short topic names)"}.`;

  const enrichSettled = local ? [] : await pool(batches, 3, (batch) =>
    runParse(Enrichment, enrichSystem, [
      {
        type: "text",
        text: batch
          .map((q) => {
            const known = keyByNumber.get(q.number) ?? resolveAnswer(q.printed_answer, q.options);
            return `Q${q.number}. ${q.text}\n${q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("\n")}${
              known != null ? `\nThe official answer is ${LETTERS[known]}. Explain why that is right.` : "\nNo official answer: work out the correct one."
            }`;
          })
          .join("\n\n"),
      },
    ]),
  );
  enrichSettled.forEach((r, i) => {
    if (r.status === "fulfilled") r.value.items.forEach((it) => enrichByNumber.set(it.number, it));
    else void log(uploadId, `✕ explanations for Q${batches[i][0].number}–Q${batches[i].at(-1)!.number} · ${(r.reason as Error)?.message}`);
  });

  // 6. Validate + repeats
  await progress(uploadId, 5, "Checking options, numbering and repeats");
  const numbers = extracted.map((q) => q.number);
  const gaps: number[] = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n++) if (!byNumber.has(n)) gaps.push(n);
  if (gaps.length) await log(uploadId, `! numbering gap · Q${gaps.join(", Q")} missing`);

  const existing = await db
    .select({ id: questions.id, text: questions.text, uploadId: questions.sourceUploadId })
    .from(questions)
    // Only questions a person has approved count as repeats; other uploads' drafts may never go live.
    .where(and(eq(questions.courseId, upload.courseId), eq(questions.status, "approved")));
  const existingByText = new Map(existing.filter((e) => e.uploadId !== uploadId).map((e) => [normalise(e.text), e.id]));

  const topicIdByName = new Map(courseTopics.map((t) => [t.name.toLowerCase(), t.id]));
  async function topicId(name: string | undefined, conn: Pick<typeof db, "insert"> = db) {
    if (!name) return null;
    const k = name.trim().toLowerCase();
    if (topicIdByName.has(k)) return topicIdByName.get(k)!;
    const [t] = await conn
      .insert(topics)
      .values({ courseId: upload.courseId, name: name.trim(), position: topicIdByName.size })
      .returning();
    topicIdByName.set(k, t.id);
    return t.id;
  }

  // 7. Write drafts
  await progress(uploadId, 6, "Saving drafts for review");
  await db.transaction(async (tx) => {
    // Re-running replaces this upload's previous drafts.
    const [oldPaper] = await tx.select().from(papers).where(eq(papers.uploadId, uploadId));
    if (oldPaper) await tx.delete(papers).where(eq(papers.id, oldPaper.id));
    await tx.delete(questions).where(and(eq(questions.sourceUploadId, uploadId), eq(questions.status, "draft")));

    const [paper] = await tx
      .insert(papers)
      .values({
        courseId: upload.courseId,
        uploadId,
        session: upload.session,
        semester: upload.semester,
        examType: upload.examType,
        timeLimitMin: upload.timeLimitMin,
        optionCount: upload.optionCount,
        negativeMark: upload.negativeMark,
        status: "draft",
      })
      .returning();

    let position = 0;
    for (const q of extracted) {
      const e = enrichByNumber.get(q.number);
      const printed = resolveAnswer(q.printed_answer, q.options);
      const sourceKey = keyByNumber.get(q.number) ?? printed;
      const aiKey = letterToIndex(e?.proposed_answer);
      const flags = [...q.issues];
      if (printed != null && keyByNumber.has(q.number) && printed !== keyByNumber.get(q.number))
        flags.push(`Answer key says ${LETTERS[keyByNumber.get(q.number)!]}, the question marks ${LETTERS[printed]}`);
      if (unmatched.includes(q.number)) flags.push(`Key answer "${rawKey.get(q.number)}" didn't match an option`);
      if (q.options.length !== upload.optionCount) flags.push(`${q.options.length} options found, expected ${upload.optionCount}`);
      if (!q.text.trim() || q.options.some((o) => !o.trim())) flags.push("Empty text or option");
      if (sourceKey == null) flags.push(aiKey != null ? `No key in source · AI suggested ${LETTERS[aiKey]}` : "No answer key");
      if (sourceKey != null && aiKey != null && sourceKey !== aiKey) flags.push(`Key says ${LETTERS[sourceKey]}, AI thinks ${LETTERS[aiKey]}`);
      if (q.has_diagram) flags.push(upload.files.some((f) => f.mime.startsWith("image/") || f.mime === "application/pdf") ? "Has a diagram · crop it from the scan" : "Mentions a diagram · attach the figure");
      if (!e?.explanation && !parsedExplanations.has(q.number)) flags.push("No explanation yet · write one before publishing");
      const repeatOf = existingByText.get(normalise(q.text)) ?? null;
      if (repeatOf) flags.push("Possible repeat from another year");

      const [row] = await tx
        .insert(questions)
        .values({
          courseId: upload.courseId,
          topicId: await topicId(e?.topic, tx),
          text: q.text,
          options: q.options,
          correctOption: sourceKey ?? aiKey,
          answerVerified: false, // a person approves every key, even printed ones
          explanation: e?.explanation ?? parsedExplanations.get(q.number) ?? null,
          trap: e?.trap ?? null,
          workedSteps: e?.worked_steps ?? null,
          difficulty: e?.difficulty ?? "medium",
          status: "draft",
          confidence: Math.min(q.confidence, e?.answer_confidence ?? 1),
          flags,
          hasDiagram: q.has_diagram,
          sourceUploadId: uploadId,
          sourcePage: q.page,
          sourceBox: q.box && q.box.w > 0 && q.box.h > 0 ? { x: clamp(q.box.x), y: clamp(q.box.y), w: clamp(q.box.w), h: clamp(q.box.h) } : null,
          sourceNumber: q.number,
          repeatOfId: repeatOf,
        })
        .returning({ id: questions.id });
      await tx.insert(paperQuestions).values({ paperId: paper.id, questionId: row.id, position: position++ });
    }

    await tx
      .update(uploads)
      .set({
        status: "in_review",
        progress: { step: TOTAL_STEPS, total: TOTAL_STEPS, label: "Ready for review" },
        error: failedPages.length ? `Pages ${failedPages.join(", ")} could not be read` : null,
        updatedAt: new Date(),
      })
      .where(eq(uploads.id, uploadId));
  });
}
