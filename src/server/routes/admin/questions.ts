import { Hono } from "hono";
import { z } from "zod";
import sharp from "sharp";
import { and, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { env } from "../../env";
import { fail, parse } from "../../lib/http";
import { publicImageUrl, putObject } from "../../lib/storage";
import { regradeQuestion } from "../../services/regrade";
import { notify } from "../../services/notify";
import { adminCourseIds, assertCourseAccess } from "../../middleware/admin";
import { LETTERS } from "@/shared/game";
import type { AppEnv } from "../../types";

const { questions, topics, questionReports, attemptAnswers, users, paperQuestions, papers, courses } = schema;

export const adminQuestionRoutes = new Hono<AppEnv>();

async function loadQuestion(id: string, user: Parameters<typeof assertCourseAccess>[0]) {
  const [q] = await db.select().from(questions).where(eq(questions.id, id));
  if (!q) fail(404, "Question not found");
  await assertCourseAccess(user, q.courseId);
  return q;
}

/** GET /admin/questions?course=&topic=&q=&year=&difficulty=&status= — the question bank. */
adminQuestionRoutes.get("/", async (c) => {
  const user = c.get("user");
  const courseId = c.req.query("course");
  if (!courseId) fail(422, "course is required");
  await assertCourseAccess(user, courseId);
  const filters: SQL[] = [eq(questions.courseId, courseId)];
  const topic = c.req.query("topic");
  const text = c.req.query("q");
  const difficulty = c.req.query("difficulty");
  const status = c.req.query("status");
  const year = c.req.query("year");
  if (topic) filters.push(eq(questions.topicId, topic));
  if (text) filters.push(ilike(questions.text, `%${text}%`));
  if (difficulty) filters.push(eq(questions.difficulty, difficulty as "easy" | "medium" | "hard"));
  if (status === "hidden") filters.push(sql`(${questions.status} = 'hidden' or ${questions.autoHidden})`);
  else if (status === "unverified") filters.push(eq(questions.answerVerified, false));
  else if (status) filters.push(eq(questions.status, status as "draft" | "approved"));
  if (year) filters.push(sql`exists (select 1 from paper_questions pq join papers p on p.id = pq.paper_id where pq.question_id = ${questions.id} and p.session = ${year})`);

  const rows = await db
    .select({
      q: questions,
      topic: topics.name,
      attempts: sql<number>`(select count(*)::int from attempt_answers aa where aa.question_id = ${questions.id} and aa.chosen_option is not null)`,
      correctPct: sql<number | null>`(select round(avg(case when aa.correct then 100.0 else 0 end)) from attempt_answers aa where aa.question_id = ${questions.id} and aa.chosen_option is not null)`,
      years: sql<number>`(select count(distinct p.session)::int from paper_questions pq join papers p on p.id = pq.paper_id where pq.question_id = ${questions.id} or pq.question_id in (select id from questions r where r.repeat_of_id = ${questions.id}))`,
    })
    .from(questions)
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .where(and(...filters))
    .orderBy(desc(questions.createdAt))
    .limit(200);
  const total = await db.$count(questions, and(...filters));
  return c.json({
    total,
    questions: rows.map((r) => ({
      id: r.q.id,
      text: r.q.text,
      topic: r.topic,
      difficulty: r.q.difficulty,
      status: r.q.autoHidden || r.q.status === "hidden" ? "hidden" : r.q.answerVerified ? (r.q.status === "approved" ? "live" : "draft") : "unverified",
      attempts: r.attempts,
      correctPct: r.correctPct == null ? null : Number(r.correctPct),
      years: Math.max(1, r.years),
    })),
  });
});

/** GET /admin/questions/:id — question with per-option stats and reports. */
adminQuestionRoutes.get("/:id", async (c) => {
  const q = await loadQuestion(c.req.param("id"), c.get("user"));
  const picks = await db
    .select({ option: attemptAnswers.chosenOption, n: sql<number>`count(*)::int` })
    .from(attemptAnswers)
    .where(and(eq(attemptAnswers.questionId, q.id), sql`${attemptAnswers.chosenOption} is not null`))
    .groupBy(attemptAnswers.chosenOption);
  const total = picks.reduce((s, p) => s + p.n, 0);
  const optionStats = q.options.map((text, i) => {
    const n = picks.find((p) => p.option === i)?.n ?? 0;
    return { letter: LETTERS[i], text, picks: n, pct: total ? Math.round((n / total) * 100) : 0, isKey: q.correctOption === i };
  });
  const mostPicked = [...optionStats].sort((a, b) => b.picks - a.picks)[0];
  const reports = await db
    .select({ id: questionReports.id, reason: questionReports.reason, note: questionReports.note, status: questionReports.status, createdAt: questionReports.createdAt, name: users.displayName })
    .from(questionReports)
    .innerJoin(users, eq(users.id, questionReports.userId))
    .where(eq(questionReports.questionId, q.id))
    .orderBy(desc(questionReports.createdAt));
  const inPapers = await db
    .select({ id: papers.id, session: papers.session, examType: papers.examType, position: paperQuestions.position })
    .from(paperQuestions)
    .innerJoin(papers, eq(papers.id, paperQuestions.paperId))
    .where(eq(paperQuestions.questionId, q.id));
  const [repeat] = q.repeatOfId
    ? await db.select({ id: questions.id, text: questions.text, correctOption: questions.correctOption }).from(questions).where(eq(questions.id, q.repeatOfId))
    : [];
  return c.json({
    question: { ...q, imageUrl: publicImageUrl(q.imagePath) },
    attempts: total,
    correctPct: total && q.correctOption != null ? optionStats[q.correctOption].pct : null,
    optionStats,
    keyWarning: total >= 30 && mostPicked && !mostPicked.isKey && mostPicked.pct > (q.correctOption != null ? optionStats[q.correctOption].pct : 0),
    reports,
    papers: inPapers,
    repeatOf: repeat ?? null,
  });
});

const EditBody = z.object({
  text: z.string().min(1).optional(),
  options: z.array(z.string().min(1)).min(2).max(5).optional(),
  correctOption: z.number().int().min(0).max(4).nullable().optional(),
  explanation: z.string().nullable().optional(),
  trap: z.string().nullable().optional(),
  workedSteps: z.array(z.string()).nullable().optional(),
  topicId: z.string().uuid().nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  imageAlt: z.string().nullable().optional(),
  repeatOfId: z.string().uuid().nullable().optional(),
  /** Approve = a person checked the question and its key. */
  approve: z.boolean().optional(),
  hide: z.boolean().optional(),
  /** Mark open reports on this question resolved and lift an auto-hide. */
  resolveReports: z.boolean().optional(),
});

/** PATCH /admin/questions/:id — edit, verify and approve. Changing a live key regrades every attempt. */
adminQuestionRoutes.patch("/:id", async (c) => {
  const q = await loadQuestion(c.req.param("id"), c.get("user"));
  const body = parse(EditBody, await c.req.json());
  const { approve, hide, resolveReports, ...fields } = body;
  const opts = fields.options ?? q.options;
  const key = fields.correctOption === undefined ? q.correctOption : fields.correctOption;
  if (key != null && key >= opts.length) fail(422, "The correct option must be one of the options");

  const patch: Partial<typeof questions.$inferInsert> = { ...fields, updatedAt: new Date() };
  if (approve) {
    if (key == null) fail(422, "Pick the correct answer before approving");
    if (!(fields.explanation ?? q.explanation)) fail(422, "Add an explanation before approving");
    Object.assign(patch, { status: "approved", answerVerified: true, flags: [] });
  }
  if (hide === true) patch.status = "hidden";
  if (hide === false && q.status === "hidden") patch.status = "approved";
  if (resolveReports) patch.autoHidden = false;

  const [updated] = await db.update(questions).set(patch).where(eq(questions.id, q.id)).returning();
  if (resolveReports) {
    await db.update(questionReports).set({ status: "resolved" }).where(and(eq(questionReports.questionId, q.id), eq(questionReports.status, "open")));
  }

  let regrade = null;
  if (fields.correctOption !== undefined && fields.correctOption !== q.correctOption && q.status === "approved") {
    regrade = await regradeQuestion(q.id);
    // E08: tell every student whose score moved, and why.
    const [ref] = await db
      .select({ code: courses.code, session: papers.session, position: paperQuestions.position })
      .from(paperQuestions)
      .innerJoin(papers, eq(papers.id, paperQuestions.paperId))
      .innerJoin(courses, eq(courses.id, papers.courseId))
      .where(eq(paperQuestions.questionId, q.id))
      .limit(1);
    const where = ref ? `${ref.code} ${ref.session}, question ${ref.position + 1}` : "A question you answered";
    const letter = fields.correctOption != null ? LETTERS[fields.correctOption] : "?";
    if (regrade.improvedUsers.length) {
      await notify(regrade.improvedUsers, { kind: "score_corrected", title: "Your score went up", body: `${where} had the wrong answer key. The correct answer is ${letter}, which is what you picked, so your score has been updated.`, url: "/me/notifications" });
    }
    const lowered = regrade.changedUsers.filter((u) => !regrade!.improvedUsers.includes(u));
    if (lowered.length) {
      await notify(lowered, { kind: "score_corrected", title: "A score was corrected", body: `${where} had the wrong answer key. The correct answer is ${letter}, so your score has been updated.`, url: "/me/notifications" });
    }
  }
  return c.json({ question: { ...updated, imageUrl: publicImageUrl(updated.imagePath) }, regrade });
});

/** POST /admin/questions — add one question by hand (lands as a draft). */
adminQuestionRoutes.post("/", async (c) => {
  const body = parse(
    EditBody.extend({ courseId: z.string().uuid(), text: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(5) }),
    await c.req.json(),
  );
  await assertCourseAccess(c.get("user"), body.courseId);
  // Strip review-only flags; the rest are columns.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { approve: _a, hide: _h, resolveReports: _r, ...fields } = body;
  const [q] = await db.insert(questions).values({ ...fields, status: "draft" }).returning();
  return c.json({ question: q }, 201);
});

/** POST /admin/questions/:id/image — attach a cropped diagram. Stored as small greyscale WebP. */
adminQuestionRoutes.post("/:id/image", async (c) => {
  const q = await loadQuestion(c.req.param("id"), c.get("user"));
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) fail(422, "Attach the cropped image as 'file'");
  const webp = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate()
    .resize({ width: 900, withoutEnlargement: true })
    .greyscale()
    .webp({ quality: 70 })
    .toBuffer();
  const path = `${q.courseId}/${q.id}-${Date.now()}.webp`;
  await putObject(env.STORAGE_BUCKET_IMAGES, path, webp, "image/webp");
  const alt = typeof body["alt"] === "string" ? body["alt"] : q.imageAlt;
  const [updated] = await db
    .update(questions)
    .set({ imagePath: path, imageBytes: webp.length, imageAlt: alt, hasDiagram: true, updatedAt: new Date() })
    .where(eq(questions.id, q.id))
    .returning();
  return c.json({ imageUrl: publicImageUrl(updated.imagePath), bytes: webp.length });
});

/* ── CSV import ── */

/** Small RFC-4180 parser: quoted fields, escaped quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const FIELD_GUESSES: Record<string, RegExp> = {
  question: /^(q|question|stem|text)$/i,
  opt_a: /^(a|opt_?a|option_?a)$/i,
  opt_b: /^(b|opt_?b|option_?b)$/i,
  opt_c: /^(c|opt_?c|option_?c)$/i,
  opt_d: /^(d|opt_?d|option_?d)$/i,
  opt_e: /^(e|opt_?e|option_?e)$/i,
  answer: /^(ans|answer|key|correct)$/i,
  topic: /^(topic|tag)$/i,
  explanation: /^(explanation|why|reason)$/i,
};

/**
 * POST /admin/questions/import — multipart: file (CSV), courseId, commit=true|false.
 * Without commit it returns the column mapping and row problems. With commit, good rows
 * become draft questions to review like any upload.
 */
adminQuestionRoutes.post("/import", async (c) => {
  const body = await c.req.parseBody();
  const courseId = String(body["courseId"] ?? "");
  await assertCourseAccess(c.get("user"), courseId);
  const file = body["file"];
  if (!(file instanceof File)) fail(422, "Attach a CSV file");
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  const rows = parseCsv(await file.text());
  if (rows.length < 2) fail(422, "The CSV needs a header row and at least one question");

  const header = rows[0].map((h) => h.trim());
  const mapping = header.map((h) => ({ column: h, field: Object.entries(FIELD_GUESSES).find(([, re]) => re.test(h))?.[0] ?? null }));
  const col = (f: string) => mapping.findIndex((m) => m.field === f);
  const existing = new Set(
    (await db.select({ text: questions.text }).from(questions).where(eq(questions.courseId, courseId))).map((q) => q.text.toLowerCase().replace(/\W+/g, " ").trim()),
  );

  const ready: { text: string; options: string[]; correctOption: number | null; topic: string | null; explanation: string | null }[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.slice(1).forEach((r, i) => {
    const n = i + 2;
    const text = r[col("question")]?.trim();
    const options = ["opt_a", "opt_b", "opt_c", "opt_d", "opt_e"].map((f) => r[col(f)]?.trim()).filter((o): o is string => !!o);
    const ansRaw = r[col("answer")]?.trim().toUpperCase() ?? "";
    const ans = ansRaw ? LETTERS.indexOf(ansRaw[0] as (typeof LETTERS)[number]) : -1;
    if (!text) return errors.push({ row: n, message: "Question text is empty" });
    if (options.length < course.optionCount) return errors.push({ row: n, message: `Only ${options.length} options` });
    if (ansRaw && (ans < 0 || ans >= options.length)) return errors.push({ row: n, message: `Correct option is "${ansRaw}", but the row only has A–${LETTERS[options.length - 1]}` });
    if (existing.has(text.toLowerCase().replace(/\W+/g, " ").trim())) return errors.push({ row: n, message: "Already in the bank" });
    ready.push({ text, options, correctOption: ans >= 0 ? ans : null, topic: r[col("topic")]?.trim() || null, explanation: r[col("explanation")]?.trim() || null });
  });

  if (String(body["commit"]) !== "true") return c.json({ rows: rows.length - 1, mapping, ready: ready.length, errors });

  const topicRows = await db.select().from(topics).where(eq(topics.courseId, courseId));
  const topicByName = new Map(topicRows.map((t) => [t.name.toLowerCase(), t.id]));
  for (const r of ready) {
    let topicId: string | null = null;
    if (r.topic) {
      topicId = topicByName.get(r.topic.toLowerCase()) ?? null;
      if (!topicId) {
        [{ id: topicId }] = await db.insert(topics).values({ courseId, name: r.topic, position: topicByName.size }).returning({ id: topics.id });
        topicByName.set(r.topic.toLowerCase(), topicId);
      }
    }
    await db.insert(questions).values({
      courseId,
      topicId,
      text: r.text,
      options: r.options,
      correctOption: r.correctOption,
      explanation: r.explanation,
      status: "draft",
      flags: [r.correctOption == null ? "No answer key" : "", r.explanation ? "" : "No explanation yet"].filter(Boolean),
    });
  }
  return c.json({ imported: ready.length, skipped: errors.length, errors });
});

/* ── Reports queue ── */

/** GET /admin/reports?status=open — grouped by question, most-reported first. */
adminQuestionRoutes.get("/reports/queue", async (c) => {
  const user = c.get("user");
  const scope = await adminCourseIds(user);
  const status = (c.req.query("status") ?? "open") as "open" | "resolved" | "dismissed";
  const rows = await db
    .select({
      questionId: questionReports.questionId,
      n: sql<number>`count(*)::int`,
      // Cast to text[]: the driver can't parse an array of the enum type and would return "{a,b}" as a string.
      reasons: sql<string[]>`array_agg(distinct ${questionReports.reason}::text)`,
      notes: sql<string[]>`array_remove(array_agg(${questionReports.note} order by ${questionReports.createdAt} desc), null)`,
      // mapWith turns Postgres's "2026-11-13 02:36:46+00" into a Date (sent as ISO), which every browser parses.
      latest: sql<Date>`max(${questionReports.createdAt})`.mapWith(questionReports.createdAt),
      text: questions.text,
      autoHidden: questions.autoHidden,
      courseCode: courses.code,
    })
    .from(questionReports)
    .innerJoin(questions, eq(questions.id, questionReports.questionId))
    .innerJoin(courses, eq(courses.id, questions.courseId))
    .where(and(eq(questionReports.status, status), scope === "all" ? undefined : inArray(questions.courseId, scope.length ? scope : ["00000000-0000-0000-0000-000000000000"])))
    .groupBy(questionReports.questionId, questions.text, questions.autoHidden, courses.code)
    .orderBy(sql`count(*) desc`, sql`max(${questionReports.createdAt}) desc`);
  return c.json({ reports: rows });
});

/** POST /admin/questions/:id/reports/dismiss — close reports without changes and lift an auto-hide. */
adminQuestionRoutes.post("/:id/reports/dismiss", async (c) => {
  const q = await loadQuestion(c.req.param("id"), c.get("user"));
  await db.update(questionReports).set({ status: "dismissed" }).where(and(eq(questionReports.questionId, q.id), eq(questionReports.status, "open")));
  await db.update(questions).set({ autoHidden: false }).where(eq(questions.id, q.id));
  return c.json({ ok: true });
});

