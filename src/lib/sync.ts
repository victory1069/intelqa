"use client";
import { api, ApiError } from "./api";
import { odb, isOnline } from "./offline";

let running: Promise<{ synced: number; xp: number }> | null = null;

/**
 * Pushes everything saved on the phone:
 *  1. answers from online sessions that didn't reach the server (dropped connection)
 *  2. sessions taken fully offline, which the server re-grades and credits with XP
 */
export function syncAll(): Promise<{ synced: number; xp: number }> {
  running ??= doSync().finally(() => (running = null));
  return running;
}

async function doSync() {
  if (!isOnline()) return { synced: 0, xp: 0 };
  const db = odb();

  let submitted = 0;
  for (const m of await db.sessions.toArray()) {
    if (!m.dirty.length && !m.submitRequestedAt) continue;
    try {
      if (m.dirty.length) {
        await api(`/attempts/${m.attemptId}`, {
          method: "PATCH",
          body: { answers: m.dirty.map((questionId) => ({ questionId, ...m.answers[questionId] })) },
        });
        await db.sessions.update(m.attemptId, { dirty: [] });
      }
      if (m.submitRequestedAt) {
        await api(`/attempts/${m.attemptId}/submit`, { method: "POST" });
        await db.sessions.delete(m.attemptId);
        submitted++;
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.offline) return { synced: 0, xp: 0 };
      if (err.status === 409 || err.status === 410 || err.status === 404) await db.sessions.delete(m.attemptId);
    }
  }

  const pending = (await db.offlineAttempts.toArray()).filter((a) => a.submittedAt && !a.synced);
  if (!pending.length) return { synced: submitted, xp: 0 };
  try {
    const res = await api<{ synced: { clientId: string; attemptId: string }[]; xp: number }>("/attempts/sync", {
      method: "POST",
      body: {
        attempts: pending.map((a) => ({
          clientId: a.clientId,
          mode: a.mode,
          courseId: a.courseId,
          paperId: a.paperId,
          questionIds: a.questionIds,
          answers: Object.entries(a.answers).map(([questionId, v]) => ({ questionId, choice: v.choice, timeSpentMs: v.timeSpentMs })),
          startedAt: a.startedAt,
          submittedAt: a.submittedAt,
          timeTakenSec: a.timeTakenSec ?? 1,
        })),
      },
    });
    for (const s of res.synced) await db.offlineAttempts.update(s.clientId, { synced: true });
    return { synced: res.synced.length, xp: res.xp };
  } catch {
    return { synced: 0, xp: 0 };
  }
}
