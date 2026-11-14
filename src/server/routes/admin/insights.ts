import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { lagosWeekStart } from "../../lib/time";
import { adminCourseIds, assertCourseAccess } from "../../middleware/admin";
import { fail } from "../../lib/http";
import type { AppEnv } from "../../types";

export const adminInsightRoutes = new Hono<AppEnv>();

const num = (v: unknown) => (v == null ? null : Number(v));

/** Courses the admin can see, as a SQL list for `in (...)`. */
async function scopeSql(user: Parameters<typeof adminCourseIds>[0]) {
  const scope = await adminCourseIds(user);
  if (scope === "all") return sql`(select id from courses)`;
  if (!scope.length) return sql`(select null::uuid)`;
  return sql`(${sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)})`;
}

/** Answer keys that look wrong: 30+ attempts and a wrong option picked more than the key. */
async function suspectKeys(courses: ReturnType<typeof sql>, limit = 5) {
  const rows = await db.execute<{ id: string; text: string; course_code: string; session: string | null; number: number | null; key: number; top: number; top_pct: number; key_pct: number }>(sql`
    with picks as (
      select aa.question_id, aa.chosen_option, count(*) as n,
             sum(count(*)) over (partition by aa.question_id) as total
      from attempt_answers aa join questions q on q.id = aa.question_id
      where aa.chosen_option is not null and q.course_id in ${courses} and q.status = 'approved'
      group by aa.question_id, aa.chosen_option
    ), ranked as (
      select *, row_number() over (partition by question_id order by n desc) as r from picks
    )
    select q.id, q.text, c.code as course_code, q.correct_option as key, rk.chosen_option as top,
           round(rk.n * 100.0 / rk.total) as top_pct,
           round(coalesce((select p.n from picks p where p.question_id = q.id and p.chosen_option = q.correct_option), 0) * 100.0 / rk.total) as key_pct,
           (select p.session from paper_questions pq join papers p on p.id = pq.paper_id where pq.question_id = q.id limit 1) as session,
           (select pq.position + 1 from paper_questions pq where pq.question_id = q.id limit 1) as number
    from ranked rk join questions q on q.id = rk.question_id join courses c on c.id = q.course_id
    where rk.r = 1 and rk.total >= 30 and rk.chosen_option <> q.correct_option
    order by rk.n * 1.0 / rk.total desc
    limit ${limit}
  `);
  return Array.from(rows).map((r) => ({ ...r, top_pct: num(r.top_pct), key_pct: num(r.key_pct), number: num(r.number) }));
}

/** GET /admin/my-courses — courses this admin can manage (every course for super admins). */
adminInsightRoutes.get("/my-courses", async (c) => {
  const courses = await scopeSql(c.get("user"));
  const rows = await db.execute<{ id: string; code: string; title: string; status: string; option_count: number; negative_mark: number; institution: string; topics: number }>(sql`
    select c.id, c.code, c.title, c.status, c.option_count, c.negative_mark, i.short_code as institution,
           (select count(*)::int from topics t where t.course_id = c.id) as topics
    from courses c join institutions i on i.id = c.institution_id
    where c.id in ${courses}
    order by i.short_code, c.code
  `);
  return c.json({
    courses: Array.from(rows).map((r) => ({ id: r.id, code: r.code, title: r.title, status: r.status, optionCount: Number(r.option_count), negativeMark: Number(r.negative_mark), institution: r.institution, topics: Number(r.topics) })),
  });
});

/** GET /admin/dashboard — work waiting first, then a weekly health check. */
adminInsightRoutes.get("/dashboard", async (c) => {
  const user = c.get("user");
  const courses = await scopeSql(user);
  const week = lagosWeekStart();
  const lastWeek = new Date(week.getTime() - 7 * 864e5);

  const [counts] = await db.execute<{ in_review: number; failed: number; reports: number; live: number }>(sql`
    select
      (select count(*)::int from uploads where status = 'in_review' and course_id in ${courses}) as in_review,
      (select count(*)::int from uploads where status = 'failed' and course_id in ${courses}) as failed,
      (select count(distinct r.question_id)::int from question_reports r join questions q on q.id = r.question_id where r.status = 'open' and q.course_id in ${courses}) as reports,
      (select count(*)::int from questions where status = 'approved' and not auto_hidden and course_id in ${courses}) as live
  `);

  const [stats] = await db.execute<Record<string, number>>(sql`
    select
      (select count(distinct user_id)::int from attempts where submitted_at >= ${week.toISOString()}::timestamptz and course_id in ${courses}) as active,
      (select count(distinct user_id)::int from attempts where submitted_at >= ${lastWeek.toISOString()}::timestamptz and submitted_at < ${week.toISOString()}::timestamptz and course_id in ${courses}) as active_prev,
      (select count(*)::int from attempts where submitted_at >= ${week.toISOString()}::timestamptz and course_id in ${courses}) as sessions,
      (select count(*)::int from attempts where submitted_at >= ${lastWeek.toISOString()}::timestamptz and submitted_at < ${week.toISOString()}::timestamptz and course_id in ${courses}) as sessions_prev,
      (select round(avg(greatest(score,0) / nullif(max_score,0) * 100)) from attempts where submitted_at >= ${week.toISOString()}::timestamptz and course_id in ${courses}) as avg_score,
      (select round(avg(greatest(score,0) / nullif(max_score,0) * 100)) from attempts where submitted_at >= ${lastWeek.toISOString()}::timestamptz and submitted_at < ${week.toISOString()}::timestamptz and course_id in ${courses}) as avg_score_prev
  `);

  const recent = await db.execute<{ id: string; code: string; session: string; status: string; created_at: Date; pages: number; error: string | null }>(sql`
    select u.id, c.code, u.session, u.status, u.created_at, jsonb_array_length(u.files) as pages, u.error
    from uploads u join courses c on c.id = u.course_id
    where u.course_id in ${courses} order by u.created_at desc limit 5
  `);

  return c.json({
    waiting: { inReview: num(counts.in_review), failed: num(counts.failed), reports: num(counts.reports), liveQuestions: num(counts.live) },
    week: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, num(v)])),
    recentUploads: Array.from(recent),
    suspectKeys: await suspectKeys(courses, 3),
  });
});

/** GET /admin/analytics?course=&weeks=8 — trend, retention against the 40% target, signups. */
adminInsightRoutes.get("/analytics", async (c) => {
  const user = c.get("user");
  const courseId = c.req.query("course");
  if (!courseId) fail(422, "course is required");
  await assertCourseAccess(user, courseId);
  const weeks = Math.min(26, Math.max(1, Number(c.req.query("weeks") ?? 8)));
  const start = new Date(lagosWeekStart().getTime() - (weeks - 1) * 7 * 864e5);

  const series = await db.execute<{ week: Date; active: number; sessions: number; avg_score: number }>(sql`
    select date_trunc('week', submitted_at at time zone 'Africa/Lagos') as week,
           count(distinct user_id)::int as active, count(*)::int as sessions,
           round(avg(greatest(score,0) / nullif(max_score,0) * 100)) as avg_score
    from attempts where course_id = ${courseId} and submitted_at >= ${start.toISOString()}::timestamptz
    group by 1 order by 1
  `);

  // Share of this week's active students who practised on 3+ different days.
  const [ret] = await db.execute<{ pct: number }>(sql`
    with days as (
      select user_id, count(distinct (submitted_at at time zone 'Africa/Lagos')::date) as d
      from attempts where course_id = ${courseId} and submitted_at >= ${lagosWeekStart().toISOString()}::timestamptz
      group by user_id
    ) select round(avg(case when d >= 3 then 100.0 else 0 end)) as pct from days
  `);

  // Students with 10+ sessions: average gain from their first 3 to their latest 3 ranked attempts.
  const [gain] = await db.execute<{ gain: number }>(sql`
    with ranked as (
      select user_id, greatest(score,0) / nullif(max_score,0) * 100 as pct,
             row_number() over (partition by user_id order by submitted_at) as first_k,
             row_number() over (partition by user_id order by submitted_at desc) as last_k,
             count(*) over (partition by user_id) as n
      from attempts where course_id = ${courseId} and submitted_at is not null and mode in ('exam','drill')
    )
    select round(avg(late - early)) as gain from (
      select user_id, avg(pct) filter (where first_k <= 3) as early, avg(pct) filter (where last_k <= 3) as late
      from ranked where n >= 10 group by user_id
    ) s
  `);

  const signups = await db.execute<{ name: string; status: string; students: number; requests: number }>(sql`
    select i.name, i.status::text as status,
      (select count(*)::int from users u where u.institution_id = i.id) as students,
      0 as requests
    from institutions i
    union all
    select r.name, 'requested'::text as status, 0 as students, count(*)::int as requests
    from institution_requests r group by r.name
    order by students desc, requests desc limit 8
  `);

  return c.json({
    series: Array.from(series).map((s) => ({ week: s.week, active: num(s.active), sessions: num(s.sessions), avgScore: num(s.avg_score) })),
    retention3Days: num(ret?.pct) ?? 0,
    retentionTarget: 40,
    tenPlusGain: num(gain?.gain),
    signups: Array.from(signups).map((s) => ({ ...s, students: num(s.students), requests: num(s.requests) })),
    suspectKeys: await suspectKeys(sql`(${courseId}::uuid)`, 10),
  });
});
