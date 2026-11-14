import { Hono } from "hono";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { fail } from "../../lib/http";
import { publicImageUrl } from "../../lib/storage";
import { assertCourseAccess } from "../../middleware/admin";
import { notify } from "../../services/notify";
import type { AppEnv } from "../../types";

const { papers, paperQuestions, questions, uploads, courses, topics, userCourses } = schema;

export const adminPaperRoutes = new Hono<AppEnv>();

async function loadPaper(id: string, user: Parameters<typeof assertCourseAccess>[0]) {
  const [paper] = await db.select().from(papers).where(eq(papers.id, id));
  if (!paper) fail(404, "Paper not found");
  await assertCourseAccess(user, paper.courseId);
  return paper;
}

async function paperQuestionsOf(paperId: string) {
  return db
    .select({ q: questions, position: paperQuestions.position, topic: topics.name })
    .from(paperQuestions)
    .innerJoin(questions, eq(questions.id, paperQuestions.questionId))
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .where(eq(paperQuestions.paperId, paperId))
    .orderBy(asc(paperQuestions.position));
}

/**
 * GET /admin/papers/:id — the review screen. Flagged drafts sort first, lowest confidence
 * first; then unreviewed drafts; then approved.
 */
adminPaperRoutes.get("/:id", async (c) => {
  const paper = await loadPaper(c.req.param("id"), c.get("user"));
  const [course] = await db.select().from(courses).where(eq(courses.id, paper.courseId));
  const [upload] = paper.uploadId ? await db.select().from(uploads).where(eq(uploads.id, paper.uploadId)) : [];
  const rows = await paperQuestionsOf(paper.id);
  const items = rows.map((r) => ({
    ...r.q,
    imageUrl: publicImageUrl(r.q.imagePath),
    position: r.position,
    topicName: r.topic,
    state: r.q.status === "approved" ? "approved" : r.q.flags.length ? "flagged" : "unreviewed",
  }));
  const order = { flagged: 0, unreviewed: 1, approved: 2 } as const;
  items.sort((a, b) => order[a.state as keyof typeof order] - order[b.state as keyof typeof order] || (a.confidence ?? 1) - (b.confidence ?? 1) || a.position - b.position);
  const counts = {
    total: items.length,
    flagged: items.filter((i) => i.state === "flagged").length,
    unreviewed: items.filter((i) => i.state === "unreviewed").length,
    approved: items.filter((i) => i.state === "approved").length,
    verified: items.filter((i) => i.answerVerified).length,
    repeats: items.filter((i) => i.repeatOfId).length,
  };
  const topicRows = await db.select().from(topics).where(eq(topics.courseId, paper.courseId)).orderBy(asc(topics.position));
  return c.json({
    paper,
    course: { id: course.id, code: course.code, title: course.title },
    upload: upload ? { id: upload.id, status: upload.status, error: upload.error, createdAt: upload.createdAt } : null,
    counts,
    topics: topicRows,
    questions: items,
  });
});

/** POST /admin/papers/:id/approve-clean — bulk approve. Unlocks once every flag is cleared. */
adminPaperRoutes.post("/:id/approve-clean", async (c) => {
  const paper = await loadPaper(c.req.param("id"), c.get("user"));
  const rows = await paperQuestionsOf(paper.id);
  const flagged = rows.filter((r) => r.q.status === "draft" && r.q.flags.length);
  if (flagged.length) fail(409, `Clear ${flagged.length} flag${flagged.length === 1 ? "" : "s"} first`);
  const ids = rows.filter((r) => r.q.status === "draft").map((r) => r.q.id);
  if (ids.length) {
    await db
      .update(questions)
      .set({ status: "approved", answerVerified: true, updatedAt: new Date() })
      .where(and(inArray(questions.id, ids), sql`${questions.correctOption} is not null`));
  }
  return c.json({ approved: ids.length });
});

/** POST /admin/papers/:id/publish — every question approved with a verified key, then live. */
adminPaperRoutes.post("/:id/publish", async (c) => {
  const user = c.get("user");
  const paper = await loadPaper(c.req.param("id"), user);
  const rows = await paperQuestionsOf(paper.id);
  if (!rows.length) fail(409, "This paper has no questions");
  const notReady = rows.filter((r) => r.q.status !== "approved" || !r.q.answerVerified);
  if (notReady.length) fail(409, `${notReady.length} question${notReady.length === 1 ? " isn't" : "s aren't"} approved yet`);

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(papers).set({ status: "published", publishedAt: now, publishedBy: user.id }).where(eq(papers.id, paper.id));
    await tx.update(courses).set({ status: "live" }).where(eq(courses.id, paper.courseId));
    if (paper.uploadId) await tx.update(uploads).set({ status: "published", updatedAt: now }).where(eq(uploads.id, paper.uploadId));
  });

  const students = await db.$count(userCourses, eq(userCourses.courseId, paper.courseId));
  const [course] = await db.select().from(courses).where(eq(courses.id, paper.courseId));
  const studentIds = (await db.select({ id: userCourses.userId }).from(userCourses).where(eq(userCourses.courseId, paper.courseId))).map((r) => r.id);
  await notify(studentIds, {
    kind: "paper",
    title: `New paper: ${course.code} ${paper.session} ${paper.examType === "test" ? "test" : "exam"}`,
    body: `${rows.length} questions, answers checked. Sit it under exam conditions, or download it for offline.`,
    url: `/course?id=${course.id}`,
  });
  const [upload] = paper.uploadId ? await db.select().from(uploads).where(eq(uploads.id, paper.uploadId)) : [];
  const minutes = upload ? Math.round((now.getTime() - upload.createdAt.getTime()) / 60000) : null;
  return c.json({ published: true, questions: rows.length, studentsToNotify: students, minutesFromUpload: minutes });
});

/** POST /admin/papers/:id/unpublish — finished attempts are kept. */
adminPaperRoutes.post("/:id/unpublish", async (c) => {
  const paper = await loadPaper(c.req.param("id"), c.get("user"));
  await db.update(papers).set({ status: "unpublished" }).where(eq(papers.id, paper.id));
  return c.json({ ok: true });
});
