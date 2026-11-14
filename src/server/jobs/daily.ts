import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { addDays, lagosDate, lagosWeekStart } from "../lib/time";
import { notify } from "../services/notify";
import { MIN_RANKED_ATTEMPTS } from "@/shared/game";
import { pickDailyChallenge } from "../services/sessions";
import { gradeAttempt } from "../services/scoring";
import { startExtraction } from "../services/extraction";

const { userStreaks, courses, uploads, attempts, notifications } = schema;

/**
 * Runs once a day just after midnight Lagos time:
 *  - streaks: a missed day uses a freeze if one is saved, otherwise the streak resets
 *  - picks today's and tomorrow's daily challenge for every live course
 *  - grades sessions whose time ran out while the student was away
 *  - retries uploads stuck in "processing" for over an hour
 */
export async function runDaily(now = new Date()) {
  const today = lagosDate(now);
  const yesterday = addDays(today, -1);
  const dayBefore = addDays(today, -2);

  // Missed exactly yesterday: spend a freeze to bridge the gap.
  const frozen = await db
    .update(userStreaks)
    .set({ freezes: sql`${userStreaks.freezes} - 1`, lastActiveDate: yesterday, freezeUsedOn: yesterday, frozenStreak: sql`${userStreaks.current}` })
    .where(and(eq(userStreaks.lastActiveDate, dayBefore), sql`${userStreaks.freezes} > 0`, sql`${userStreaks.current} > 0`))
    .returning({ userId: userStreaks.userId });

  const broken = await db
    .update(userStreaks)
    .set({ current: 0, brokenStreak: sql`${userStreaks.current}`, brokenOn: today })
    .where(and(lt(userStreaks.lastActiveDate, yesterday), sql`${userStreaks.current} > 0`))
    .returning({ userId: userStreaks.userId });

  const live = await db.select({ id: courses.id }).from(courses).where(eq(courses.status, "live"));
  let picked = 0;
  for (const c of live) {
    if (await pickDailyChallenge(c.id, today)) picked++;
    await pickDailyChallenge(c.id, addDays(today, 1));
  }

  const expired = await db
    .select({ id: attempts.id, deadlineAt: attempts.deadlineAt })
    .from(attempts)
    .where(and(isNull(attempts.submittedAt), lt(attempts.deadlineAt, new Date(now.getTime() - 60_000))));
  for (const a of expired) await gradeAttempt(a.id, { now: a.deadlineAt!, autoSubmitted: true });

  const stuck = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(and(eq(uploads.status, "processing"), lt(uploads.updatedAt, new Date(now.getTime() - 60 * 60_000))));
  for (const u of stuck) startExtraction(u.id);

  const snapshots = await snapshotRanks(now);

  return { date: today, snapshots, freezesUsed: frozen.length, streaksBroken: broken.length, dailyChallenges: picked, autoSubmitted: expired.length, uploadsRetried: stuck.length };
}

/** Records every ranked student's course rank once per week, for "↑ 12 this week". */
export async function snapshotRanks(now = new Date()) {
  const week = lagosDate(lagosWeekStart(now));
  const res = await db.execute(sql`
    insert into rank_snapshots (user_id, course_id, week_start, rank)
    select user_id, course_id, ${week}::date,
           rank() over (partition by course_id order by course_score desc)::int
    from user_course_stats where ranked_attempts >= ${MIN_RANKED_ATTEMPTS}
    on conflict do nothing
  `);
  return (res as unknown as { count?: number }).count ?? 0;
}

/**
 * Runs at 8 am Lagos: tells each student their daily pop quiz is ready.
 * Each student gets one, for the first of their courses with a quiz today (the one Home shows),
 * unless they've already played it. Safe to run twice: anyone already told today is skipped.
 */
export async function runMorning(now = new Date()) {
  const today = lagosDate(now);
  // Make sure today's quizzes exist even if the midnight job didn't run.
  const live = await db.select({ id: courses.id, code: courses.code }).from(courses).where(eq(courses.status, "live")).orderBy(courses.code);
  const ready = new Map<string, string>();
  for (const c of live) if (await pickDailyChallenge(c.id, today)) ready.set(c.id, c.code);
  if (!ready.size) return { date: today, students: 0, pushed: 0 };

  const enrolled = await db
    .select({ userId: schema.userCourses.userId, courseId: schema.userCourses.courseId })
    .from(schema.userCourses)
    .innerJoin(courses, eq(courses.id, schema.userCourses.courseId))
    .innerJoin(schema.users, eq(schema.users.id, schema.userCourses.userId))
    .where(and(inArray(schema.userCourses.courseId, [...ready.keys()]), eq(schema.users.suspended, false)))
    .orderBy(courses.code);

  // Lagos midnight as an instant: notifications since then count as "today".
  const dayStart = new Date(`${today}T00:00:00+01:00`);
  const told = new Set(
    (await db.select({ id: notifications.userId }).from(notifications).where(and(eq(notifications.kind, "daily"), gte(notifications.createdAt, dayStart)))).map((r) => r.id),
  );
  const played = new Set(
    (await db.select({ id: attempts.userId }).from(attempts).where(and(eq(attempts.mode, "daily"), eq(attempts.dailyDate, today)))).map((r) => r.id),
  );

  const byCourse = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const r of enrolled) {
    if (seen.has(r.userId)) continue; // first course alphabetically, same as Home
    seen.add(r.userId);
    if (told.has(r.userId) || played.has(r.userId)) continue;
    byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r.userId]);
  }

  let students = 0;
  let pushed = 0;
  for (const [courseId, ids] of byCourse) {
    const r = await notify(ids, {
      kind: "daily",
      title: `Your ${ready.get(courseId)} pop quiz is ready`,
      body: "10 questions, 8 minutes. Same set for everyone today, so see where you rank.",
      url: `/daily?course=${courseId}`,
    });
    students += ids.length;
    pushed += r.pushed;
  }
  return { date: today, students, pushed };
}

/**
 * Runs at 8 pm Lagos: one nudge to students with a streak who haven't practised today.
 * At most one push a day per student (see notify), and only if streak reminders are on.
 */
export async function runEvening(now = new Date()) {
  const today = lagosDate(now);
  const atRisk = await db
    .select({ userId: userStreaks.userId, current: userStreaks.current })
    .from(userStreaks)
    .where(and(eq(userStreaks.lastActiveDate, addDays(today, -1)), sql`${userStreaks.current} > 0`));
  const byLength = new Map<number, string[]>();
  for (const r of atRisk) byLength.set(r.current, [...(byLength.get(r.current) ?? []), r.userId]);
  let sent = 0;
  for (const [days, ids] of byLength) {
    const r = await notify(ids, {
      kind: "streak",
      title: `Your ${days}-day streak ends at midnight`,
      body: "One 10-question drill keeps it alive. Downloaded courses work without data.",
      url: "/home",
    });
    sent += r.pushed;
  }
  return { date: today, atRisk: atRisk.length, pushed: sent };
}
