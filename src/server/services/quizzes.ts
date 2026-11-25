import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail } from "../lib/http";
import { shuffle } from "../lib/random";

const { questions } = schema;

/** Same rule as sessions' liveQuestion; repeated here because sessions imports this module. */
const liveQuestion = and(eq(questions.status, "approved"), eq(questions.autoHidden, false));
export type Quiz = typeof schema.quizzes.$inferSelect;

/** Questions a quiz may draw: approved, not hidden, with a checked answer. */
const drawable = and(liveQuestion, eq(questions.answerVerified, true), isNotNull(questions.correctOption));

/** The draw pool for a course, optionally narrowed to some topics. */
async function poolOf(courseId: string, topicIds: string[]) {
  return db
    .select({ id: questions.id, topicId: questions.topicId })
    .from(questions)
    .where(and(eq(questions.courseId, courseId), drawable, topicIds.length ? inArray(questions.topicId, topicIds) : undefined));
}

/** How many questions each topic can give, for the "New quiz" form. Key "none" = untagged. */
export async function poolCounts(courseId: string) {
  const rows = await db
    .select({ topicId: questions.topicId, n: sql<number>`count(*)::int` })
    .from(questions)
    .where(and(eq(questions.courseId, courseId), drawable))
    .groupBy(questions.topicId);
  return Object.fromEntries(rows.map((r) => [r.topicId ?? "none", Number(r.n)])) as Record<string, number>;
}

/**
 * Draws `count` questions at random, spread evenly across topics: one from each topic in turn
 * (topics in random order), so a 25-question test from 5 topics gets about 5 from each.
 */
export async function drawQuestions(courseId: string, topicIds: string[], count: number, exclude: string[] = []) {
  const skip = new Set(exclude);
  const pool = (await poolOf(courseId, topicIds)).filter((q) => !skip.has(q.id));
  if (pool.length < count) {
    fail(422, pool.length
      ? `Only ${pool.length} checked question${pool.length === 1 ? " is" : "s are"} available${topicIds.length ? " in those topics" : " for this course"}. Pick fewer questions${topicIds.length ? " or more topics" : ""}.`
      : `There are no checked questions${topicIds.length ? " in those topics" : " for this course"} yet. Publish a paper first.`);
  }
  const byTopic = new Map<string, string[]>();
  for (const q of shuffle(pool)) {
    const k = q.topicId ?? "none";
    byTopic.set(k, [...(byTopic.get(k) ?? []), q.id]);
  }
  const groups = shuffle([...byTopic.values()]);
  const picked: string[] = [];
  while (picked.length < count) {
    for (const ids of groups) {
      const id = ids.shift();
      if (id && picked.length < count) picked.push(id);
    }
  }
  return picked;
}

/** A live test past its closing date reads as closed. */
export function effectiveStatus(q: Pick<Quiz, "status" | "closesAt">, now = new Date()) {
  return q.status === "live" && q.closesAt && q.closesAt < now ? "closed" : q.status;
}

/** Questions in the test that have since been hidden or unapproved are dropped from new sittings. */
export async function liveQuizQuestionIds(quiz: Quiz) {
  if (!quiz.questionIds.length) return [];
  const rows = await db.select({ id: questions.id }).from(questions).where(and(inArray(questions.id, quiz.questionIds), liveQuestion));
  const ok = new Set(rows.map((r) => r.id));
  return quiz.questionIds.filter((id) => ok.has(id));
}
