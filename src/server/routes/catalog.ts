import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail, parse } from "../lib/http";
import { courseRank } from "../services/leaderboard";
import { liveQuestion, mistakeIds } from "../services/sessions";
import type { AppEnv } from "../types";

const { institutions, faculties, departments, courses, topics, userCourseStats, institutionRequests } = schema;

export const catalogRoutes = new Hono<AppEnv>();

/** Live quizzes in the course row being selected. */
const liveQuizCount = sql<number>`(select count(*)::int from quizzes z where z.course_id = courses.id and z.status = 'live' and (z.closes_at is null or z.closes_at > now()))`;

/** GET /catalog/institutions?q= — live schools first, then the waitlist. */
catalogRoutes.get("/institutions", async (c) => {
  const q = c.req.query("q")?.trim();
  const rows = await db
    .select({
      id: institutions.id,
      name: institutions.name,
      shortCode: institutions.shortCode,
      status: institutions.status,
      liveCourses: sql<number>`(select count(*)::int from courses where courses.institution_id = institutions.id and courses.status = 'live')`,
    })
    .from(institutions)
    .where(q ? sql`${institutions.name} ilike ${"%" + q + "%"} or ${institutions.shortCode} ilike ${"%" + q + "%"}` : undefined)
    .orderBy(sql`${institutions.status} = 'live' desc`, asc(institutions.name));
  return c.json({ institutions: rows });
});

/** POST /catalog/institution-requests — "Request my school". */
catalogRoutes.post("/institution-requests", async (c) => {
  const { name } = parse(z.object({ name: z.string().min(2).max(120) }), await c.req.json());
  await db.insert(institutionRequests).values({ name, userId: c.get("user").id });
  return c.json({ ok: true }, 201);
});

/** GET /catalog/institutions/:id/faculties — faculties with their departments. */
catalogRoutes.get("/institutions/:id/faculties", async (c) => {
  const fs = await db.select().from(faculties).where(eq(faculties.institutionId, c.req.param("id"))).orderBy(asc(faculties.name));
  const ds = fs.length
    ? await db.select().from(departments).where(inArray(departments.facultyId, fs.map((f) => f.id))).orderBy(asc(departments.name))
    : [];
  return c.json({
    faculties: fs.map((f) => ({ id: f.id, name: f.name, departments: ds.filter((d) => d.facultyId === f.id).map((d) => ({ id: d.id, name: d.name })) })),
  });
});

/**
 * GET /catalog/courses?institutionId=&departmentId=&level= — courses for onboarding.
 * Courses the department takes are pre-ticked. Courses with no papers yet stay visible.
 */
catalogRoutes.get("/courses", async (c) => {
  const user = c.get("user");
  const institutionId = c.req.query("institutionId") ?? user.institutionId;
  if (!institutionId) fail(422, "institutionId is required");
  const departmentId = c.req.query("departmentId") ?? user.departmentId;
  const level = Number(c.req.query("level") ?? user.level ?? 100);

  const rows = await db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      level: courses.level,
      semester: courses.semester,
      status: courses.status,
      optionCount: courses.optionCount,
      negativeMark: courses.negativeMark,
      papers: sql<number>`(select count(*)::int from papers p where p.course_id = courses.id and p.status = 'published')`,
      quizzes: liveQuizCount,
      suggested: departmentId
        ? sql<boolean>`exists (select 1 from course_departments cd where cd.course_id = ${courses.id} and cd.department_id = ${departmentId})`
        : sql<boolean>`false`,
    })
    .from(courses)
    .where(and(eq(courses.institutionId, institutionId), eq(courses.level, level)))
    .orderBy(asc(courses.code));
  return c.json({ courses: rows });
});

/** GET /catalog/search-courses?q= — add an elective outside the department list. */
catalogRoutes.get("/search-courses", async (c) => {
  const user = c.get("user");
  const q = c.req.query("q")?.trim() ?? "";
  if (!user.institutionId || q.length < 2) return c.json({ courses: [] });
  const rows = await db
    .select({ id: courses.id, code: courses.code, title: courses.title, status: courses.status })
    .from(courses)
    .where(and(eq(courses.institutionId, user.institutionId), sql`(${courses.code} ilike ${"%" + q + "%"} or ${courses.title} ilike ${"%" + q + "%"})`))
    .limit(20);
  return c.json({ courses: rows });
});

/** GET /catalog/courses/:id — course page: score, rank, topics with mastery, papers with best score. */
catalogRoutes.get("/courses/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const [course] = await db.select().from(courses).where(eq(courses.id, id));
  if (!course) fail(404, "Course not found");
  const [extra] = await db.select({ quizzes: liveQuizCount }).from(courses).where(eq(courses.id, id));
  const questions = await db.$count(schema.questions, and(eq(schema.questions.courseId, id), liveQuestion, eq(schema.questions.answerVerified, true)));

  const [stat] = await db.select().from(userCourseStats).where(and(eq(userCourseStats.userId, user.id), eq(userCourseStats.courseId, id)));
  const rank = await courseRank(id, user.id);

  const topicRows = await db.execute<{ id: string; name: string; questions: number; answered: number; correct: number }>(sql`
    select t.id, t.name,
      (select count(*)::int from questions q where q.topic_id = t.id and q.status = 'approved' and not q.auto_hidden) as questions,
      (select count(*)::int from attempt_answers aa join attempts a on a.id = aa.attempt_id join questions q on q.id = aa.question_id
         where q.topic_id = t.id and a.user_id = ${user.id} and aa.chosen_option is not null) as answered,
      (select count(*)::int from attempt_answers aa join attempts a on a.id = aa.attempt_id join questions q on q.id = aa.question_id
         where q.topic_id = t.id and a.user_id = ${user.id} and aa.correct) as correct
    from topics t where t.course_id = ${id}
    order by t.position, t.name
  `);

  const paperRows = await db.execute<{ id: string; session: string; exam_type: string; time_limit_min: number; option_count: number; negative_mark: number; questions: number; best: number | null; tried: number }>(sql`
    select p.id, p.session, p.exam_type, p.time_limit_min, p.option_count, p.negative_mark,
      (select count(*)::int from paper_questions pq where pq.paper_id = p.id) as questions,
      (select max(greatest(a.score, 0) / nullif(a.max_score, 0) * 100) from attempts a where a.paper_id = p.id and a.user_id = ${user.id} and a.submitted_at is not null) as best,
      (select count(*)::int from attempts a where a.paper_id = p.id and a.user_id = ${user.id}) as tried
    from papers p where p.course_id = ${id} and p.status = 'published'
    order by p.session desc, p.exam_type
  `);

  return c.json({
    course,
    courseScore: stat?.courseScore ?? null,
    rankedAttempts: stat?.rankedAttempts ?? 0,
    rank,
    quizzes: Number(extra.quizzes),
    questions,
    mistakes: (await mistakeIds(user.id, id)).length,
    topics: Array.from(topicRows).map((t) => ({
      id: t.id,
      name: t.name,
      questions: Number(t.questions),
      mastery: Number(t.answered) > 0 ? Math.round((Number(t.correct) / Number(t.answered)) * 100) : null,
    })),
    papers: Array.from(paperRows).map((p) => ({
      id: p.id,
      session: p.session,
      examType: p.exam_type,
      timeLimitMin: Number(p.time_limit_min),
      optionCount: Number(p.option_count),
      negativeMark: Number(p.negative_mark),
      questions: Number(p.questions),
      best: p.best == null ? null : Math.round(Number(p.best)),
      tried: Number(p.tried) > 0,
    })),
  });
});

/** GET /catalog/courses/:id/topics — plain topic list. */
catalogRoutes.get("/courses/:id/topics", async (c) => {
  const rows = await db.select().from(topics).where(eq(topics.courseId, c.req.param("id"))).orderBy(asc(topics.position));
  return c.json({ topics: rows });
});

