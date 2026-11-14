import { Hono } from "hono";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail } from "../lib/http";
import { percentOf } from "../services/scoring";
import { effectiveStatus } from "../services/quizzes";
import type { AppEnv } from "../types";

const { quizzes, courses, attempts, userCourses } = schema;

export const quizRoutes = new Hono<AppEnv>();

export type StudentQuiz = Awaited<ReturnType<typeof studentQuizzes>>[number];

/**
 * Practice tests a student can see: live ones in their courses, newest first, plus closed ones
 * they sat (so their result stays reachable). Each carries the student's own best and any unfinished sitting.
 */
export async function studentQuizzes(userId: string, onlyCourse?: string) {
  const enrolled = (await db.select({ id: userCourses.courseId }).from(userCourses).where(eq(userCourses.userId, userId))).map((r) => r.id);
  // Admins also see the tests in courses they manage, so they can preview them as students will.
  const [u] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, userId));
  const managed =
    u?.role === "super_admin"
      ? (await db.select({ id: courses.id }).from(courses)).map((r) => r.id)
      : u?.role === "content_admin"
        ? (await db.select({ id: schema.adminCourses.courseId }).from(schema.adminCourses).where(eq(schema.adminCourses.userId, userId))).map((r) => r.id)
        : [];
  const mine = [...new Set([...enrolled, ...managed])];
  const courseIds = onlyCourse ? [onlyCourse] : mine;
  if (!courseIds.length) return [];
  const rows = await db
    .select({ q: quizzes, code: courses.code, courseTitle: courses.title })
    .from(quizzes)
    .innerJoin(courses, eq(courses.id, quizzes.courseId))
    .where(and(inArray(quizzes.courseId, courseIds), ne(quizzes.status, "draft")))
    .orderBy(desc(quizzes.publishedAt));
  if (!rows.length) return [];

  const sat = await db
    .select({ quizId: attempts.quizId, id: attempts.id, submittedAt: attempts.submittedAt, deadlineAt: attempts.deadlineAt, score: attempts.score, maxScore: attempts.maxScore })
    .from(attempts)
    .where(and(eq(attempts.userId, userId), inArray(attempts.quizId, rows.map((r) => r.q.id))))
    .orderBy(desc(attempts.startedAt));

  const now = new Date();
  return rows
    .map(({ q, code, courseTitle }) => {
      const mineHere = sat.filter((a) => a.quizId === q.id);
      const done = mineHere.filter((a) => a.submittedAt);
      const best = done.length ? Math.max(...done.map((a) => percentOf(a.score ?? 0, a.maxScore ?? 1))) : null;
      const open = mineHere.find((a) => !a.submittedAt && (!a.deadlineAt || a.deadlineAt > now));
      return {
        id: q.id,
        title: q.title,
        instructions: q.instructions,
        course: { id: q.courseId, code, title: courseTitle },
        questions: q.questionIds.length,
        timeLimitMin: q.timeLimitMin,
        negativeMark: q.negativeMark,
        status: effectiveStatus(q, now) as "live" | "closed",
        closesAt: q.closesAt,
        publishedAt: q.publishedAt,
        sittings: done.length,
        best,
        lastAttemptId: done[0]?.id ?? null,
        openAttemptId: open?.id ?? null,
      };
    })
    .filter((q) => q.status === "live" || q.sittings > 0);
}

/** GET /quizzes?course= — practice tests set by course admins. */
quizRoutes.get("/", async (c) => c.json({ quizzes: await studentQuizzes(c.get("user").id, c.req.query("course") || undefined) }));

/** GET /quizzes/:id — one test's header for its start screen. */
quizRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [q] = await db.select({ courseId: quizzes.courseId }).from(quizzes).where(eq(quizzes.id, id));
  if (!q) fail(404, "Practice test not found");
  const item = (await studentQuizzes(c.get("user").id, q.courseId)).find((x) => x.id === id);
  if (!item) fail(404, "This practice test isn't available");
  return c.json({ quiz: item });
});
