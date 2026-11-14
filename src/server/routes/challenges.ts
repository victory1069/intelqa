import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail, parse } from "../lib/http";
import { shortCode } from "../lib/random";
import { percentOf } from "../services/scoring";
import type { AppEnv } from "../types";

const { challenges, attempts, papers, courses, users, departments, attemptAnswers, questions, topics } = schema;
const CHALLENGE_DAYS = 7;

/** Public: a friend opens the link before having an account. */
export const publicChallengeRoutes = new Hono<AppEnv>();
export const challengeRoutes = new Hono<AppEnv>();

async function bestAttempt(userId: string, paperId: string) {
  const [a] = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.userId, userId), eq(attempts.paperId, paperId), isNotNull(attempts.submittedAt)))
    .orderBy(desc(attempts.score), attempts.timeTakenSec)
    .limit(1);
  return a ?? null;
}

/** GET /challenges/:code — no sign-in needed. */
publicChallengeRoutes.get("/:code", async (c) => {
  const [row] = await db
    .select({ ch: challenges, paper: papers, course: courses, creator: users, dept: departments })
    .from(challenges)
    .innerJoin(papers, eq(papers.id, challenges.paperId))
    .innerJoin(courses, eq(courses.id, papers.courseId))
    .innerJoin(users, eq(users.id, challenges.creatorId))
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(challenges.code, c.req.param("code")));
  if (!row) fail(404, "This challenge doesn't exist");
  const target = row.ch.creatorAttemptId
    ? (await db.select().from(attempts).where(eq(attempts.id, row.ch.creatorAttemptId)))[0]
    : null;
  const count = await db.$count(schema.paperQuestions, eq(schema.paperQuestions.paperId, row.paper.id));
  return c.json({
    code: row.ch.code,
    expired: row.ch.expiresAt < new Date(),
    expiresAt: row.ch.expiresAt,
    creator: { name: row.creator.displayName, department: row.dept?.name ?? null },
    course: { id: row.course.id, code: row.course.code, title: row.course.title },
    paper: { id: row.paper.id, session: row.paper.session, examType: row.paper.examType, timeLimitMin: row.paper.timeLimitMin, questions: count },
    target: target ? { score: target.score, maxScore: target.maxScore, timeTakenSec: target.timeTakenSec } : null,
  });
});

/** POST /challenges { paperId } — create a link carrying your best score on that paper. */
challengeRoutes.post("/", async (c) => {
  const user = c.get("user");
  const { paperId } = parse(z.object({ paperId: z.string().uuid() }), await c.req.json());
  const best = await bestAttempt(user.id, paperId);
  if (!best) fail(409, "Sit this paper first, so your friend has a score to beat");
  const [ch] = await db
    .insert(challenges)
    .values({ code: shortCode(5), creatorId: user.id, paperId, creatorAttemptId: best.id, expiresAt: new Date(Date.now() + CHALLENGE_DAYS * 864e5) })
    .returning();
  return c.json({ code: ch.code, expiresAt: ch.expiresAt, best: { score: best.score, maxScore: best.maxScore, timeTakenSec: best.timeTakenSec } }, 201);
});

/** GET /challenges/:code/compare — both results side by side, by topic. */
challengeRoutes.get("/:code/compare", async (c) => {
  const user = c.get("user");
  const [ch] = await db.select().from(challenges).where(eq(challenges.code, c.req.param("code")));
  if (!ch) fail(404, "Challenge not found");
  const [creator] = await db.select().from(users).where(eq(users.id, ch.creatorId));
  const mine = (await db.select().from(attempts)
    .where(and(eq(attempts.userId, user.id), eq(attempts.challengeId, ch.id), isNotNull(attempts.submittedAt)))
    .orderBy(desc(attempts.submittedAt)).limit(1))[0] ?? await bestAttempt(user.id, ch.paperId);
  const theirs = ch.creatorAttemptId ? (await db.select().from(attempts).where(eq(attempts.id, ch.creatorAttemptId)))[0] : null;

  async function byTopic(attemptId: string | undefined) {
    if (!attemptId) return new Map<string, { correct: number; total: number }>();
    const rows = await db.execute<{ name: string; correct: number; total: number }>(sql`
      select coalesce(t.name, 'Other') as name, count(*) filter (where aa.correct)::int as correct, count(*)::int as total
      from attempts a
      cross join lateral jsonb_array_elements_text(a.question_ids) as qid
      join ${questions} q on q.id = qid::uuid
      left join ${topics} t on t.id = q.topic_id
      left join ${attemptAnswers} aa on aa.attempt_id = a.id and aa.question_id = q.id
      where a.id = ${attemptId}
      group by t.name
    `);
    return new Map(Array.from(rows).map((r) => [r.name, { correct: Number(r.correct), total: Number(r.total) }]));
  }
  const [mt, tt] = await Promise.all([byTopic(mine?.id), byTopic(theirs?.id)]);
  const names = [...new Set([...mt.keys(), ...tt.keys()])];
  const side = (a: typeof mine | null | undefined) => (a ? { score: a.score, maxScore: a.maxScore, percent: percentOf(a.score ?? 0, a.maxScore ?? 1), timeTakenSec: a.timeTakenSec } : null);

  return c.json({
    you: side(mine),
    them: { name: creator.displayName, ...side(theirs ?? null) },
    topics: names.map((name) => ({ name, you: mt.get(name) ?? null, them: tt.get(name) ?? null })),
    paperId: ch.paperId,
  });
});
