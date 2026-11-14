import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { fail, parse } from "../lib/http";
import { askHistory, askRemaining, askUsedToday, streamAsk } from "../services/ask";
import type { AppEnv } from "../types";

const { questions, questionReports, courses, topics } = schema;

export const questionRoutes = new Hono<AppEnv>();

/** Three open reports on one question hide it until an admin reviews it. */
export const AUTO_HIDE_REPORTS = 3;

/** POST /questions/:id/report */
questionRoutes.post("/:id/report", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = parse(
    z.object({ reason: z.enum(["wrong_key", "unclear_explanation", "typo", "other"]), note: z.string().max(500).optional() }),
    await c.req.json(),
  );
  const [q] = await db.select({ id: questions.id }).from(questions).where(eq(questions.id, id));
  if (!q) fail(404, "Question not found");

  const [already] = await db
    .select({ id: questionReports.id })
    .from(questionReports)
    .where(and(eq(questionReports.questionId, id), eq(questionReports.userId, user.id), eq(questionReports.status, "open")));
  if (!already) await db.insert(questionReports).values({ questionId: id, userId: user.id, reason: body.reason, note: body.note });

  const [{ open }] = await db
    .select({ open: sql<number>`count(distinct ${questionReports.userId})::int` })
    .from(questionReports)
    .where(and(eq(questionReports.questionId, id), eq(questionReports.status, "open")));
  if (open >= AUTO_HIDE_REPORTS) await db.update(questions).set({ autoHidden: true }).where(eq(questions.id, id));

  return c.json({ ok: true, alreadyReported: !!already }, 201);
});

/**
 * Ask reveals the answer, so it only opens for a question the student has already seen the
 * answer to: answered in a submitted session, or checked in topic practice / retry.
 */
async function assertAnswerSeen(userId: string, questionId: string) {
  const [row] = await db.execute<{ ok: boolean }>(sql`
    select exists (
      select 1 from attempt_answers aa join attempts a on a.id = aa.attempt_id
      where a.user_id = ${userId} and aa.question_id = ${questionId}
        and (a.submitted_at is not null or a.mode in ('topic', 'retry'))
    ) as ok
  `);
  if (!row?.ok) fail(403, "Ask opens once you've seen this question's answer");
}

/** GET /questions/:id/ask — the question, past messages and today's allowance. */
questionRoutes.get("/:id/ask", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await assertAnswerSeen(user.id, id);
  const [q] = await db
    .select({
      id: questions.id,
      text: questions.text,
      options: questions.options,
      correctOption: questions.correctOption,
      courseCode: courses.code,
      topicId: questions.topicId,
      topicName: topics.name,
    })
    .from(questions)
    .innerJoin(courses, eq(courses.id, questions.courseId))
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .where(eq(questions.id, id));
  if (!q) fail(404, "Question not found");
  const used = await askUsedToday(user.id);
  return c.json({ question: q, messages: await askHistory(user.id, id), used, remaining: askRemaining(used), limit: env.ASK_DAILY_LIMIT });
});

/**
 * POST /questions/:id/ask — streams the reply as plain text. On failure the stream ends with
 * a line starting "\n[[error]]"; a failed reply doesn't count toward the daily limit.
 */
questionRoutes.post("/:id/ask", async (c) => {
  const user = c.get("user");
  const body = parse(
    z.object({ message: z.string().trim().min(1).max(600), chosenOption: z.number().int().min(0).max(4).nullable().optional() }),
    await c.req.json(),
  );
  await assertAnswerSeen(user.id, c.req.param("id"));
  if (askRemaining(await askUsedToday(user.id)) <= 0) fail(429, "You've used today's questions. Ask opens again at midnight.");

  return streamText(c, async (stream) => {
    try {
      await streamAsk({
        userId: user.id,
        questionId: c.req.param("id"),
        message: body.message,
        chosenOption: body.chosenOption ?? null,
        onText: async (d) => { await stream.write(d); },
      });
    } catch (e) {
      console.error("[ask]", e);
      await stream.write(`\n[[error]]${e instanceof Error ? e.message : "The reply didn't come through."}`);
    }
  });
});
