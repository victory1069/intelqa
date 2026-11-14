"use client";
import { api, ApiError, authHeaders } from "./api";
import { odb, isOnline, newClientId, type CourseBundle, type OfflineAttempt } from "./offline";
import type { CoursePage, Session } from "./types";
import { DRILL_SIZES } from "@/shared/game";

export type StartBody = {
  mode: "exam" | "drill" | "topic" | "retry" | "daily" | "challenge" | "quiz";
  courseId?: string;
  paperId?: string;
  topicId?: string;
  size?: 10 | 20;
  filter?: "all" | "weak" | "unseen";
  challengeCode?: string;
  quizId?: string;
};

/** Starts a session on the server. Returns the URL to open. */
export async function startOnline(body: StartBody) {
  const s = await api<Session>("/attempts", { method: "POST", body });
  return `/session?id=${s.id}`;
}

function shuffle<T>(a: T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/**
 * Starts a session from a downloaded course with no connection. Shuffled like an online exam;
 * graded on the phone now, re-graded by the server on sync (XP only, no course-score credit).
 */
export async function startOffline(bundle: CourseBundle, opts: { mode: "exam" | "drill" | "topic"; paperId?: string; size?: 10 | 20; topicId?: string }) {
  const all = bundle.data.papers.flatMap((p) => p.questions);
  const unique = [...new Map(all.map((q) => [q.id, q])).values()].filter((q) => q.correctOption != null);
  let ids: string[];
  let timeLimitSec: number | null = null;
  let negativeMark = 0;
  let title: string;
  const paper = opts.paperId ? bundle.data.papers.find((p) => p.paper.id === opts.paperId) : undefined;

  if (opts.mode === "exam" && paper) {
    ids = shuffle(paper.questions.filter((q) => q.answerVerified).map((q) => q.id));
    timeLimitSec = paper.paper.timeLimitMin * 60;
    negativeMark = paper.paper.negativeMark;
    title = `${bundle.code} · ${paper.paper.session}`;
  } else if (opts.mode === "topic" && opts.topicId) {
    ids = shuffle(unique.filter((q) => q.topicId === opts.topicId).map((q) => q.id)).slice(0, 20);
    title = `${bundle.code} · topic`;
  } else {
    const size = opts.size ?? 10;
    ids = shuffle(unique.filter((q) => q.answerVerified).map((q) => q.id)).slice(0, size);
    timeLimitSec = DRILL_SIZES[size];
    title = `${bundle.code} · Quick drill ${size}`;
  }
  const byId = new Map(unique.map((q) => [q.id, q]));
  const now = new Date();
  const attempt: OfflineAttempt = {
    clientId: newClientId(),
    mode: opts.mode === "topic" ? "topic" : opts.mode,
    courseId: bundle.courseId,
    courseCode: bundle.code,
    paperId: opts.mode === "exam" ? opts.paperId ?? null : null,
    title,
    questionIds: ids,
    optionOrders: ids.map((id) => shuffle(byId.get(id)!.options.map((_, i) => i))),
    answers: {},
    startedAt: now.toISOString(),
    deadlineAt: timeLimitSec ? new Date(now.getTime() + timeLimitSec * 1000).toISOString() : null,
    negativeMark,
    submittedAt: null,
    timeTakenSec: null,
    provisional: null,
    synced: false,
  };
  await odb().offlineAttempts.put(attempt);
  return `/play?c=${attempt.clientId}`;
}

export type PaperStatus = "waiting" | "saving" | "done";

/** E02: where a course download is up to. Byte counts are null when the server sent no Content-Length. */
export type DownloadProgress = {
  papers: { id: string; label: string; status: PaperStatus }[];
  /** 0-based index of the paper being saved. */
  current: number;
  /** Bytes received for the current paper, and its size when known. */
  loaded: number;
  size: number | null;
  /** Bytes received so far in this download, across papers. */
  received: number;
  pct: number;
};

const paperLabel = (p: { session: string; examType: string }) => `${p.session} · ${p.examType === "post_utme" ? "Post-UTME" : p.examType === "test" ? "Test" : "Exam"}`;

/** GET with byte progress: reads the body with a stream reader so progress is real when Content-Length is sent. */
async function fetchJsonWithProgress<T>(path: string, signal: AbortSignal | undefined, onBytes: (loaded: number, size: number | null) => void): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers: await authHeaders(), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "No connection. Check your data and try again.", true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, (body && typeof body.error === "string" && body.error) || `Request failed (${res.status})`);
  }
  // x-content-length is the uncompressed size from the API (Next streams route responses, dropping
  // Content-Length). A compressed body's Content-Length counts compressed bytes, which the reader never sees.
  const raw = Number(res.headers.get("x-content-length"));
  const len = Number(res.headers.get("content-length"));
  const size = raw > 0 ? raw : len > 0 && !res.headers.get("content-encoding") ? len : null;
  if (!res.body) {
    const text = await res.text();
    onBytes(text.length, size);
    return JSON.parse(text) as T;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onBytes(loaded, size && loaded <= size ? size : null);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "The connection dropped. Papers already saved are kept.", true);
  }
  const all = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(all)) as T;
}

const sizeOf = (data: CourseBundle["data"]) => new Blob([JSON.stringify(data)]).size;

/**
 * Downloads a course for offline use one paper at a time, saving after each, so progress is real
 * and a cancel or dropped connection keeps every paper already saved.
 */
export async function downloadCourse(courseId: string, opts: { signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void } = {}) {
  const { signal, onProgress } = opts;
  const page = await api<CoursePage>(`/catalog/courses/${courseId}`, { signal });
  const existing = await odb().courses.get(courseId).catch(() => undefined);
  const saved = new Map((existing?.data.papers ?? []).map((p) => [p.paper.id, p]));
  const fresh = new Set<string>();
  const list = page.papers.map((p) => ({ id: p.id, label: paperLabel(p), status: "waiting" as PaperStatus }));
  let doneBytes = 0;
  const report = (current: number, loaded: number, size: number | null) => {
    const part = size ? Math.min(1, loaded / size) : 0;
    onProgress?.({ papers: list.map((p) => ({ ...p })), current, loaded, size, received: doneBytes + loaded, pct: list.length ? Math.round(((fresh.size + part) / list.length) * 100) : 100 });
  };

  const save = async (complete: boolean) => {
    // In the server's order; on a full download, papers that were unpublished since are dropped.
    const papers = page.papers.map((p) => saved.get(p.id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (!complete) for (const [id, p] of saved) if (!page.papers.some((x) => x.id === id)) papers.push(p);
    const data: CourseBundle["data"] = {
      course: { id: page.course.id, code: page.course.code, title: page.course.title, optionCount: page.course.optionCount, negativeMark: page.course.negativeMark },
      topics: page.topics.map((t) => ({ id: t.id, name: t.name })),
      papers,
    };
    const bundle: CourseBundle = { courseId, code: page.course.code, title: page.course.title, bytes: sizeOf(data), at: Date.now(), data };
    await odb().courses.put(bundle);
    notifyDownloads();
    return bundle;
  };

  report(0, 0, null);
  let bundle: CourseBundle | null = null;
  for (let i = 0; i < list.length; i++) {
    list[i].status = "saving";
    report(i, 0, null);
    let got = 0;
    const paper = await fetchJsonWithProgress<CourseBundle["data"]["papers"][number]>(`/papers/${list[i].id}/offline`, signal, (loaded, size) => {
      got = loaded;
      report(i, loaded, size);
    });
    doneBytes += got;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    saved.set(paper.paper.id, paper);
    fresh.add(paper.paper.id);
    list[i].status = "done";
    bundle = await save(i === list.length - 1);
    report(i, 0, null);
  }
  return bundle ?? (await save(true));
}

/* ── E05: "Download when online" ── */

const QUEUE_KEY = "iq-download-queue";
export const DOWNLOADS_EVENT = "iq-downloads";

function notifyDownloads() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DOWNLOADS_EVENT));
}

function readQueue(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeQueue(ids: string[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(ids));
  } catch {}
}

export function isQueued(courseId: string) {
  return readQueue().includes(courseId);
}

/** Remembers a course to save the next time the phone is online (run by SyncWatcher). */
export function queueDownload(courseId: string) {
  const q = readQueue();
  if (!q.includes(courseId)) writeQueue([...q, courseId]);
}

let draining = false;

/** Saves every queued course, one at a time. A course leaves the queue once fully saved. */
export async function runQueuedDownloads() {
  if (draining || !isOnline()) return 0;
  draining = true;
  let done = 0;
  try {
    for (const id of readQueue()) {
      try {
        await downloadCourse(id);
        writeQueue(readQueue().filter((x) => x !== id));
        done++;
      } catch (e) {
        // A course that no longer exists stays out of the queue; a network failure waits for the next 'online'.
        if (e instanceof ApiError && e.status === 404) writeQueue(readQueue().filter((x) => x !== id));
        else break;
      }
    }
  } finally {
    draining = false;
  }
  return done;
}
