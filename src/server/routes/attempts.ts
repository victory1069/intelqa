import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail, parse } from "../lib/http";
import { DEADLINE_GRACE_SEC, gradeAttempt, percentOf } from "../services/scoring";
import { courseOf, loadQuestions, startAttempt, toReviewQuestion, toSessionQuestion } from "../services/sessions";
import { courseBoard, courseRank } from "../services/leaderboard";
import { notify } from "../services/notify";
import { MODES } from "@/shared/game";
import type { AppEnv } from "../types";

const { attempts, attemptAnswers, questions, topics, papers, bookmarks } = schema;

export const attemptRoutes = new Hono<AppEnv>();

async function ownAttempt(id: string, userId: string) {
  const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
  if (!a || a.userId !== userId) fail(404, "Session not found");
  return a;
}

const isUntimedPractice = (mode: string) => mode === "topic" || mode === "retry";

/** GET /attempts?status=open|done — unfinished sessions (for Resume) or history. */
attemptRoutes.get("/", async (c) => {
  const user = c.get("user");
  const status = c.req.query("status") ?? "done";
  const rows = await db
    .select({ a: attempts, paper: papers, quizTitle: schema.quizzes.title })
    .from(attempts)
    .leftJoin(papers, eq(papers.id, attempts.paperId))
    .leftJoin(schema.quizzes, eq(schema.quizzes.id, attempts.quizId))
    .where(
      and(
        eq(attempts.userId, user.id),
        status === "open" ? isNull(attempts.submittedAt) : sql`${attempts.submittedAt} is not null`,
      ),
    )
    .orderBy(desc(attempts.startedAt))
    .limit(status === "open" ? 5 : 50);

  const now = Date.now();
  const out = [];
  for (const { a, paper, quizTitle } of rows) {
    const course = await courseOf(a.courseId);
    const [{ answered }] = await db
      .select({ answered: sql<number>`count(*) filter (where ${attemptAnswers.chosenOption} is not null)::int` })
      .from(attemptAnswers)
      .where(eq(attemptAnswers.attemptId, a.id));
    // An exam left open past its deadline is graded now, as the timer would have done.
    if (status === "open" && a.deadlineAt && a.deadlineAt.getTime() + DEADLINE_GRACE_SEC * 1000 < now) {
      await gradeAttempt(a.id, { now: a.deadlineAt, autoSubmitted: true });
      continue;
    }
    out.push({
      id: a.id,
      mode: a.mode,
      courseCode: course.code,
      paper: paper ? { session: paper.session, examType: paper.examType } : null,
      quizTitle,
      answered,
      total: a.questionIds.length,
      startedAt: a.startedAt,
      deadlineAt: a.deadlineAt,
      submittedAt: a.submittedAt,
      score: a.score,
      maxScore: a.maxScore,
      percent: a.submittedAt ? percentOf(a.score ?? 0, a.maxScore ?? 1) : null,
    });
  }
  return c.json({ attempts: out });
});

const StartBody = z.object({
  mode: z.enum(["exam", "drill", "topic", "retry", "daily", "challenge", "quiz"]),
  courseId: z.string().uuid().optional(),
  paperId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  size: z.union([z.literal(10), z.literal(20)]).optional(),
  filter: z.enum(["all", "weak", "unseen"]).optional(),
  challengeCode: z.string().optional(),
  quizId: z.string().uuid().optional(),
});

/** POST /attempts — start a session. Returns questions in shuffled order, no answers. */
attemptRoutes.post("/", async (c) => {
  const body = parse(StartBody, await c.req.json());
  const attempt = await startAttempt(c.get("user"), body);
  return c.json(await sessionPayload(attempt.id, c.get("user").id), 201);
});

async function sessionPayload(attemptId: string, userId: string) {
  const a = await ownAttempt(attemptId, userId);
  const qs = await loadQuestions(a.questionIds);
  const answers = await db.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, a.id));
  const course = await courseOf(a.courseId);
  const [paper] = a.paperId ? await db.select().from(papers).where(eq(papers.id, a.paperId)) : [];
  const [quiz] = a.quizId ? await db.select().from(schema.quizzes).where(eq(schema.quizzes.id, a.quizId)) : [];
  return {
    id: a.id,
    mode: a.mode,
    course: { id: course.id, code: course.code, title: course.title },
    paper: paper ? { id: paper.id, session: paper.session, examType: paper.examType, optionCount: paper.optionCount } : null,
    quiz: quiz ? { id: quiz.id, title: quiz.title } : null,
    negativeMark: a.negativeMark,
    startedAt: a.startedAt,
    deadlineAt: a.deadlineAt,
    serverNow: new Date(),
    submittedAt: a.submittedAt,
    instantFeedback: isUntimedPractice(a.mode),
    questions: a.questionIds.map((id, i) => toSessionQuestion(qs.get(id)!, a.optionOrders[i])),
    answers: answers.map((x) => ({ questionId: x.questionId, choice: x.chosenOption, flagged: x.flagged, timeSpentMs: x.timeSpentMs })),
  };
}

/** GET /attempts/:id — resume a session (timer keeps running server-side). */
attemptRoutes.get("/:id", async (c) => c.json(await sessionPayload(c.req.param("id"), c.get("user").id)));

const SaveBody = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        choice: z.number().int().min(0).max(4).nullable(),
        flagged: z.boolean().optional(),
        timeSpentMs: z.number().int().min(0).optional(),
      }),
    )
    .max(100),
});

/** PATCH /attempts/:id — save answers as they go. Last write wins per question. */
attemptRoutes.patch("/:id", async (c) => {
  const a = await ownAttempt(c.req.param("id"), c.get("user").id);
  if (a.submittedAt) fail(409, "This session is already submitted");
  if (a.deadlineAt && Date.now() > a.deadlineAt.getTime() + DEADLINE_GRACE_SEC * 1000) {
    await gradeAttempt(a.id, { now: a.deadlineAt, autoSubmitted: true });
    fail(410, "Time's up. Your answers were submitted.");
  }
  const { answers } = parse(SaveBody, await c.req.json());
  const allowed = new Set(a.questionIds);
  for (const ans of answers) {
    if (!allowed.has(ans.questionId)) continue;
    await db
      .insert(attemptAnswers)
      .values({
        attemptId: a.id,
        questionId: ans.questionId,
        chosenOption: ans.choice,
        flagged: ans.flagged ?? false,
        timeSpentMs: ans.timeSpentMs ?? 0,
      })
      .onConflictDoUpdate({
        target: [attemptAnswers.attemptId, attemptAnswers.questionId],
        set: {
          chosenOption: ans.choice,
          flagged: ans.flagged ?? false,
          timeSpentMs: ans.timeSpentMs ?? 0,
          answeredAt: new Date(),
        },
      });
  }
  return c.json({ ok: true, savedAt: new Date() });
});

/** POST /attempts/:id/check — instant feedback, topic practice and retry only. Locks the answer. */
attemptRoutes.post("/:id/check", async (c) => {
  const a = await ownAttempt(c.req.param("id"), c.get("user").id);
  if (!isUntimedPractice(a.mode)) fail(403, "Answers are shown after you submit");
  const { questionId, choice } = parse(
    z.object({ questionId: z.string().uuid(), choice: z.number().int().min(0).max(4).nullable() }),
    await c.req.json(),
  );
  if (!a.questionIds.includes(questionId)) fail(404, "Question not in this session");
  const [q] = await db.select().from(questions).where(eq(questions.id, questionId));
  const correct = choice != null && choice === q.correctOption;
  await db
    .insert(attemptAnswers)
    .values({ attemptId: a.id, questionId, chosenOption: choice, correct })
    .onConflictDoNothing(); // first answer counts
  return c.json({ correct, question: toReviewQuestion(q), xp: choice == null ? 0 : 1 + (correct ? 2 : 0) });
});

/** POST /attempts/:id/submit — grade on the server, award XP, update stats. */
attemptRoutes.post("/:id/submit", async (c) => {
  const a = await ownAttempt(c.req.param("id"), c.get("user").id);
  const now = new Date();
  const late = a.deadlineAt && now > a.deadlineAt;
  const result = await gradeAttempt(a.id, { now: late ? a.deadlineAt! : now, autoSubmitted: !!late });
  afterSubmit(a.id, c.get("user"), result).catch((e) => console.error("[after-submit]", e));
  return c.json(result);
});

/** Social side effects of a submit: challenge results and friends who just got passed. Best effort. */
async function afterSubmit(attemptId: string, user: { id: string; displayName: string | null }, result: Awaited<ReturnType<typeof gradeAttempt>>) {
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  const name = user.displayName ?? "A friend";
  const course = await courseOf(a.courseId);

  if (a.challengeId) {
    const [ch] = await db.select().from(schema.challenges).where(eq(schema.challenges.id, a.challengeId));
    const [target] = ch?.creatorAttemptId ? await db.select().from(attempts).where(eq(attempts.id, ch.creatorAttemptId)) : [];
    if (ch && ch.creatorId !== user.id && target) {
      const won = result.score > (target.score ?? 0) || (result.score === target.score && result.timeTakenSec < (target.timeTakenSec ?? Infinity));
      await notify([ch.creatorId], {
        kind: "challenge",
        title: won ? `${name} beat your ${course.code} score` : `${name} took your ${course.code} challenge`,
        body: `${result.score}/${result.maxScore} against your ${target.score}/${target.maxScore}.${won ? " Rematch?" : " You're still ahead."}`,
        url: `/c/${ch.code}`,
      });
    }
  }

  // "Aisha passed you on GST 111": friends only, and only when the student actually moved up.
  const r = result.rank;
  if (r?.before && r.after && r.after < r.before) {
    const friends = await db.select({ id: schema.friendships.friendId }).from(schema.friendships).where(eq(schema.friendships.userId, user.id));
    const passed: string[] = [];
    for (const f of friends) {
      const fr = await courseRank(a.courseId, f.id);
      if (fr && fr.rank > r.after && fr.rank <= r.before) passed.push(f.id);
    }
    if (passed.length) {
      await notify(passed, { kind: "rank", title: `${name} passed you on ${course.code}`, body: "A quick drill could win your place back.", url: "/ranks" });
    }
  }
}

/** GET /attempts/:id/result — score, topic breakdown, rank and the person just ahead. */
attemptRoutes.get("/:id/result", async (c) => {
  const user = c.get("user");
  const a = await ownAttempt(c.req.param("id"), user.id);
  if (!a.submittedAt) fail(409, "Submit first");

  const qs = await loadQuestions(a.questionIds);
  const answers = await db.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, a.id));
  const byQ = new Map(answers.map((x) => [x.questionId, x]));
  const topicRows = await db.select().from(topics).where(eq(topics.courseId, a.courseId));
  const topicName = new Map(topicRows.map((t) => [t.id, t.name]));

  const breakdown = new Map<string, { topicId: string | null; name: string; correct: number; total: number }>();
  for (const qid of a.questionIds) {
    const q = qs.get(qid)!;
    const k = q.topicId ?? "none";
    const row = breakdown.get(k) ?? { topicId: q.topicId, name: topicName.get(q.topicId ?? "") ?? "Other", correct: 0, total: 0 };
    row.total++;
    if (byQ.get(qid)?.correct) row.correct++;
    breakdown.set(k, row);
  }

  const course = await courseOf(a.courseId);
  let rank: { position: number; total: number; ahead: { name: string; gap: number } | null } | null = null;
  let rankedAttempts = 0;
  if (MODES[a.mode].ranked) {
    const board = await courseBoard(a.courseId, user.id);
    if (board.me) {
      const rows = [...board.top, ...board.around];
      const idx = rows.findIndex((r) => r.me);
      const above = idx > 0 ? rows[idx - 1] : null;
      rank = { position: board.me.rank, total: board.total, ahead: above ? { name: above.name, gap: above.rank === board.me.rank ? 0 : board.me.rank - above.rank } : null };
    }
    const [stat] = await db.select().from(schema.userCourseStats)
      .where(and(eq(schema.userCourseStats.userId, user.id), eq(schema.userCourseStats.courseId, a.courseId)));
    rankedAttempts = stat?.rankedAttempts ?? 0;
  }

  return c.json({
    id: a.id,
    mode: a.mode,
    course: { id: course.id, code: course.code, title: course.title },
    paperId: a.paperId,
    quizId: a.quizId,
    score: a.score,
    maxScore: a.maxScore,
    percent: percentOf(a.score ?? 0, a.maxScore ?? 1),
    correct: a.correctCount,
    wrong: a.wrongCount,
    skipped: a.skippedCount,
    negativeMark: a.negativeMark,
    timeTakenSec: a.timeTakenSec,
    xpEarned: a.xpEarned,
    autoSubmitted: a.autoSubmitted,
    flagged: a.flagged,
    reviewStatus: a.reviewStatus,
    offline: a.offline,
    rank,
    rankedAttempts,
    breakdown: [...breakdown.values()].sort((x, y) => x.correct / x.total - y.correct / y.total),
  });
});

/** GET /attempts/:id/review?filter=missed|all|flagged — answers + explanations, only after submit. */
attemptRoutes.get("/:id/review", async (c) => {
  const user = c.get("user");
  const a = await ownAttempt(c.req.param("id"), user.id);
  if (!a.submittedAt) fail(403, "Answers are shown after you submit");
  const filter = c.req.query("filter") ?? "missed";
  const qs = await loadQuestions(a.questionIds);
  const answers = await db.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, a.id));
  const byQ = new Map(answers.map((x) => [x.questionId, x]));
  const marked = new Set(
    (await db.select({ id: bookmarks.questionId }).from(bookmarks)
      .where(and(eq(bookmarks.userId, user.id), inArray(bookmarks.questionId, a.questionIds)))).map((b) => b.id),
  );
  const topicRows = await db.select().from(topics).where(eq(topics.courseId, a.courseId));
  const topicName = new Map(topicRows.map((t) => [t.id, t.name]));

  const items = a.questionIds
    .map((qid, i) => {
      const ans = byQ.get(qid);
      const q = qs.get(qid)!;
      return {
        number: i + 1,
        chosen: ans?.chosenOption ?? null,
        correct: ans?.correct ?? false,
        flagged: ans?.flagged ?? false,
        bookmarked: marked.has(qid),
        topicName: topicName.get(q.topicId ?? "") ?? null,
        question: toReviewQuestion(q),
      };
    })
    .filter((it) => (filter === "all" ? true : filter === "flagged" ? it.flagged : !it.correct));

  return c.json({ total: a.questionIds.length, filter, items });
});

const SyncBody = z.object({
  attempts: z
    .array(
      z.object({
        clientId: z.string().min(8).max(64),
        mode: z.enum(["exam", "drill", "topic", "retry"]),
        courseId: z.string().uuid(),
        paperId: z.string().uuid().nullable().optional(),
        questionIds: z.array(z.string().uuid()).min(1).max(100),
        answers: z.array(z.object({ questionId: z.string().uuid(), choice: z.number().int().min(0).max(4).nullable(), timeSpentMs: z.number().int().min(0).optional() })),
        startedAt: z.string().datetime(),
        submittedAt: z.string().datetime(),
        timeTakenSec: z.number().int().min(1),
      }),
    )
    .max(50),
});

/**
 * POST /attempts/sync — upload sessions finished offline. The server re-grades them with its
 * own key. They earn XP but never move course-score boards (the bundle contained the answers).
 */
attemptRoutes.post("/sync", async (c) => {
  const user = c.get("user");
  const { attempts: incoming } = parse(SyncBody, await c.req.json());
  const results = [];
  for (const inc of incoming) {
    const [existing] = await db.select().from(attempts).where(eq(attempts.clientId, inc.clientId));
    if (existing) {
      results.push({ clientId: inc.clientId, attemptId: existing.id, duplicate: true });
      continue;
    }
    const [paper] = inc.paperId ? await db.select().from(papers).where(eq(papers.id, inc.paperId)) : [];
    const qs = await loadQuestions(inc.questionIds);
    const validIds = inc.questionIds.filter((id) => qs.get(id)?.courseId === inc.courseId);
    if (!validIds.length) continue;
    const [a] = await db
      .insert(attempts)
      .values({
        userId: user.id,
        mode: inc.mode,
        courseId: inc.courseId,
        paperId: paper?.id ?? null,
        questionIds: validIds,
        optionOrders: validIds.map((id) => qs.get(id)!.options.map((_, i) => i)),
        negativeMark: paper?.negativeMark ?? 0,
        timeLimitSec: paper ? paper.timeLimitMin * 60 : null,
        startedAt: new Date(inc.startedAt),
        offline: true,
        clientId: inc.clientId,
      })
      .returning();
    const valid = new Set(validIds);
    const answerRows = inc.answers.filter((x) => valid.has(x.questionId));
    if (answerRows.length) {
      await db.insert(attemptAnswers).values(
        answerRows.map((x) => ({ attemptId: a.id, questionId: x.questionId, chosenOption: x.choice, timeSpentMs: x.timeSpentMs ?? 0, answeredAt: new Date(inc.submittedAt) })),
      ).onConflictDoNothing();
    }
    const r = await gradeAttempt(a.id, { now: new Date(inc.submittedAt), clientTimeTakenSec: inc.timeTakenSec });
    results.push({ clientId: inc.clientId, attemptId: a.id, score: r.score, maxScore: r.maxScore, xp: r.xp.earned });
  }
  const xp = results.reduce((s, r) => s + ("xp" in r ? (r.xp ?? 0) : 0), 0);
  return c.json({ synced: results, xp });
});
