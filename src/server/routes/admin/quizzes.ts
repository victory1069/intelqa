import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { fail, parse } from "../../lib/http";
import { publicImageUrl } from "../../lib/storage";
import { adminCourseIds, assertCourseAccess } from "../../middleware/admin";
import { notify } from "../../services/notify";
import { drawQuestions, effectiveStatus, poolCounts, type Quiz } from "../../services/quizzes";
import { QUIZ_MAX_MINUTES, QUIZ_MAX_QUESTIONS, QUIZ_MIN_QUESTIONS } from "@/shared/game";
import type { AppEnv, User } from "../../types";

const { quizzes, courses, topics, questions, attempts, attemptAnswers, userCourses } = schema;

export const adminQuizRoutes = new Hono<AppEnv>();

async function loadQuiz(id: string, user: User) {
  const [q] = await db.select().from(quizzes).where(eq(quizzes.id, id));
  if (!q) fail(404, "Quiz not found");
  await assertCourseAccess(user, q.courseId);
  return q;
}

const submitted = sql`${attempts.submittedAt} is not null`;

async function sittingsOf(quizId: string) {
  return db.$count(attempts, and(eq(attempts.quizId, quizId), submitted));
}

/** Tells the course's students a test is open. Sent once, the first time it goes live. */
async function announce(q: Quiz) {
  const [course] = await db.select().from(courses).where(eq(courses.id, q.courseId));
  const ids = (await db.select({ id: userCourses.userId }).from(userCourses).where(eq(userCourses.courseId, q.courseId))).map((r) => r.id);
  const until = q.closesAt ? ` Open until ${q.closesAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.` : "";
  await notify(ids, {
    kind: "paper",
    title: `New ${course.code} quiz`,
    body: `${q.title}: ${q.questionIds.length} questions, ${q.timeLimitMin} minutes.${until}`,
    url: `/quiz?id=${q.id}`,
  });
  return ids.length;
}

/** GET /admin/quizzes?course= — every test in the admin's courses, with how students did. */
adminQuizRoutes.get("/", async (c) => {
  const user = c.get("user");
  const scope = await adminCourseIds(user);
  const course = c.req.query("course");
  if (course) await assertCourseAccess(user, course);
  const where = course ? eq(quizzes.courseId, course) : scope === "all" ? undefined : scope.length ? inArray(quizzes.courseId, scope) : sql`false`;
  const rows = await db
    .select({ q: quizzes, code: courses.code })
    .from(quizzes)
    .innerJoin(courses, eq(courses.id, quizzes.courseId))
    .where(where)
    .orderBy(desc(quizzes.createdAt));
  const ids = rows.map((r) => r.q.id);
  const stats = ids.length
    ? await db
        .select({
          quizId: attempts.quizId,
          sittings: sql<number>`count(*)::int`,
          students: sql<number>`count(distinct ${attempts.userId})::int`,
          avg: sql<number | null>`avg(greatest(${attempts.score}, 0) / nullif(${attempts.maxScore}, 0) * 100)`,
        })
        .from(attempts)
        .where(and(inArray(attempts.quizId, ids), submitted))
        .groupBy(attempts.quizId)
    : [];
  const byId = new Map(stats.map((s) => [s.quizId, s]));
  const now = new Date();
  const list = rows.map(({ q, code }) => {
    const s = byId.get(q.id);
    return {
      id: q.id,
      title: q.title,
      courseId: q.courseId,
      courseCode: code,
      status: effectiveStatus(q, now),
      questions: q.questionIds.length,
      timeLimitMin: q.timeLimitMin,
      topics: q.topicIds.length,
      closesAt: q.closesAt,
      publishedAt: q.publishedAt,
      createdAt: q.createdAt,
      sittings: Number(s?.sittings ?? 0),
      students: Number(s?.students ?? 0),
      average: s?.avg == null ? null : Math.round(Number(s.avg)),
    };
  });
  const counts: Record<string, number> = { draft: 0, live: 0, closed: 0 };
  for (const q of list) counts[q.status]++;
  return c.json({ quizzes: list, counts });
});

/** GET /admin/quizzes/pool?course= — checked questions available per topic, for the form. */
adminQuizRoutes.get("/pool", async (c) => {
  const course = c.req.query("course") ?? "";
  if (!course) fail(422, "course is required");
  await assertCourseAccess(c.get("user"), course);
  const counts = await poolCounts(course);
  const rows = await db.select({ id: topics.id, name: topics.name }).from(topics).where(eq(topics.courseId, course)).orderBy(asc(topics.position), asc(topics.name));
  return c.json({
    topics: rows.map((t) => ({ ...t, available: counts[t.id] ?? 0 })),
    untagged: counts.none ?? 0,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  });
});

const When = z.string().datetime({ offset: true }).nullable().optional();

const CreateBody = z.object({
  courseId: z.string().uuid(),
  title: z.string().trim().min(3).max(80),
  instructions: z.string().trim().max(500).nullable().optional(),
  questionCount: z.number().int().min(QUIZ_MIN_QUESTIONS).max(QUIZ_MAX_QUESTIONS),
  timeLimitMin: z.number().int().min(1).max(QUIZ_MAX_MINUTES),
  topicIds: z.array(z.string().uuid()).max(50).default([]),
  negativeMark: z.number().min(0).max(1).default(0),
  closesAt: When,
  publish: z.boolean().default(false),
});

/** POST /admin/quizzes — draws the questions at random across the chosen topics. */
adminQuizRoutes.post("/", async (c) => {
  const user = c.get("user");
  const b = parse(CreateBody, await c.req.json());
  await assertCourseAccess(user, b.courseId);
  const topicIds = [...new Set(b.topicIds)];
  if (topicIds.length) {
    const ok = await db.$count(topics, and(eq(topics.courseId, b.courseId), inArray(topics.id, topicIds)));
    if (ok !== topicIds.length) fail(422, "One of those topics isn't in this course");
  }
  const closesAt = b.closesAt ? new Date(b.closesAt) : null;
  if (closesAt && closesAt < new Date()) fail(422, "The closing date has already passed");
  const questionIds = await drawQuestions(b.courseId, topicIds, b.questionCount);
  const [q] = await db
    .insert(quizzes)
    .values({
      courseId: b.courseId,
      title: b.title,
      instructions: b.instructions || null,
      topicIds,
      questionIds,
      timeLimitMin: b.timeLimitMin,
      negativeMark: b.negativeMark,
      closesAt,
      status: b.publish ? "live" : "draft",
      publishedAt: b.publish ? new Date() : null,
      createdBy: user.id,
    })
    .returning();
  const notified = b.publish ? await announce(q) : 0;
  return c.json({ id: q.id, notified }, 201);
});

/** GET /admin/quizzes/:id — the test, its questions with answers, and per-question results. */
adminQuizRoutes.get("/:id", async (c) => {
  const q = await loadQuiz(c.req.param("id"), c.get("user"));
  const [course] = await db.select().from(courses).where(eq(courses.id, q.courseId));
  const topicRows = await db.select({ id: topics.id, name: topics.name }).from(topics).where(eq(topics.courseId, q.courseId));
  const topicName = new Map(topicRows.map((t) => [t.id, t.name]));
  const qs = q.questionIds.length ? await db.select().from(questions).where(inArray(questions.id, q.questionIds)) : [];
  const byId = new Map(qs.map((x) => [x.id, x]));

  const per = await db
    .select({
      questionId: attemptAnswers.questionId,
      answered: sql<number>`count(*) filter (where ${attemptAnswers.chosenOption} is not null)::int`,
      correct: sql<number>`count(*) filter (where ${attemptAnswers.correct})::int`,
    })
    .from(attemptAnswers)
    .innerJoin(attempts, eq(attempts.id, attemptAnswers.attemptId))
    .where(and(eq(attempts.quizId, q.id), submitted))
    .groupBy(attemptAnswers.questionId);
  const perQ = new Map(per.map((p) => [p.questionId, p]));

  const [s] = await db
    .select({
      sittings: sql<number>`count(*)::int`,
      students: sql<number>`count(distinct ${attempts.userId})::int`,
      avg: sql<number | null>`avg(greatest(${attempts.score}, 0) / nullif(${attempts.maxScore}, 0) * 100)`,
      best: sql<number | null>`max(greatest(${attempts.score}, 0) / nullif(${attempts.maxScore}, 0) * 100)`,
      time: sql<number | null>`avg(${attempts.timeTakenSec})`,
    })
    .from(attempts)
    .where(and(eq(attempts.quizId, q.id), submitted));

  const items = q.questionIds.map((id, i) => {
    const x = byId.get(id);
    const p = perQ.get(id);
    if (!x) return { id, number: i + 1, text: "This question was deleted.", options: [] as string[], correctOption: null, explanation: null, imageUrl: null, topicName: null, difficulty: "medium", live: false, answered: 0, correctPct: null };
    const answered = Number(p?.answered ?? 0);
    return {
      id,
      number: i + 1,
      text: x.text,
      options: x.options,
      correctOption: x.correctOption,
      explanation: x.explanation,
      imageUrl: publicImageUrl(x.imagePath),
      topicName: topicName.get(x.topicId ?? "") ?? null,
      difficulty: x.difficulty,
      live: x.status === "approved" && !x.autoHidden,
      answered,
      correctPct: answered ? Math.round((Number(p!.correct) / answered) * 100) : null,
    };
  });

  return c.json({
    quiz: { ...q, status: effectiveStatus(q) },
    course: { id: course.id, code: course.code, title: course.title },
    topics: q.topicIds.map((t) => ({ id: t, name: topicName.get(t) ?? "Removed topic" })),
    questions: items,
    stats: {
      sittings: Number(s?.sittings ?? 0),
      students: Number(s?.students ?? 0),
      average: s?.avg == null ? null : Math.round(Number(s.avg)),
      best: s?.best == null ? null : Math.round(Number(s.best)),
      avgTimeSec: s?.time == null ? null : Math.round(Number(s.time)),
    },
  });
});

const PatchBody = z.object({
  title: z.string().trim().min(3).max(80).optional(),
  instructions: z.string().trim().max(500).nullable().optional(),
  timeLimitMin: z.number().int().min(1).max(QUIZ_MAX_MINUTES).optional(),
  negativeMark: z.number().min(0).max(1).optional(),
  closesAt: When,
  status: z.enum(["draft", "live", "closed"]).optional(),
});

/** PATCH /admin/quizzes/:id — edit details, publish, close or reopen. */
adminQuizRoutes.patch("/:id", async (c) => {
  const q = await loadQuiz(c.req.param("id"), c.get("user"));
  const b = parse(PatchBody, await c.req.json());
  const sittings = await sittingsOf(q.id);
  if (b.status === "draft" && q.status !== "draft" && sittings) fail(409, "Students have already sat this test. Close it instead.");
  if (sittings && b.negativeMark !== undefined && b.negativeMark !== q.negativeMark) fail(409, "Students have already sat this test, so its marking can't change.");
  let closesAt = b.closesAt === undefined ? q.closesAt : b.closesAt ? new Date(b.closesAt) : null;
  // Reopening a test whose date has passed clears the date rather than closing it again at once.
  if (b.status === "live" && closesAt && closesAt < new Date()) closesAt = null;
  const firstPublish = b.status === "live" && !q.publishedAt;
  const [next] = await db
    .update(quizzes)
    .set({
      title: b.title ?? q.title,
      instructions: b.instructions === undefined ? q.instructions : b.instructions || null,
      timeLimitMin: b.timeLimitMin ?? q.timeLimitMin,
      negativeMark: b.negativeMark ?? q.negativeMark,
      closesAt,
      status: b.status ?? q.status,
      publishedAt: firstPublish ? new Date() : q.publishedAt,
      updatedAt: new Date(),
    })
    .where(eq(quizzes.id, q.id))
    .returning();
  const notified = firstPublish ? await announce(next) : 0;
  return c.json({ ok: true, status: effectiveStatus(next), notified });
});

async function assertEditableSet(q: Quiz) {
  if (await sittingsOf(q.id)) fail(409, "Students have already sat this test, so its questions are fixed. Make a new test instead.");
}

/** POST /admin/quizzes/:id/redraw — a fresh random set with the same settings. */
adminQuizRoutes.post("/:id/redraw", async (c) => {
  const q = await loadQuiz(c.req.param("id"), c.get("user"));
  await assertEditableSet(q);
  const questionIds = await drawQuestions(q.courseId, q.topicIds, q.questionIds.length);
  await db.update(quizzes).set({ questionIds, updatedAt: new Date() }).where(eq(quizzes.id, q.id));
  return c.json({ ok: true });
});

/** POST /admin/quizzes/:id/swap — replaces one question with another random one, same topic where possible. */
adminQuizRoutes.post("/:id/swap", async (c) => {
  const q = await loadQuiz(c.req.param("id"), c.get("user"));
  await assertEditableSet(q);
  const { questionId } = parse(z.object({ questionId: z.string().uuid() }), await c.req.json());
  const at = q.questionIds.indexOf(questionId);
  if (at < 0) fail(404, "That question isn't in this test");
  const [old] = await db.select({ topicId: questions.topicId }).from(questions).where(eq(questions.id, questionId));
  let pick: string[] = [];
  if (old?.topicId) pick = await drawQuestions(q.courseId, [old.topicId], 1, q.questionIds).catch(() => []);
  if (!pick.length) pick = await drawQuestions(q.courseId, q.topicIds, 1, q.questionIds).catch(() => []);
  if (!pick.length) fail(422, "There are no other checked questions to swap in.");
  const questionIds = q.questionIds.slice();
  questionIds[at] = pick[0];
  await db.update(quizzes).set({ questionIds, updatedAt: new Date() }).where(eq(quizzes.id, q.id));
  return c.json({ ok: true, questionId: pick[0] });
});

/** DELETE /admin/quizzes/:id — only while no one has finished it. */
adminQuizRoutes.delete("/:id", async (c) => {
  const q = await loadQuiz(c.req.param("id"), c.get("user"));
  if (await sittingsOf(q.id)) fail(409, "Students have already sat this test. Close it instead, so their results stay.");
  await db.delete(attempts).where(eq(attempts.quizId, q.id)); // unfinished sittings only
  await db.delete(quizzes).where(eq(quizzes.id, q.id));
  return c.json({ ok: true });
});
