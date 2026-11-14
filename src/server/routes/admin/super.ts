import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { fail, parse } from "../../lib/http";
import { recomputeCourseScore } from "../../services/scoring";
import { notify } from "../../services/notify";
import { normaliseContact } from "../../middleware/auth";
import type { AppEnv } from "../../types";

const { institutions, faculties, departments, courses, courseDepartments, topics, users, adminCourses, adminInvites, attempts, attemptAnswers, questions } = schema;

/** Super admin only: catalogue, the admin team, and fair play. Mounted behind requireSuper. */
export const superRoutes = new Hono<AppEnv>();

/* ───────────── Catalogue ───────────── */

/** GET /admin/catalogue — the full tree with counts. */
superRoutes.get("/catalogue", async (c) => {
  const insts = await db.select().from(institutions).orderBy(asc(institutions.name));
  const facs = await db.select().from(faculties).orderBy(asc(faculties.name));
  const depts = await db.select().from(departments).orderBy(asc(departments.name));
  const crs = await db
    .select({
      c: courses,
      questions: sql<number>`(select count(*)::int from questions q where q.course_id = ${courses.id} and q.status = 'approved')`,
      papers: sql<number>`(select count(*)::int from papers p where p.course_id = ${courses.id} and p.status = 'published')`,
      students: sql<number>`(select count(*)::int from user_courses uc where uc.course_id = ${courses.id})`,
    })
    .from(courses)
    .orderBy(asc(courses.code));
  const cds = await db.select().from(courseDepartments);
  return c.json({
    institutions: insts.map((i) => ({
      ...i,
      faculties: facs.filter((f) => f.institutionId === i.id).map((f) => ({ ...f, departments: depts.filter((d) => d.facultyId === f.id) })),
      courses: crs
        .filter((x) => x.c.institutionId === i.id)
        .map((x) => ({ ...x.c, questions: x.questions, papers: x.papers, students: x.students, departmentIds: cds.filter((cd) => cd.courseId === x.c.id).map((cd) => cd.departmentId) })),
    })),
  });
});

superRoutes.post("/institutions", async (c) => {
  const body = parse(z.object({ name: z.string().min(3), shortCode: z.string().min(2).max(12), status: z.enum(["draft", "live"]).default("draft") }), await c.req.json());
  const [row] = await db.insert(institutions).values({ ...body, shortCode: body.shortCode.toUpperCase() }).returning();
  return c.json(row, 201);
});

superRoutes.patch("/institutions/:id", async (c) => {
  const body = parse(z.object({ name: z.string().min(3).optional(), status: z.enum(["draft", "live"]).optional() }), await c.req.json());
  const [row] = await db.update(institutions).set(body).where(eq(institutions.id, c.req.param("id"))).returning();
  return c.json(row);
});

superRoutes.post("/faculties", async (c) => {
  const body = parse(z.object({ institutionId: z.string().uuid(), name: z.string().min(2) }), await c.req.json());
  const [row] = await db.insert(faculties).values(body).returning();
  return c.json(row, 201);
});

superRoutes.post("/departments", async (c) => {
  const body = parse(z.object({ facultyId: z.string().uuid(), name: z.string().min(2) }), await c.req.json());
  const [row] = await db.insert(departments).values(body).returning();
  return c.json(row, 201);
});

const CourseBody = z.object({
  institutionId: z.string().uuid(),
  code: z.string().regex(/^[A-Z]{2,4} ?\d{3}$/i, "Use a code like STA 111"),
  title: z.string().min(3),
  level: z.number().int().min(100).max(700).default(100),
  semester: z.number().int().min(1).max(3).default(1),
  optionCount: z.number().int().min(4).max(5).default(4),
  negativeMark: z.number().min(0).max(1).default(0),
  departmentIds: z.array(z.string().uuid()).default([]),
});

/** POST /admin/courses — starts as a draft, hidden from students until a paper is published. */
superRoutes.post("/courses", async (c) => {
  const { departmentIds, ...body } = parse(CourseBody, await c.req.json());
  const code = body.code.toUpperCase().replace(/^([A-Z]+) ?(\d+)$/, "$1 $2");
  const [row] = await db.insert(courses).values({ ...body, code, status: "draft" }).returning();
  if (departmentIds.length) await db.insert(courseDepartments).values(departmentIds.map((departmentId) => ({ courseId: row.id, departmentId })));
  return c.json(row, 201);
});

superRoutes.patch("/courses/:id", async (c) => {
  const { departmentIds, ...body } = parse(CourseBody.partial().omit({ institutionId: true }), await c.req.json());
  const id = c.req.param("id");
  const [row] = Object.keys(body).length ? await db.update(courses).set(body).where(eq(courses.id, id)).returning() : await db.select().from(courses).where(eq(courses.id, id));
  if (departmentIds) {
    await db.delete(courseDepartments).where(eq(courseDepartments.courseId, id));
    if (departmentIds.length) await db.insert(courseDepartments).values(departmentIds.map((departmentId) => ({ courseId: id, departmentId })));
  }
  return c.json(row);
});

superRoutes.post("/courses/:id/topics", async (c) => {
  const { name } = parse(z.object({ name: z.string().min(2) }), await c.req.json());
  const courseId = c.req.param("id");
  const n = await db.$count(topics, eq(topics.courseId, courseId));
  const [row] = await db.insert(topics).values({ courseId, name, position: n }).returning();
  return c.json(row, 201);
});

superRoutes.patch("/topics/:id", async (c) => {
  const body = parse(z.object({ name: z.string().min(2).optional(), position: z.number().int().min(0).optional() }), await c.req.json());
  const [row] = await db.update(topics).set(body).where(eq(topics.id, c.req.param("id"))).returning();
  return c.json(row);
});

/** DELETE /admin/topics/:id?mergeInto= — questions move to another topic or become untagged. */
superRoutes.delete("/topics/:id", async (c) => {
  const id = c.req.param("id");
  const into = c.req.query("mergeInto") ?? null;
  await db.update(questions).set({ topicId: into }).where(eq(questions.topicId, id));
  await db.delete(topics).where(eq(topics.id, id));
  return c.json({ ok: true });
});

/* ───────────── Admins ───────────── */

superRoutes.get("/admins", async (c) => {
  const rows = await db
    .select({ id: users.id, name: users.displayName, phone: users.phone, email: users.email, role: users.role })
    .from(users)
    .where(inArray(users.role, ["content_admin", "super_admin"]))
    .orderBy(asc(users.displayName));
  const links = await db.select({ userId: adminCourses.userId, code: courses.code, courseId: courses.id }).from(adminCourses).innerJoin(courses, eq(courses.id, adminCourses.courseId));
  const lastActive = await db.execute<{ user_id: string; at: Date }>(sql`select uploaded_by as user_id, max(updated_at) as at from uploads group by uploaded_by`);
  const lastBy = new Map(Array.from(lastActive).map((r) => [r.user_id, r.at]));
  const invites = await db.select().from(adminInvites).orderBy(desc(adminInvites.createdAt));
  return c.json({
    admins: rows.map((r) => ({ ...r, courses: links.filter((l) => l.userId === r.id).map((l) => ({ id: l.courseId, code: l.code })), lastActive: lastBy.get(r.id) ?? null })),
    invites,
  });
});

/** POST /admin/admins/invite — by phone or email; applied when they first sign in. */
superRoutes.post("/admins/invite", async (c) => {
  const body = parse(
    z.object({ contact: z.string().min(5), role: z.enum(["content_admin", "super_admin"]), courseIds: z.array(z.string().uuid()).default([]) }),
    await c.req.json(),
  );
  if (body.role === "content_admin" && !body.courseIds.length) fail(422, "Pick at least one course for a content admin");
  const contact = normaliseContact(body.contact);

  // Already has an account: grant straight away.
  const [existing] = await db.select().from(users).where(contact.includes("@") ? eq(users.email, contact) : sql`regexp_replace(${users.phone}, '\\D', '', 'g') = ${contact}`);
  if (existing) {
    await db.update(users).set({ role: body.role }).where(eq(users.id, existing.id));
    if (body.courseIds.length) await db.insert(adminCourses).values(body.courseIds.map((courseId) => ({ userId: existing.id, courseId }))).onConflictDoNothing();
    return c.json({ granted: true, userId: existing.id }, 201);
  }
  await db
    .insert(adminInvites)
    .values({ contact, role: body.role, courseIds: body.courseIds, invitedBy: c.get("user").id })
    .onConflictDoUpdate({ target: adminInvites.contact, set: { role: body.role, courseIds: body.courseIds } });
  return c.json({ invited: true }, 201);
});

superRoutes.patch("/admins/:id", async (c) => {
  const body = parse(z.object({ role: z.enum(["student", "content_admin", "super_admin"]).optional(), courseIds: z.array(z.string().uuid()).optional() }), await c.req.json());
  const id = c.req.param("id");
  if (id === c.get("user").id && body.role && body.role !== "super_admin") fail(409, "You can't remove your own super admin role");
  if (body.role) await db.update(users).set({ role: body.role }).where(eq(users.id, id));
  if (body.courseIds) {
    await db.delete(adminCourses).where(eq(adminCourses.userId, id));
    if (body.courseIds.length) await db.insert(adminCourses).values(body.courseIds.map((courseId) => ({ userId: id, courseId })));
  }
  return c.json({ ok: true });
});

superRoutes.delete("/invites/:id", async (c) => {
  await db.delete(adminInvites).where(eq(adminInvites.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ───────────── Fair play & moderation ───────────── */

/** GET /admin/moderation/sessions — held sessions with the evidence. */
superRoutes.get("/moderation/sessions", async (c) => {
  const rows = await db
    .select({ a: attempts, name: users.displayName, deptId: users.departmentId, joined: users.createdAt, code: courses.code })
    .from(attempts)
    .innerJoin(users, eq(users.id, attempts.userId))
    .innerJoin(courses, eq(courses.id, attempts.courseId))
    .where(and(eq(attempts.flagged, true), eq(attempts.reviewStatus, "pending")))
    .orderBy(desc(attempts.submittedAt));

  const out = await Promise.all(
    rows.map(async (r) => {
      const perQuestion = await db
        .select({ questionId: attemptAnswers.questionId, ms: attemptAnswers.timeSpentMs, correct: attemptAnswers.correct })
        .from(attemptAnswers)
        .where(eq(attemptAnswers.attemptId, r.a.id));
      const msById = new Map(perQuestion.map((p) => [p.questionId, p.ms]));
      const [hist] = await db.execute<{ total: number; fast: number }>(sql`
        select count(*)::int as total,
               count(*) filter (where time_taken_sec * 1.0 / nullif(correct_count + wrong_count, 0) < 3)::int as fast
        from attempts where user_id = ${r.a.userId} and submitted_at is not null and mode in ('exam','drill','daily')
      `);
      const [paperAvg] = r.a.paperId
        ? await db.execute<{ spq: number }>(sql`
            select round(avg(time_taken_sec * 1.0 / nullif(correct_count + wrong_count, 0))) as spq
            from attempts where paper_id = ${r.a.paperId} and submitted_at is not null and not flagged`)
        : [];
      return {
        id: r.a.id,
        student: { id: r.a.userId, name: r.name, joined: r.joined },
        courseCode: r.code,
        mode: r.a.mode,
        score: r.a.score,
        maxScore: r.a.maxScore,
        timeTakenSec: r.a.timeTakenSec,
        flagReason: r.a.flagReason,
        submittedAt: r.a.submittedAt,
        secondsPerQuestion: r.a.questionIds.map((qid) => Math.round((msById.get(qid) ?? 0) / 100) / 10),
        paperAverageSpq: paperAvg ? Number(paperAvg.spq) : null,
        history: { total: Number(hist.total), fast: Number(hist.fast) },
      };
    }),
  );
  return c.json({ sessions: out });
});

/** POST /admin/moderation/sessions/:id { action: allow | keep_off | hide_student } */
superRoutes.post("/moderation/sessions/:id", async (c) => {
  const { action } = parse(z.object({ action: z.enum(["allow", "keep_off", "hide_student"]) }), await c.req.json());
  const [a] = await db.select().from(attempts).where(eq(attempts.id, c.req.param("id")));
  if (!a) fail(404, "Session not found");
  if (action === "allow") {
    await db.update(attempts).set({ reviewStatus: "allowed", countsForBoard: !a.offline }).where(eq(attempts.id, a.id));
    await recomputeCourseScore(db, a.userId, a.courseId);
  } else {
    await db.update(attempts).set({ reviewStatus: "rejected", countsForBoard: false }).where(eq(attempts.id, a.id));
    if (action === "hide_student") await db.update(users).set({ hiddenFromBoards: true }).where(eq(users.id, a.userId));
  }
  return c.json({ ok: true });
});

/** GET /admin/moderation/names — pending real-name changes. */
superRoutes.get("/moderation/names", async (c) => {
  const rows = await db
    .select({ id: users.id, current: users.displayName, requested: users.pendingDisplayName, at: users.nameChangedAt })
    .from(users)
    .where(isNotNull(users.pendingDisplayName))
    .orderBy(asc(users.nameChangedAt));
  return c.json({ names: rows });
});

superRoutes.post("/moderation/names/:userId", async (c) => {
  const { action } = parse(z.object({ action: z.enum(["approve", "reject"]), reason: z.string().optional() }), await c.req.json());
  const [u] = await db.select().from(users).where(eq(users.id, c.req.param("userId")));
  if (!u?.pendingDisplayName) fail(404, "No pending name change");
  if (action === "approve") {
    const [first, ...rest] = u.pendingDisplayName.split(" ");
    await db.update(users).set({ displayName: u.pendingDisplayName, firstName: first, surname: rest.at(-1) ?? u.surname, pendingDisplayName: null }).where(eq(users.id, u.id));
    await notify([u.id], { kind: "name", title: "Name change approved", body: `Leaderboards now show you as ${u.pendingDisplayName}.`, url: "/me" });
  } else {
    await db.update(users).set({ pendingDisplayName: null, nameChangedAt: null }).where(eq(users.id, u.id));
    await notify([u.id], { kind: "name", title: "Name change not approved", body: `Boards still show ${u.displayName}. Use your name as it appears on your school ID.`, url: "/me/settings" });
  }
  return c.json({ ok: true });
});

superRoutes.get("/moderation/hidden", async (c) => {
  const rows = await db.select({ id: users.id, name: users.displayName, suspended: users.suspended }).from(users).where(eq(users.hiddenFromBoards, true));
  return c.json({ students: rows });
});

superRoutes.post("/students/:id/visibility", async (c) => {
  const { hidden } = parse(z.object({ hidden: z.boolean() }), await c.req.json());
  await db.update(users).set({ hiddenFromBoards: hidden }).where(eq(users.id, c.req.param("id")));
  return c.json({ ok: true });
});

/** POST /admin/students/:id/suspend — typing the student's name confirms it. */
superRoutes.post("/students/:id/suspend", async (c) => {
  const body = parse(z.object({ reason: z.string().min(5), confirmName: z.string() }), await c.req.json());
  const [u] = await db.select().from(users).where(eq(users.id, c.req.param("id")));
  if (!u) fail(404, "Student not found");
  if (body.confirmName.trim() !== (u.displayName ?? "").trim()) fail(422, "The name doesn't match");
  if (u.role !== "student") fail(409, "Remove their admin role first");
  await db.update(users).set({ suspended: true, suspendReason: body.reason, hiddenFromBoards: true }).where(eq(users.id, u.id));
  return c.json({ ok: true, ref: `SUS-${u.id.slice(0, 5).toUpperCase()}` });
});

superRoutes.post("/students/:id/unsuspend", async (c) => {
  await db.update(users).set({ suspended: false, suspendReason: null }).where(eq(users.id, c.req.param("id")));
  return c.json({ ok: true });
});
