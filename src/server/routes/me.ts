import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail, parse } from "../lib/http";
import { addDays, lagosDate, lagosWeekStart, nextLagosMidnight } from "../lib/time";
import { courseRank } from "../services/leaderboard";
import { askRemaining, askUsedToday } from "../services/ask";
import { publicImageUrl } from "../lib/storage";
import { BADGES, levelFor, streakMultiplier } from "@/shared/game";
import type { AppEnv, User } from "../types";
import { studentQuizzes } from "./quizzes";

const { users, userCourses, courses, institutions, departments, faculties, userStreaks, badgesEarned, userCourseStats, bookmarks, questions, attempts, friendships, dailyChallenges, notifications, pushSubscriptions, rankSnapshots, xpEvents, waitlist } = schema;

export const meRoutes = new Hono<AppEnv>();

const initials = (name: string | null) =>
  (name ?? "?").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

async function streakOf(userId: string) {
  const [s] = await db.select().from(userStreaks).where(eq(userStreaks.userId, userId));
  const today = lagosDate();
  // A streak is only "current" if the last session was today or yesterday.
  const alive = s?.lastActiveDate === today || s?.lastActiveDate === addDays(today, -1);
  const current = alive ? s!.current : 0;
  return {
    current,
    best: s?.best ?? 0,
    freezes: s?.freezes ?? 0,
    practisedToday: s?.lastActiveDate === today,
    endsAt: alive && s?.lastActiveDate !== today ? nextLagosMidnight() : null,
    multiplier: streakMultiplier(current),
    totalXp: s?.totalXp ?? 0,
    questionsAnswered: s?.questionsAnswered ?? 0,
    accuracy: s && s.questionsAnswered > 0 ? Math.round((s.questionsCorrect / s.questionsAnswered) * 100) : null,
  };
}

async function profile(user: User) {
  const [inst] = user.institutionId ? await db.select().from(institutions).where(eq(institutions.id, user.institutionId)) : [];
  const [dept] = user.departmentId ? await db.select().from(departments).where(eq(departments.id, user.departmentId)) : [];
  const myCourses = await db
    .select({ id: courses.id, code: courses.code, title: courses.title, status: courses.status })
    .from(userCourses)
    .innerJoin(courses, eq(courses.id, userCourses.courseId))
    .where(eq(userCourses.userId, user.id))
    .orderBy(asc(courses.code));
  const streak = await streakOf(user.id);
  const earned = await db.select().from(badgesEarned).where(eq(badgesEarned.userId, user.id));
  const earnedKeys = new Set(earned.map((b) => b.badgeKey));
  const used = await askUsedToday(user.id);
  const unread = await db.$count(notifications, and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  // E13: which courses' sessions were held for fair-play review, to name them on the Ranks screen.
  const heldIn = user.hiddenFromBoards
    ? (await db
        .selectDistinct({ code: courses.code })
        .from(attempts)
        .innerJoin(courses, eq(courses.id, attempts.courseId))
        .where(and(eq(attempts.userId, user.id), inArray(attempts.reviewStatus, ["pending", "rejected"])))).map((r) => r.code)
    : [];
  return {
    heldIn,
    id: user.id,
    phone: user.phone,
    email: user.email,
    firstName: user.firstName,
    surname: user.surname,
    displayName: user.displayName,
    initials: initials(user.displayName),
    pendingDisplayName: user.pendingDisplayName,
    role: user.role,
    onboarded: user.onboarded,
    passwordSet: user.passwordSet,
    hiddenFromBoards: user.hiddenFromBoards,
    level: user.level,
    inviteCode: user.inviteCode,
    institution: inst ? { id: inst.id, name: inst.name, shortCode: inst.shortCode } : null,
    department: dept ? { id: dept.id, name: dept.name } : null,
    courses: myCourses,
    streak,
    xp: { total: streak.totalXp, level: levelFor(streak.totalXp) },
    badges: BADGES.map((b) => ({ ...b, earned: earnedKeys.has(b.key) })),
    ask: { used, remaining: askRemaining(used) },
    notify: { streak: user.notifyStreak, papers: user.notifyPapers, daily: user.notifyDaily },
    unread,
  };
}

/** GET /me — profile, XP, level, streak, badges. */
meRoutes.get("/", async (c) => c.json(await profile(c.get("user"))));

/**
 * POST /me/password — records that the account has a password (after Supabase sets it), or
 * clears the flag when a reset starts, so the app asks for a new one.
 */
meRoutes.post("/password", async (c) => {
  const { set } = parse(z.object({ set: z.boolean() }), await c.req.json());
  const [u] = await db.update(users).set({ passwordSet: set }).where(eq(users.id, c.get("user").id)).returning();
  return c.json(await profile(u));
});

const ProfileBody = z.object({
  institutionId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  level: z.number().int().min(100).max(700).optional(),
  courseIds: z.array(z.string().uuid()).max(20).optional(),
  firstName: z.string().trim().min(2).max(40).optional(),
  surname: z.string().trim().min(2).max(40).optional(),
  notifyStreak: z.boolean().optional(),
  notifyPapers: z.boolean().optional(),
  notifyDaily: z.boolean().optional(),
});

const NAME_RE = /^[\p{L}][\p{L}'\-. ]*$/u;
const BLOCKED = /(goat|king|queen|boss|admin|official|xxx|fuck|shit|bitch)/i;

/**
 * PATCH /me/profile — onboarding and later edits. The first name is approved straight away
 * if it passes the word filter; later changes wait for moderation, at most once every 30 days.
 */
meRoutes.patch("/profile", async (c) => {
  const user = c.get("user");
  const body = parse(ProfileBody, await c.req.json());
  const patch: Partial<typeof users.$inferInsert> = {};

  if (body.institutionId) patch.institutionId = body.institutionId;
  if (body.departmentId) {
    const [d] = await db
      .select({ id: departments.id, institutionId: faculties.institutionId })
      .from(departments)
      .innerJoin(faculties, eq(faculties.id, departments.facultyId))
      .where(eq(departments.id, body.departmentId));
    if (!d) fail(422, "Unknown department");
    patch.departmentId = d.id;
    patch.institutionId = d.institutionId;
  }
  if (body.level) patch.level = body.level;
  if (body.notifyStreak !== undefined) patch.notifyStreak = body.notifyStreak;
  if (body.notifyPapers !== undefined) patch.notifyPapers = body.notifyPapers;
  if (body.notifyDaily !== undefined) patch.notifyDaily = body.notifyDaily;

  if (body.firstName || body.surname) {
    const first = body.firstName ?? user.firstName ?? "";
    const last = body.surname ?? user.surname ?? "";
    const full = `${first} ${last}`.trim();
    if (!NAME_RE.test(first) || !NAME_RE.test(last)) fail(422, "Use letters only, as your name appears on your school ID");
    if (!user.displayName) {
      if (BLOCKED.test(full)) fail(422, "Use your real name. Nicknames aren't allowed on leaderboards.");
      Object.assign(patch, { firstName: first, surname: last, displayName: full });
    } else if (full !== user.displayName) {
      if (user.nameChangedAt && Date.now() - user.nameChangedAt.getTime() < 30 * 864e5) {
        fail(429, "You can change your name once every 30 days");
      }
      Object.assign(patch, { pendingDisplayName: full, nameChangedAt: new Date() });
    }
  }

  if (body.courseIds) {
    await db.delete(userCourses).where(eq(userCourses.userId, user.id));
    if (body.courseIds.length) {
      await db.insert(userCourses).values(body.courseIds.map((courseId) => ({ userId: user.id, courseId }))).onConflictDoNothing();
    }
  }

  const merged = { ...user, ...patch };
  if (merged.institutionId && merged.departmentId && merged.displayName && (body.courseIds?.length ?? 1) > 0) patch.onboarded = true;

  const [updated] = Object.keys(patch).length
    ? await db.update(users).set(patch).where(eq(users.id, user.id)).returning()
    : [user];
  return c.json(await profile(updated));
});

/** DELETE /me/name-change — cancel a pending name change. */
meRoutes.delete("/name-change", async (c) => {
  const [u] = await db.update(users).set({ pendingDisplayName: null }).where(eq(users.id, c.get("user").id)).returning();
  return c.json(await profile(u));
});

/** JSON keys, ids and flags each downloaded question carries on top of its text. */
const QUESTION_OVERHEAD_BYTES = 280;

/** GET /me/home — everything the home screen needs in one request. */
meRoutes.get("/home", async (c) => {
  const user = c.get("user");
  const today = lagosDate();
  const myCourses = await db
    .select({ id: courses.id, code: courses.code, title: courses.title, status: courses.status })
    .from(userCourses)
    .innerJoin(courses, eq(courses.id, userCourses.courseId))
    .where(eq(userCourses.userId, user.id))
    .orderBy(asc(courses.code));

  const weekDate = lagosDate(lagosWeekStart());
  const courseCards = await Promise.all(
    myCourses.map(async (co) => {
      const [stat] = await db.select().from(userCourseStats).where(and(eq(userCourseStats.userId, user.id), eq(userCourseStats.courseId, co.id)));
      const rank = await courseRank(co.id, user.id);
      const papers = await db.$count(schema.papers, and(eq(schema.papers.courseId, co.id), eq(schema.papers.status, "published")));
      // A17: places gained (positive) or lost since the start of this Lagos week, as in GET /me/week.
      const [snap] = rank ? await db.select().from(rankSnapshots).where(and(eq(rankSnapshots.userId, user.id), eq(rankSnapshots.courseId, co.id), eq(rankSnapshots.weekStart, weekDate))) : [];
      const moved = rank && snap ? snap.rank - rank.rank : null;
      // E05: roughly what the offline download weighs, so "It's about 168 KB" can be shown with no connection.
      const [size] = papers
        ? await db.execute<{ bytes: number }>(sql`
            select coalesce(sum(octet_length(q.text) + octet_length(q.options::text) + coalesce(octet_length(q.explanation), 0)
              + coalesce(octet_length(q.trap), 0) + coalesce(octet_length(q.worked_steps::text), 0) + ${QUESTION_OVERHEAD_BYTES}), 0)::int as bytes
            from paper_questions pq join papers p on p.id = pq.paper_id join questions q on q.id = pq.question_id
            where p.course_id = ${co.id} and p.status = 'published'
          `)
        : [];
      return { ...co, papers, courseScore: stat?.courseScore ?? null, rankedAttempts: stat?.rankedAttempts ?? 0, rank, moved, offlineBytes: Number(size?.bytes ?? 0) };
    }),
  );

  const [open] = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.userId, user.id), sql`${attempts.submittedAt} is null`, inArray(attempts.mode, ["exam", "drill", "daily", "challenge", "quiz"])))
    .orderBy(desc(attempts.startedAt))
    .limit(1);

  let resume = null;
  if (open && (!open.deadlineAt || open.deadlineAt > new Date())) {
    const answered = await db.$count(schema.attemptAnswers, and(eq(schema.attemptAnswers.attemptId, open.id), isNotNull(schema.attemptAnswers.chosenOption)));
    const co = myCourses.find((x) => x.id === open.courseId);
    const [paper] = open.paperId ? await db.select().from(schema.papers).where(eq(schema.papers.id, open.paperId)) : [];
    const [quiz] = open.quizId ? await db.select({ title: schema.quizzes.title }).from(schema.quizzes).where(eq(schema.quizzes.id, open.quizId)) : [];
    resume = { id: open.id, mode: open.mode, courseCode: co?.code ?? "", session: paper?.session ?? quiz?.title ?? null, answered, total: open.questionIds.length, deadlineAt: open.deadlineAt };
  }

  // Daily challenge for the first course that has one.
  let daily = null;
  for (const co of myCourses) {
    const [dc] = await db.select().from(dailyChallenges).where(and(eq(dailyChallenges.courseId, co.id), eq(dailyChallenges.date, today)));
    if (!dc) continue;
    const played = await db.$count(attempts, and(eq(attempts.mode, "daily"), eq(attempts.courseId, co.id), eq(attempts.dailyDate, today)));
    const [mine] = await db.select().from(attempts).where(and(eq(attempts.userId, user.id), eq(attempts.mode, "daily"), eq(attempts.courseId, co.id), eq(attempts.dailyDate, today)));
    daily = { courseId: co.id, courseCode: co.code, played, mine: mine ? { attemptId: mine.id, score: mine.score, timeTakenSec: mine.timeTakenSec } : null, resetsAt: nextLagosMidnight() };
    break;
  }

  const streak = await streakOf(user.id);
  const [st] = await db.select().from(userStreaks).where(eq(userStreaks.userId, user.id));
  // D16 / D17: the daily job records a freeze or a broken streak; Home shows it once (the app remembers it was seen).
  const moment =
    st?.freezeUsedOn && st.freezeUsedOn >= addDays(today, -1)
      ? { kind: "freeze" as const, on: st.freezeUsedOn, days: st.frozenStreak ?? st.current, freezesLeft: st.freezes }
      : st?.brokenOn && st.brokenOn >= addDays(today, -1) && st.brokenStreak
        ? { kind: "lost" as const, on: st.brokenOn, days: st.brokenStreak, best: st.best }
        : null;
  return c.json({
    moment,
    unread: await db.$count(notifications, and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    firstName: user.firstName,
    streak,
    xp: { total: streak.totalXp, level: levelFor(streak.totalXp) },
    resume,
    daily,
    // Practice tests the student hasn't sat yet, newest first.
    quizzes: (await studentQuizzes(user.id)).filter((q) => q.status === "live" && !q.sittings).slice(0, 3),
    courses: courseCards,
    firstTime: streak.questionsAnswered === 0,
  });
});

/** GET /me/streak?month=YYYY-MM — active days for the calendar. */
meRoutes.get("/streak", async (c) => {
  const user = c.get("user");
  const month = c.req.query("month") ?? lagosDate().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00+01:00`);
  const rows = await db.execute<{ d: string }>(sql`
    select distinct to_char(submitted_at at time zone 'Africa/Lagos', 'YYYY-MM-DD') as d
    from attempts where user_id = ${user.id} and submitted_at >= ${start.toISOString()}::timestamptz and submitted_at < ${start.toISOString()}::timestamptz + interval '1 month'
  `);
  return c.json({ month, activeDays: Array.from(rows).map((r) => r.d), ...(await streakOf(user.id)) });
});

/** GET /me/sessions — past sessions. */
meRoutes.get("/sessions", async (c) => {
  const rows = await db
    .select({ a: attempts, code: courses.code })
    .from(attempts)
    .innerJoin(courses, eq(courses.id, attempts.courseId))
    .where(and(eq(attempts.userId, c.get("user").id), isNotNull(attempts.submittedAt)))
    .orderBy(desc(attempts.submittedAt))
    .limit(100);
  return c.json({
    sessions: rows.map(({ a, code }) => ({ id: a.id, mode: a.mode, courseCode: code, score: a.score, maxScore: a.maxScore, xp: a.xpEarned, submittedAt: a.submittedAt })),
  });
});

/* ── Bookmarks ── */

meRoutes.get("/bookmarks", async (c) => {
  const rows = await db
    .select({ q: questions, code: courses.code, at: bookmarks.createdAt })
    .from(bookmarks)
    .innerJoin(questions, eq(questions.id, bookmarks.questionId))
    .innerJoin(courses, eq(courses.id, questions.courseId))
    .where(eq(bookmarks.userId, c.get("user").id))
    .orderBy(asc(courses.code), desc(bookmarks.createdAt));
  return c.json({
    bookmarks: rows.map((r) => ({ courseCode: r.code, questionId: r.q.id, courseId: r.q.courseId, text: r.q.text, imageUrl: publicImageUrl(r.q.imagePath), savedAt: r.at })),
  });
});

meRoutes.put("/bookmarks/:questionId", async (c) => {
  await db.insert(bookmarks).values({ userId: c.get("user").id, questionId: c.req.param("questionId") }).onConflictDoNothing();
  return c.json({ bookmarked: true });
});

meRoutes.delete("/bookmarks/:questionId", async (c) => {
  await db.delete(bookmarks).where(and(eq(bookmarks.userId, c.get("user").id), eq(bookmarks.questionId, c.req.param("questionId"))));
  return c.json({ bookmarked: false });
});

/* ── Push and inbox ── */

const PushBody = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(8) }) });

/** POST /me/push — save this browser's push subscription. */
meRoutes.post("/push", async (c) => {
  const sub = parse(PushBody, await c.req.json());
  await db
    .insert(pushSubscriptions)
    .values({ userId: c.get("user").id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: c.get("user").id, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  return c.json({ ok: true }, 201);
});

/** DELETE /me/push — remove a subscription (sign-out, or notifications turned off). */
meRoutes.delete("/push", async (c) => {
  const { endpoint } = parse(z.object({ endpoint: z.string().url() }), await c.req.json());
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, c.get("user").id)));
  return c.json({ ok: true });
});

meRoutes.get("/notifications", async (c) => {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, c.get("user").id)).orderBy(desc(notifications.createdAt)).limit(50);
  return c.json({ notifications: rows });
});

meRoutes.post("/notifications/read", async (c) => {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, c.get("user").id), isNull(notifications.readAt)));
  return c.json({ ok: true });
});

/** GET /me/week — the weekly share card (D12): best course rank, the week's movement, XP and streak. */
meRoutes.get("/week", async (c) => {
  const user = c.get("user");
  const weekStart = lagosWeekStart();
  const weekDate = lagosDate(weekStart);
  const stats = await db
    .select({ courseId: userCourseStats.courseId, score: userCourseStats.courseScore, ranked: userCourseStats.rankedAttempts, code: courses.code })
    .from(userCourseStats)
    .innerJoin(courses, eq(courses.id, userCourseStats.courseId))
    .where(eq(userCourseStats.userId, user.id))
    .orderBy(desc(userCourseStats.courseScore));
  let best: { code: string; score: number; rank: number; total: number; moved: number | null } | null = null;
  for (const s of stats) {
    const r = await courseRank(s.courseId, user.id);
    if (!r) continue;
    const [snap] = await db.select().from(rankSnapshots).where(and(eq(rankSnapshots.userId, user.id), eq(rankSnapshots.courseId, s.courseId), eq(rankSnapshots.weekStart, weekDate)));
    if (!best || r.rank < best.rank) best = { code: s.code, score: Math.round(s.score), rank: r.rank, total: r.total, moved: snap ? snap.rank - r.rank : null };
  }
  const [{ xp }] = await db
    .select({ xp: sql<number>`coalesce(sum(${xpEvents.amount}), 0)::int` })
    .from(xpEvents)
    .where(and(eq(xpEvents.userId, user.id), gte(xpEvents.createdAt, weekStart)));
  const streak = await streakOf(user.id);
  const [inst] = user.institutionId ? await db.select().from(institutions).where(eq(institutions.id, user.institutionId)) : [];
  const weekNo = Math.ceil(((weekStart.getTime() - Date.UTC(weekStart.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return c.json({ name: user.firstName ?? user.displayName, school: inst?.shortCode ?? "", week: weekNo, best, xp, streak: streak.current, inviteCode: user.inviteCode });
});

/* ── Waitlist ── */

/** GET /me/waitlist — the coming-soon schools this student is waiting for. */
meRoutes.get("/waitlist", async (c) => {
  const rows = await db.select({ id: waitlist.institutionId }).from(waitlist).where(eq(waitlist.userId, c.get("user").id));
  return c.json({ institutionIds: rows.map((r) => r.id) });
});

/** POST /me/waitlist { institutionId } — A09: "Join the waitlist" for a school that isn't live yet. */
meRoutes.post("/waitlist", async (c) => {
  const { institutionId } = parse(z.object({ institutionId: z.string().uuid() }), await c.req.json());
  const [inst] = await db.select({ id: institutions.id }).from(institutions).where(eq(institutions.id, institutionId));
  if (!inst) fail(404, "Unknown school");
  await db.insert(waitlist).values({ userId: c.get("user").id, institutionId }).onConflictDoNothing();
  return c.json({ ok: true, institutionId }, 201);
});

/* ── Friends ── */

/** POST /me/friends { inviteCode } — joining with a friend's link makes you friends both ways. */
meRoutes.post("/friends", async (c) => {
  const user = c.get("user");
  const { inviteCode } = parse(z.object({ inviteCode: z.string().min(4).max(20) }), await c.req.json());
  const [friend] = await db.select().from(users).where(eq(users.inviteCode, inviteCode));
  if (!friend || friend.id === user.id) fail(404, "That invite link isn't valid");
  await db.insert(friendships).values([{ userId: user.id, friendId: friend.id }, { userId: friend.id, friendId: user.id }]).onConflictDoNothing();
  return c.json({ friend: { id: friend.id, name: friend.displayName } }, 201);
});

meRoutes.get("/friends", async (c) => {
  const rows = await db
    .select({ id: users.id, name: users.displayName, since: friendships.createdAt })
    .from(friendships)
    .innerJoin(users, eq(users.id, friendships.friendId))
    .where(eq(friendships.userId, c.get("user").id));
  return c.json({ friends: rows });
});

