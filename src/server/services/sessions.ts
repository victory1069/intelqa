import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail } from "../lib/http";
import { sample, shuffle } from "../lib/random";
import { lagosDate } from "../lib/time";
import { publicImageUrl } from "../lib/storage";
import { DAILY_SIZE, DAILY_TIME_SEC, DRILL_SIZES, type Mode } from "@/shared/game";
import type { User } from "../types";
import { effectiveStatus, liveQuizQuestionIds } from "./quizzes";

const { questions, papers, paperQuestions, attempts, attemptAnswers, dailyChallenges, challenges, courses } = schema;
type Question = typeof questions.$inferSelect;

/** Live = approved by an admin and not auto-hidden by reports. */
export const liveQuestion = and(eq(questions.status, "approved"), eq(questions.autoHidden, false));

export type StartInput = {
  mode: Mode;
  courseId?: string;
  paperId?: string;
  topicId?: string;
  size?: 10 | 20;
  filter?: "all" | "weak" | "unseen";
  challengeCode?: string;
  quizId?: string;
};

/** Question ids the student got wrong and hasn't since got right twice in a row. */
export async function mistakeIds(userId: string, courseId: string): Promise<string[]> {
  const rows = await db.execute<{ question_id: string }>(sql`
    with ordered as (
      select aa.question_id, aa.correct,
             row_number() over (partition by aa.question_id order by aa.answered_at desc) as k
      from attempt_answers aa
      join attempts a on a.id = aa.attempt_id
      join questions q on q.id = aa.question_id
      where a.user_id = ${userId} and q.course_id = ${courseId} and a.submitted_at is not null
        and aa.chosen_option is not null and q.status = 'approved' and not q.auto_hidden
    )
    select question_id from ordered
    group by question_id
    having bool_or(correct = false)
       and not (count(*) filter (where k <= 2) = 2 and bool_and(correct) filter (where k <= 2))
  `);
  return Array.from(rows).map((r) => r.question_id);
}

async function topicMastery(userId: string, courseId: string) {
  const rows = await db.execute<{ topic_id: string; pct: number }>(sql`
    select q.topic_id, avg(case when aa.correct then 1.0 else 0 end) as pct
    from attempt_answers aa join attempts a on a.id = aa.attempt_id join questions q on q.id = aa.question_id
    where a.user_id = ${userId} and q.course_id = ${courseId} and aa.chosen_option is not null and q.topic_id is not null
    group by q.topic_id
  `);
  return new Map(Array.from(rows).map((r) => [r.topic_id, Number(r.pct)]));
}

async function seenIds(userId: string, courseId: string) {
  const rows = await db
    .selectDistinct({ id: attemptAnswers.questionId })
    .from(attemptAnswers)
    .innerJoin(attempts, eq(attempts.id, attemptAnswers.attemptId))
    .where(and(eq(attempts.userId, userId), eq(attempts.courseId, courseId)));
  return new Set(rows.map((r) => r.id));
}

async function paperQuestionIds(paperId: string) {
  const rows = await db
    .select({ id: paperQuestions.questionId })
    .from(paperQuestions)
    .innerJoin(questions, eq(questions.id, paperQuestions.questionId))
    .where(and(eq(paperQuestions.paperId, paperId), liveQuestion, eq(questions.answerVerified, true)))
    .orderBy(paperQuestions.position);
  return rows.map((r) => r.id);
}

/** Creates an attempt with shuffled question and option order. Answers are never included. */
export async function startAttempt(user: User, input: StartInput) {
  let courseId = input.courseId;
  let paperId: string | null = null;
  let questionIds: string[] = [];
  let timeLimitSec: number | null = null;
  let negativeMark = 0;
  let dailyDate: string | null = null;
  let challengeId: string | null = null;
  let quizId: string | null = null;
  let shuffleQuestions = true;

  switch (input.mode) {
    case "exam":
    case "challenge": {
      let pid = input.paperId;
      if (input.mode === "challenge") {
        const [ch] = await db.select().from(challenges).where(eq(challenges.code, input.challengeCode ?? ""));
        if (!ch) fail(404, "This challenge doesn't exist");
        if (ch.expiresAt < new Date()) fail(410, "This challenge has ended");
        pid = ch.paperId;
        challengeId = ch.id;
      }
      const [paper] = await db.select().from(papers).where(eq(papers.id, pid ?? ""));
      if (!paper || paper.status !== "published") fail(404, "This paper isn't available");
      courseId = paper.courseId;
      paperId = paper.id;
      questionIds = await paperQuestionIds(paper.id);
      timeLimitSec = paper.timeLimitMin * 60;
      negativeMark = paper.negativeMark;
      break;
    }
    case "quiz": {
      const [quiz] = await db.select().from(schema.quizzes).where(eq(schema.quizzes.id, input.quizId ?? ""));
      if (!quiz || quiz.status === "draft") fail(404, "This quiz isn't available");
      if (effectiveStatus(quiz) === "closed") fail(410, "This quiz has closed");
      courseId = quiz.courseId;
      quizId = quiz.id;
      questionIds = await liveQuizQuestionIds(quiz);
      timeLimitSec = quiz.timeLimitMin * 60;
      negativeMark = quiz.negativeMark;
      break;
    }
    case "drill": {
      if (!courseId) fail(422, "courseId is required");
      const size = input.size ?? 10;
      let pool = (
        await db.select({ id: questions.id, topicId: questions.topicId }).from(questions)
          .where(and(eq(questions.courseId, courseId), liveQuestion, eq(questions.answerVerified, true)))
      );
      if (input.filter === "unseen") {
        const seen = await seenIds(user.id, courseId);
        const unseen = pool.filter((q) => !seen.has(q.id));
        if (unseen.length >= size) pool = unseen;
      } else if (input.filter === "weak") {
        const mastery = await topicMastery(user.id, courseId);
        const weak = pool.filter((q) => q.topicId && (mastery.get(q.topicId) ?? 1) < 0.6);
        if (weak.length >= size) pool = weak;
      }
      questionIds = sample(pool.map((q) => q.id), size);
      timeLimitSec = DRILL_SIZES[size];
      break;
    }
    case "topic": {
      if (!input.topicId) fail(422, "topicId is required");
      // Topic practice may include AI-suggested keys that aren't verified yet; they're labelled in review.
      const pool = await db.select({ id: questions.id, courseId: questions.courseId }).from(questions)
        .where(and(eq(questions.topicId, input.topicId), liveQuestion, isNotNull(questions.correctOption)));
      if (!pool.length) fail(404, "No questions in this topic yet");
      courseId = pool[0].courseId;
      const seen = await seenIds(user.id, courseId);
      const ordered = [...shuffle(pool.filter((q) => !seen.has(q.id))), ...shuffle(pool.filter((q) => seen.has(q.id)))];
      questionIds = ordered.slice(0, 20).map((q) => q.id);
      shuffleQuestions = false;
      break;
    }
    case "retry": {
      if (!courseId) fail(422, "courseId is required");
      questionIds = sample(await mistakeIds(user.id, courseId), 20);
      if (!questionIds.length) fail(404, "Nothing to retry yet");
      break;
    }
    case "daily": {
      if (!courseId) fail(422, "courseId is required");
      dailyDate = lagosDate();
      const [already] = await db.select({ id: attempts.id }).from(attempts)
        .where(and(eq(attempts.userId, user.id), eq(attempts.courseId, courseId), eq(attempts.mode, "daily"), eq(attempts.dailyDate, dailyDate)));
      if (already) fail(409, "You've already played today's challenge");
      let dc: { questionIds: string[] } | null | undefined = (await db.select().from(dailyChallenges).where(and(eq(dailyChallenges.courseId, courseId), eq(dailyChallenges.date, dailyDate))))[0];
      dc ??= await pickDailyChallenge(courseId, dailyDate);
      if (!dc) fail(404, "No daily challenge for this course yet");
      questionIds = dc.questionIds;
      timeLimitSec = DAILY_TIME_SEC;
      shuffleQuestions = false; // same order for everyone, so time is comparable
      break;
    }
  }

  if (!courseId) fail(422, "courseId is required");
  if (!questionIds.length) fail(404, "There are no questions to practise here yet");

  const order = shuffleQuestions ? shuffle(questionIds) : questionIds;
  const qs = await db.select({ id: questions.id, options: questions.options }).from(questions).where(inArray(questions.id, order));
  const optCount = new Map(qs.map((q) => [q.id, q.options.length]));
  const optionOrders = order.map((id) => shuffle(Array.from({ length: optCount.get(id) ?? 4 }, (_, i) => i)));

  const startedAt = new Date();
  const [attempt] = await db
    .insert(attempts)
    .values({
      userId: user.id,
      mode: input.mode,
      courseId,
      paperId,
      topicId: input.topicId ?? null,
      challengeId,
      quizId,
      dailyDate,
      questionIds: order,
      optionOrders,
      negativeMark,
      timeLimitSec,
      startedAt,
      deadlineAt: timeLimitSec ? new Date(startedAt.getTime() + timeLimitSec * 1000) : null,
    })
    .returning();
  return attempt;
}

/** Picks 10 verified questions spread across topics for a course's daily challenge. */
export async function pickDailyChallenge(courseId: string, date: string) {
  const pool = await db.select({ id: questions.id, topicId: questions.topicId }).from(questions)
    .where(and(eq(questions.courseId, courseId), liveQuestion, eq(questions.answerVerified, true)));
  if (pool.length < DAILY_SIZE) return null;
  const byTopic = new Map<string, string[]>();
  for (const q of shuffle(pool)) {
    const k = q.topicId ?? "none";
    byTopic.set(k, [...(byTopic.get(k) ?? []), q.id]);
  }
  const picked: string[] = [];
  while (picked.length < DAILY_SIZE) {
    for (const ids of byTopic.values()) {
      const id = ids.shift();
      if (id && picked.length < DAILY_SIZE) picked.push(id);
    }
  }
  const [row] = await db.insert(dailyChallenges).values({ courseId, date, questionIds: picked }).onConflictDoNothing().returning();
  return row ?? (await db.select().from(dailyChallenges).where(and(eq(dailyChallenges.courseId, courseId), eq(dailyChallenges.date, date))))[0];
}

/** What the student sees during a session: options in shuffled order, keyed by original index. */
export function toSessionQuestion(q: Question, optionOrder: number[]) {
  return {
    id: q.id,
    text: q.text,
    options: optionOrder.map((i) => ({ key: i, text: q.options[i] })),
    imageUrl: publicImageUrl(q.imagePath),
    imageAlt: q.imageAlt,
    imageBytes: q.imageBytes,
    topicId: q.topicId,
  };
}

/** Full question with key and explanation: only after submit, or in offline bundles. */
export function toReviewQuestion(q: Question) {
  return {
    id: q.id,
    text: q.text,
    options: q.options,
    correctOption: q.correctOption,
    answerVerified: q.answerVerified,
    explanation: q.explanation,
    trap: q.trap,
    workedSteps: q.workedSteps,
    imageUrl: publicImageUrl(q.imagePath),
    imageAlt: q.imageAlt,
    topicId: q.topicId,
    difficulty: q.difficulty,
  };
}

export async function loadQuestions(ids: string[]) {
  if (!ids.length) return new Map<string, Question>();
  const rows = await db.select().from(questions).where(inArray(questions.id, ids));
  return new Map(rows.map((q) => [q.id, q]));
}

export async function courseOf(courseId: string) {
  const [c] = await db.select().from(courses).where(eq(courses.id, courseId));
  return c;
}
