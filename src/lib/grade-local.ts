"use client";
import { odb, type OfflineAttempt, type OfflineQuestion } from "./offline";

/** Questions of a downloaded course, by id. */
export async function bundleQuestions(courseId: string) {
  const b = await odb().courses.get(courseId);
  const map = new Map<string, OfflineQuestion>();
  b?.data.papers.forEach((p) => p.questions.forEach((q) => map.set(q.id, q)));
  return { bundle: b, map };
}

/** Provisional score from the downloaded key. The server re-grades on sync. */
export function gradeLocally(a: OfflineAttempt, map: Map<string, OfflineQuestion>) {
  let correct = 0, wrong = 0, skipped = 0;
  for (const id of a.questionIds) {
    const choice = a.answers[id]?.choice;
    const key = map.get(id)?.correctOption;
    if (choice == null) skipped++;
    else if (choice === key) correct++;
    else wrong++;
  }
  const score = Math.round((correct - wrong * a.negativeMark) * 100) / 100;
  return { score, maxScore: a.questionIds.length, correct, wrong, skipped };
}
