import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail } from "../lib/http";
import { liveQuestion, toReviewQuestion } from "../services/sessions";
import type { AppEnv } from "../types";

const { papers, paperQuestions, questions, courses, topics } = schema;

export const paperRoutes = new Hono<AppEnv>();

/** GET /papers?course= — published papers for a course. */
paperRoutes.get("/", async (c) => {
  const courseId = c.req.query("course");
  if (!courseId) fail(422, "course is required");
  const rows = await db
    .select()
    .from(papers)
    .where(and(eq(papers.courseId, courseId), eq(papers.status, "published")))
    .orderBy(asc(papers.session));
  return c.json({ papers: rows });
});

/** GET /papers/:id — paper header for the exam setup sheet. */
paperRoutes.get("/:id", async (c) => {
  const [paper] = await db.select().from(papers).where(eq(papers.id, c.req.param("id")));
  if (!paper || paper.status !== "published") fail(404, "Paper not found");
  const [course] = await db.select().from(courses).where(eq(courses.id, paper.courseId));
  const count = await db.$count(paperQuestions, eq(paperQuestions.paperId, paper.id));
  return c.json({ paper, course: { id: course.id, code: course.code, title: course.title }, questions: count });
});

async function paperBundle(paperId: string) {
  const [paper] = await db.select().from(papers).where(eq(papers.id, paperId));
  if (!paper || paper.status !== "published") return null;
  const rows = await db
    .select({ q: questions, position: paperQuestions.position })
    .from(paperQuestions)
    .innerJoin(questions, eq(questions.id, paperQuestions.questionId))
    .where(and(eq(paperQuestions.paperId, paperId), liveQuestion))
    .orderBy(asc(paperQuestions.position));
  return {
    paper: {
      id: paper.id,
      courseId: paper.courseId,
      session: paper.session,
      examType: paper.examType,
      timeLimitMin: paper.timeLimitMin,
      optionCount: paper.optionCount,
      negativeMark: paper.negativeMark,
    },
    questions: rows.map((r) => toReviewQuestion(r.q)),
  };
}

/**
 * GET /papers/:id/offline — full paper with answers and explanations for offline use.
 * Offline attempts are re-graded on sync and never count toward course-score boards.
 */
paperRoutes.get("/:id/offline", async (c) => {
  const bundle = await paperBundle(c.req.param("id"));
  if (!bundle) fail(404, "Paper not found");
  // A known length lets the phone show "108 of 168 KB" while saving for offline (E02).
  const body = JSON.stringify(bundle);
  return c.body(body, 200, {
    "content-type": "application/json; charset=utf-8",
    "x-content-length": String(Buffer.byteLength(body)),
    "cache-control": "private, max-age=0",
  });
});

/** GET /papers/course/:courseId/offline — every published paper plus the topic list, in one download. */
paperRoutes.get("/course/:courseId/offline", async (c) => {
  const courseId = c.req.param("courseId");
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) fail(404, "Course not found");
  const ps = await db.select({ id: papers.id }).from(papers).where(and(eq(papers.courseId, courseId), eq(papers.status, "published")));
  const bundles = (await Promise.all(ps.map((p) => paperBundle(p.id)))).filter(Boolean);
  const topicRows = await db.select({ id: topics.id, name: topics.name }).from(topics).where(eq(topics.courseId, courseId));
  return c.json({
    course: { id: course.id, code: course.code, title: course.title, optionCount: course.optionCount, negativeMark: course.negativeMark },
    topics: topicRows,
    papers: bundles,
    downloadedAt: new Date(),
  });
});

