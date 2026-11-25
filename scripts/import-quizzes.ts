/**
 * Loads a folder of quiz files (content/<set>/*.json) into the database: topics, questions and live quizzes.
 *
 *   npx tsx scripts/import-quizzes.ts content/ca-2025-2026            dry run: checks files, shows what would change
 *   npx tsx scripts/import-quizzes.ts content/ca-2025-2026 --write    saves
 *     --update   also overwrite questions and quizzes a previous run added (never a quiz's question set once students have sat it)
 *     --notify   tell each course's students, once per course, in their in-app inbox
 *
 * Ids are derived from the set, course and question, so running it twice never makes copies.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";
import { QUIZ_MAX_MINUTES, QUIZ_MAX_QUESTIONS, QUIZ_MIN_QUESTIONS } from "../src/shared/game";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

const File = z.object({
  course: z.string(),
  /** Only used when the course isn't in the catalogue yet. */
  courseTitle: z.string().optional(),
  instructions: z.string().max(500),
  topics: z.array(z.string()).min(1),
  questions: z.array(
    z.object({
      ref: z.string(),
      number: z.number().int(),
      topic: z.string(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      text: z.string().min(1),
      options: z.array(z.string().min(1)).min(2).max(5),
      correct: z.number().int().min(0),
      explanation: z.string().min(1),
      image: z.string().startsWith("/").optional(),
      imageAlt: z.string().optional(),
      imageBytes: z.number().int().optional(),
    }),
  ),
  /** Unclear in the source: saved as flagged drafts for an admin, never shown to students. */
  held: z.array(z.object({ ref: z.string(), number: z.number().int(), text: z.string(), options: z.array(z.string()), reason: z.string() })).default([]),
  quizzes: z.array(
    z.object({
      ref: z.string(),
      title: z.string().min(3).max(80),
      timeLimitMin: z.number().int().min(1).max(QUIZ_MAX_MINUTES),
      negativeMark: z.number().min(0).max(1),
      questions: z.array(z.string()).min(QUIZ_MIN_QUESTIONS).max(QUIZ_MAX_QUESTIONS),
    }),
  ),
});

/** A stable UUID for a name. */
function idFor(name: string) {
  const h = createHash("sha1").update(`intelqa:${name}`).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  return h.toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

async function main() {
  const dir = process.argv[2];
  const flag = (f: string) => process.argv.includes(`--${f}`);
  if (!dir || !existsSync(dir)) throw new Error("Give the folder, e.g. content/ca-2025-2026");
  const set = path.basename(dir);

  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const r = File.safeParse(JSON.parse(readFileSync(path.join(dir, f), "utf8")));
    if (!r.success) throw new Error(`${f}: ${z.prettifyError(r.error)}`);
    const d = r.data;
    const refs = new Set(d.questions.map((q) => q.ref));
    if (refs.size !== d.questions.length) throw new Error(`${f}: a question ref is repeated`);
    for (const q of d.questions) {
      if (q.correct >= q.options.length) throw new Error(`${f} ${q.ref}: the answer isn't one of the options`);
      if (!d.topics.includes(q.topic)) throw new Error(`${f} ${q.ref}: unknown topic ${q.topic}`);
      if (q.image && !existsSync(path.join("public", q.image))) throw new Error(`${f} ${q.ref}: public${q.image} is missing`);
    }
    const dealt = d.quizzes.flatMap((x) => x.questions);
    for (const ref of dealt) if (!refs.has(ref)) throw new Error(`${f}: a quiz uses missing question ${ref}`);
    if (new Set(dealt).size !== dealt.length) throw new Error(`${f}: a question is in two quizzes`);
    return d;
  });

  const { db, schema: s } = await import("../src/server/db/client");
  const { and, eq, inArray, sql } = await import("drizzle-orm");
  const [inst] = await db.select().from(s.institutions).where(eq(s.institutions.shortCode, "UNILORIN"));
  if (!inst) throw new Error("UNILORIN isn't in the catalogue");
  const [admin] = await db.select().from(s.users).where(eq(s.users.role, "super_admin")).limit(1);
  if (!admin) throw new Error("No super admin account to own the quizzes");

  // One time for the whole set, so a course's quizzes list in title order.
  const now = new Date();
  if (!flag("write")) console.log("Dry run. Add --write to save.\n");
  for (const d of files) {
    const [course] = await db.select().from(s.courses).where(and(eq(s.courses.institutionId, inst.id), eq(s.courses.code, d.course)));
    if (!course && !d.courseTitle) throw new Error(`${d.course} isn't in the catalogue and the file has no courseTitle`);
    const questionId = (ref: string) => idFor(`${set}/${d.course}/question/${ref}`);
    const quizId = (ref: string) => idFor(`${set}/${d.course}/quiz/${ref}`);
    const ids = d.questions.map((q) => questionId(q.ref));
    const existing = await db.$count(s.questions, inArray(s.questions.id, ids));
    console.log(`${d.course}${course ? "" : " (new course)"}: ${d.questions.length} questions (${existing} already saved), ${d.quizzes.length} quizzes, ${d.held.length} held for review`);
    if (!flag("write")) continue;

    await db.transaction(async (tx) => {
      const courseId = course?.id ?? (await tx.insert(s.courses).values({ institutionId: inst.id, code: d.course, title: d.courseTitle! }).returning())[0].id;

      const have = await tx.select().from(s.topics).where(eq(s.topics.courseId, courseId));
      const topicId = new Map(have.map((t) => [t.name, t.id]));
      let position = Math.max(-1, ...have.map((t) => t.position));
      for (const name of d.topics) {
        if (topicId.has(name)) continue;
        const [t] = await tx.insert(s.topics).values({ courseId, name, position: ++position }).returning();
        topicId.set(name, t.id);
      }

      const rows = d.questions.map((q) => ({
        id: questionId(q.ref),
        courseId,
        topicId: topicId.get(q.topic)!,
        text: q.text,
        options: q.options,
        correctOption: q.correct,
        answerVerified: true,
        explanation: q.explanation,
        imagePath: q.image ?? null,
        imageAlt: q.imageAlt ?? null,
        imageBytes: q.imageBytes ?? null,
        hasDiagram: !!q.image,
        difficulty: q.difficulty,
        status: "approved" as const,
        sourceNumber: q.number,
      }));
      const insert = tx.insert(s.questions).values(rows);
      const x = (c: string) => sql.raw(`excluded.${c}`);
      await (flag("update")
        ? insert.onConflictDoUpdate({
            target: s.questions.id,
            set: {
              topicId: x("topic_id"), text: x("text"), options: x("options"), correctOption: x("correct_option"), explanation: x("explanation"),
              imagePath: x("image_path"), imageAlt: x("image_alt"), imageBytes: x("image_bytes"), hasDiagram: x("has_diagram"), difficulty: x("difficulty"), updatedAt: new Date(),
            },
          })
        : insert.onConflictDoNothing());

      if (d.held.length) {
        await tx.insert(s.questions).values(d.held.map((q) => ({ id: questionId(q.ref), courseId, text: q.text, options: q.options, flags: [q.reason], sourceNumber: q.number }))).onConflictDoNothing();
      }

      for (const quiz of d.quizzes) {
        const values = {
          title: quiz.title,
          instructions: d.instructions,
          questionIds: quiz.questions.map(questionId),
          timeLimitMin: quiz.timeLimitMin,
          negativeMark: quiz.negativeMark,
        };
        const add = tx.insert(s.quizzes).values({ id: quizId(quiz.ref), courseId, ...values, status: "live", publishedAt: now, createdBy: admin.id });
        const sat = await tx.$count(s.attempts, eq(s.attempts.quizId, quizId(quiz.ref)));
        if (flag("update") && !sat) await add.onConflictDoUpdate({ target: s.quizzes.id, set: { ...values, updatedAt: now } });
        else await add.onConflictDoNothing();
      }
      await tx.update(s.courses).set({ status: "live" }).where(eq(s.courses.id, courseId));

      if (flag("notify")) {
        const url = `/course?id=${courseId}`;
        const title = `${d.quizzes.length} new ${d.course} quizzes`;
        const told = await tx.select({ id: s.notifications.userId }).from(s.notifications).where(and(eq(s.notifications.url, url), eq(s.notifications.title, title)));
        const skip = new Set(told.map((t) => t.id));
        const students = (await tx.select({ id: s.userCourses.userId }).from(s.userCourses).where(eq(s.userCourses.courseId, courseId))).filter((u) => !skip.has(u.id));
        const body = `${d.questions.length} questions from the 2025/2026 CA, with every answer explained.`;
        if (students.length) await tx.insert(s.notifications).values(students.map((u) => ({ userId: u.id, kind: "paper" as const, title, body, url })));
        console.log(`  told ${students.length} student${students.length === 1 ? "" : "s"}`);
      }
    });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
