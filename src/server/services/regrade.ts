import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { recomputeCourseScore } from "./scoring";

const { attempts, attemptAnswers, questions } = schema;

/**
 * After an admin changes a question's answer key: fix every recorded answer, re-total each
 * affected attempt (keeping its negative marking), and recompute course scores.
 * XP already awarded is left alone; only scores and ranks move.
 */
export async function regradeQuestion(questionId: string) {
  const [q] = await db.select().from(questions).where(eq(questions.id, questionId));
  if (!q) return { attempts: 0, students: 0, improved: 0, improvedUsers: [] as string[], changedUsers: [] as string[] };

  return db.transaction(async (tx) => {
    await tx
      .update(attemptAnswers)
      .set({ correct: q.correctOption == null ? false : sql`${attemptAnswers.chosenOption} = ${q.correctOption}` })
      .where(and(eq(attemptAnswers.questionId, questionId), isNotNull(attemptAnswers.chosenOption)));

    const affected = await tx
      .selectDistinct({ id: attempts.id, userId: attempts.userId, courseId: attempts.courseId, before: attempts.score })
      .from(attempts)
      .innerJoin(attemptAnswers, eq(attemptAnswers.attemptId, attempts.id))
      .where(and(eq(attemptAnswers.questionId, questionId), isNotNull(attempts.submittedAt)));
    if (!affected.length) return { attempts: 0, students: 0, improved: 0, improvedUsers: [] as string[], changedUsers: [] as string[] };

    await tx.execute(sql`
      update attempts a set
        correct_count = s.correct,
        wrong_count = s.wrong,
        score = round((s.correct - s.wrong * a.negative_mark)::numeric, 2)
      from (
        select aa.attempt_id,
               count(*) filter (where aa.correct)::int as correct,
               count(*) filter (where aa.chosen_option is not null and not coalesce(aa.correct, false))::int as wrong
        from attempt_answers aa
        where aa.attempt_id in (${sql.join(affected.map((a) => sql`${a.id}::uuid`), sql`, `)})
        group by aa.attempt_id
      ) s
      where a.id = s.attempt_id
    `);

    const after = await tx
      .select({ id: attempts.id, score: attempts.score })
      .from(attempts)
      .where(inArray(attempts.id, affected.map((a) => a.id)));
    const afterById = new Map(after.map((a) => [a.id, a.score ?? 0]));
    const improved = affected.filter((a) => (afterById.get(a.id) ?? 0) > (a.before ?? 0)).length;

    const pairs = new Map(affected.map((a) => [`${a.userId}:${a.courseId}`, a]));
    for (const a of pairs.values()) await recomputeCourseScore(tx, a.userId, a.courseId);

    const improvedUsers = [...new Set(affected.filter((a) => (afterById.get(a.id) ?? 0) > (a.before ?? 0)).map((a) => a.userId))];
    const changedUsers = [...new Set(affected.filter((a) => (afterById.get(a.id) ?? 0) !== (a.before ?? 0)).map((a) => a.userId))];
    return { attempts: affected.length, students: new Set(affected.map((a) => a.userId)).size, improved, improvedUsers, changedUsers };
  });
}
