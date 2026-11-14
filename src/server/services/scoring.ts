import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { addDays, lagosDate } from "../lib/time";
import { courseRank } from "./leaderboard";
import {
  XP,
  streakMultiplier,
  FREEZE_EVERY_DAYS,
  MAX_FREEZES,
  MIN_RANKED_ATTEMPTS,
  COURSE_SCORE_BEST_N,
  COURSE_SCORE_WINDOW,
  FAST_SECONDS_PER_QUESTION,
  FAST_MIN_ACCURACY,
  MODES,
  type BadgeKey,
} from "@/shared/game";

const { attempts, attemptAnswers, questions, userCourseStats, userStreaks, xpEvents, badgesEarned } = schema;
type Attempt = typeof attempts.$inferSelect;

/** Seconds of slack after the deadline for answers in flight on slow networks. */
export const DEADLINE_GRACE_SEC = 30;

export type GradeResult = {
  attemptId: string;
  score: number;
  maxScore: number;
  percent: number;
  correct: number;
  wrong: number;
  skipped: number;
  timeTakenSec: number;
  xp: { earned: number; multiplier: number; streak: number };
  flagged: boolean;
  countsForBoard: boolean;
  rank: { before: number | null; after: number | null; total: number | null } | null;
  newBadges: BadgeKey[];
  xpBefore: number;
  totalXp: number;
};

export function percentOf(score: number, max: number) {
  return max > 0 ? Math.max(0, Math.round((Math.max(0, score) / max) * 1000) / 10) : 0;
}

/**
 * Grades a submitted attempt on the server. The client only ever sends answers and
 * timestamps; the key, the time taken and every reward are worked out here.
 *
 * Idempotent: grading an already-submitted attempt returns the stored result.
 */
export async function gradeAttempt(
  attemptId: string,
  opts: { now?: Date; autoSubmitted?: boolean; clientTimeTakenSec?: number } = {},
): Promise<GradeResult> {
  const now = opts.now ?? new Date();

  // Rank before this attempt counts. Read before the transaction so we never hold a
  // transaction open while waiting for a second pooled connection.
  const [head] = await db.select({ courseId: attempts.courseId, userId: attempts.userId }).from(attempts).where(eq(attempts.id, attemptId));
  const rankBefore = head ? await courseRank(head.courseId, head.userId) : null;

  return db.transaction(async (tx) => {
    // Lock the attempt so a double-tap on Submit can't award XP twice.
    const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, attemptId)).for("update");
    if (!attempt) throw new Error("Attempt not found");
    if (attempt.submittedAt) return storedResult(attempt);

    const qs = await tx
      .select({ id: questions.id, correctOption: questions.correctOption })
      .from(questions)
      .where(inArray(questions.id, attempt.questionIds));
    const keyById = new Map(qs.map((q) => [q.id, q.correctOption]));

    const answers = await tx.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, attempt.id));
    const answerById = new Map(answers.map((a) => [a.questionId, a]));

    let correct = 0, wrong = 0, skipped = 0;
    for (const qid of attempt.questionIds) {
      const a = answerById.get(qid);
      const key = keyById.get(qid);
      if (!a || a.chosenOption == null) {
        skipped++;
        continue;
      }
      const isRight = key != null && a.chosenOption === key;
      if (isRight) correct++;
      else wrong++;
      if (a.correct !== isRight) {
        await tx
          .update(attemptAnswers)
          .set({ correct: isRight })
          .where(and(eq(attemptAnswers.attemptId, attempt.id), eq(attemptAnswers.questionId, qid)));
      }
    }

    const maxScore = attempt.questionIds.length;
    const score = Math.round((correct - wrong * attempt.negativeMark) * 100) / 100;
    const answered = correct + wrong;

    // Time is measured on the server for online attempts; offline ones report their own, capped by the limit.
    let timeTakenSec = attempt.offline && opts.clientTimeTakenSec != null
      ? opts.clientTimeTakenSec
      : Math.round((now.getTime() - attempt.startedAt.getTime()) / 1000);
    if (attempt.timeLimitSec) timeTakenSec = Math.min(timeTakenSec, attempt.timeLimitSec);
    timeTakenSec = Math.max(1, timeTakenSec);

    // Fair play: impossibly fast with high accuracy is held off the board until a person decides.
    const tooFast =
      answered >= 5 &&
      timeTakenSec / answered < FAST_SECONDS_PER_QUESTION &&
      correct / answered >= FAST_MIN_ACCURACY;
    const ranked = MODES[attempt.mode].ranked || attempt.mode === "daily";
    const countsForBoard = ranked && !attempt.offline && !tooFast;

    // Streak first, so today's session gets today's multiplier.
    const today = lagosDate(now);
    const [streakRow] = await tx.select().from(userStreaks).where(eq(userStreaks.userId, attempt.userId)).for("update");
    const streak = streakRow ?? { userId: attempt.userId, current: 0, best: 0, lastActiveDate: null, freezes: 0, freezeUsedOn: null, totalXp: 0, questionsAnswered: 0, questionsCorrect: 0 };
    let current = streak.current;
    let freezes = streak.freezes;
    if (streak.lastActiveDate !== today) {
      current = streak.lastActiveDate === addDays(today, -1) ? current + 1 : 1;
      if (current > 0 && current % FREEZE_EVERY_DAYS === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
    }
    const multiplier = streakMultiplier(current);

    const baseXp =
      answered * XP.perAnswered +
      correct * XP.perCorrectBonus +
      (attempt.mode === "exam" ? XP.examCompletionBonus : 0);
    const earned = Math.round(baseXp * multiplier);
    const xpBefore = streak.totalXp;
    const totalXp = streak.totalXp + earned;

    await tx
      .insert(userStreaks)
      .values({
        userId: attempt.userId,
        current,
        best: Math.max(streak.best, current),
        lastActiveDate: today,
        freezes,
        totalXp,
        questionsAnswered: streak.questionsAnswered + answered,
        questionsCorrect: streak.questionsCorrect + correct,
      })
      .onConflictDoUpdate({
        target: userStreaks.userId,
        set: {
          current,
          best: Math.max(streak.best, current),
          lastActiveDate: today,
          freezes,
          totalXp,
          questionsAnswered: streak.questionsAnswered + answered,
          questionsCorrect: streak.questionsCorrect + correct,
        },
      });

    if (earned > 0) {
      await tx.insert(xpEvents).values({
        userId: attempt.userId,
        attemptId: attempt.id,
        amount: earned,
        reason: `${attempt.mode}${multiplier > 1 ? ` x${multiplier}` : ""}`,
        createdAt: now,
      });
    }

    await tx
      .update(attempts)
      .set({
        submittedAt: now,
        autoSubmitted: opts.autoSubmitted ?? false,
        score,
        maxScore,
        correctCount: correct,
        wrongCount: wrong,
        skippedCount: skipped,
        timeTakenSec,
        xpEarned: earned,
        countsForBoard,
        flagged: tooFast,
        flagReason: tooFast ? `${(timeTakenSec / answered).toFixed(1)}s per question at ${Math.round((correct / answered) * 100)}%` : null,
        reviewStatus: tooFast ? "pending" : "none",
      })
      .where(eq(attempts.id, attempt.id));

    // Course score only moves on ranked, online, unflagged exam/drill attempts.
    let rank: GradeResult["rank"] = null;
    if (countsForBoard && MODES[attempt.mode].ranked) {
      await recomputeCourseScore(tx, attempt.userId, attempt.courseId);
      // The after-rank is read below, once the transaction has committed.
      rank = { before: rankBefore?.rank ?? null, after: null, total: rankBefore?.total ?? null };
    }

    const newBadges = await awardBadges(tx, attempt, { correct, maxScore, current, totalAnswered: streak.questionsAnswered + answered });

    return {
      attemptId: attempt.id,
      score,
      maxScore,
      percent: percentOf(score, maxScore),
      correct,
      wrong,
      skipped,
      timeTakenSec,
      xp: { earned, multiplier, streak: current },
      flagged: tooFast,
      countsForBoard,
      rank,
      newBadges,
      xpBefore,
      totalXp,
    };
  }).then(async (result) => {
    if (result.rank) {
      const [a] = await db.select({ courseId: attempts.courseId, userId: attempts.userId }).from(attempts).where(eq(attempts.id, attemptId));
      const after = await courseRank(a.courseId, a.userId);
      result.rank.after = after?.rank ?? null;
      result.rank.total = after?.total ?? result.rank.total;
    }
    return result;
  });
}

function storedResult(a: Attempt): GradeResult {
  return {
    attemptId: a.id,
    score: a.score ?? 0,
    maxScore: a.maxScore ?? a.questionIds.length,
    percent: percentOf(a.score ?? 0, a.maxScore ?? a.questionIds.length),
    correct: a.correctCount ?? 0,
    wrong: a.wrongCount ?? 0,
    skipped: a.skippedCount ?? 0,
    timeTakenSec: a.timeTakenSec ?? 0,
    xp: { earned: a.xpEarned ?? 0, multiplier: 1, streak: 0 },
    flagged: a.flagged,
    countsForBoard: a.countsForBoard,
    rank: null,
    newBadges: [],
    xpBefore: 0,
    totalXp: 0,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Course score: the best 5 of the last 10 ranked attempts, weighted toward recent ones
 * (each step back in time counts 10% less). Shown as 0–100.
 */
export async function recomputeCourseScore(tx: Tx | typeof db, userId: string, courseId: string) {
  const recent = await tx
    .select({ score: attempts.score, maxScore: attempts.maxScore })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.courseId, courseId),
        eq(attempts.countsForBoard, true),
        inArray(attempts.mode, ["exam", "drill"]),
        isNotNull(attempts.submittedAt),
      ),
    )
    .orderBy(desc(attempts.submittedAt))
    .limit(COURSE_SCORE_WINDOW);

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.courseId, courseId),
        eq(attempts.countsForBoard, true),
        inArray(attempts.mode, ["exam", "drill"]),
        isNotNull(attempts.submittedAt),
      ),
    );

  const scored = recent.map((r, recency) => ({ pct: percentOf(r.score ?? 0, r.maxScore ?? 1), weight: Math.pow(0.9, recency) }));
  const best = scored.sort((a, b) => b.pct - a.pct).slice(0, COURSE_SCORE_BEST_N);
  const wsum = best.reduce((s, b) => s + b.weight, 0);
  const courseScore = wsum > 0 ? Math.round((best.reduce((s, b) => s + b.pct * b.weight, 0) / wsum) * 10) / 10 : 0;

  await tx
    .insert(userCourseStats)
    .values({ userId, courseId, courseScore, rankedAttempts: count, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [userCourseStats.userId, userCourseStats.courseId],
      set: { courseScore, rankedAttempts: count, updatedAt: new Date() },
    });
  return { courseScore, rankedAttempts: count, ranked: count >= MIN_RANKED_ATTEMPTS };
}

async function awardBadges(
  tx: Tx,
  attempt: Attempt,
  s: { correct: number; maxScore: number; current: number; totalAnswered: number },
): Promise<BadgeKey[]> {
  const candidates: BadgeKey[] = [];
  if (s.maxScore >= 10 && s.correct === s.maxScore) candidates.push("clean_sheet");
  if (s.current >= 7) candidates.push("week_one");
  if (s.current >= 30) candidates.push("month_mode");
  if (attempt.mode === "exam") candidates.push("first_blood");
  if (s.totalAnswered >= 1000) candidates.push("thousand_club");

  if (attempt.mode === "exam" && attempt.paperId) {
    const [row] = await tx.execute<{ missing: number }>(sql`
      select count(*)::int as missing from papers p
      where p.course_id = ${attempt.courseId} and p.status = 'published'
        and not exists (
          select 1 from attempts a where a.user_id = ${attempt.userId} and a.paper_id = p.id
            and (a.submitted_at is not null or a.id = ${attempt.id})
        )
    `);
    if (row && Number(row.missing) === 0) candidates.push("paper_chaser");
  }
  if (!candidates.length) return [];

  const inserted = await tx
    .insert(badgesEarned)
    .values(candidates.map((badgeKey) => ({ userId: attempt.userId, badgeKey })))
    .onConflictDoNothing()
    .returning({ key: badgesEarned.badgeKey });
  return inserted.map((r) => r.key as BadgeKey);
}
