"use client";
import { useEffect, useSyncExternalStore } from "react";
import Dexie, { type EntityTable } from "dexie";
import { api } from "./api";

/** Last good response for a GET path, shown when the network is down. */
export type CacheRow = { path: string; data: unknown; at: number };

/** A downloaded course: every published paper with answers and explanations. */
export type CourseBundle = {
  courseId: string;
  code: string;
  title: string;
  bytes: number;
  at: number;
  data: {
    course: { id: string; code: string; title: string; optionCount: number; negativeMark: number };
    topics: { id: string; name: string }[];
    papers: {
      paper: { id: string; courseId: string; session: string; examType: string; timeLimitMin: number; optionCount: number; negativeMark: number };
      questions: OfflineQuestion[];
    }[];
  };
};

export type OfflineQuestion = {
  id: string;
  text: string;
  options: string[];
  correctOption: number | null;
  answerVerified: boolean;
  explanation: string | null;
  trap: string | null;
  workedSteps: string[] | null;
  imageUrl: string | null;
  imageAlt: string | null;
  topicId: string | null;
};

/** Answers for an online session, written on every tap before the network call. */
export type SessionMirror = {
  attemptId: string;
  answers: Record<string, { choice: number | null; flagged: boolean; timeSpentMs: number }>;
  dirty: string[];
  updatedAt: number;
  /** Submit was pressed while the server couldn't be reached; sync sends it later. */
  submitRequestedAt?: number;
};

/** A session taken entirely offline; queued for POST /attempts/sync once submitted. */
export type OfflineAttempt = {
  clientId: string;
  mode: "exam" | "drill" | "topic" | "retry";
  courseId: string;
  courseCode: string;
  paperId: string | null;
  title: string;
  questionIds: string[];
  optionOrders: number[][];
  answers: Record<string, { choice: number | null; flagged: boolean; timeSpentMs: number }>;
  startedAt: string;
  deadlineAt: string | null;
  negativeMark: number;
  submittedAt: string | null;
  timeTakenSec: number | null;
  provisional: { score: number; maxScore: number } | null;
  synced: boolean;
};

class OfflineDB extends Dexie {
  cache!: EntityTable<CacheRow, "path">;
  courses!: EntityTable<CourseBundle, "courseId">;
  sessions!: EntityTable<SessionMirror, "attemptId">;
  offlineAttempts!: EntityTable<OfflineAttempt, "clientId">;

  constructor() {
    super("intelqa");
    this.version(1).stores({
      cache: "path, at",
      courses: "courseId, at",
      sessions: "attemptId, updatedAt",
      offlineAttempts: "clientId, synced, submittedAt",
    });
  }
}

let instance: OfflineDB | null = null;
export function odb(): OfflineDB {
  instance ??= new OfflineDB();
  return instance;
}

export function newClientId() {
  return `off_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/* ───────────── C19: questions saved offline to ask about later ───────────── */

/** A question the student wanted to Ask about while offline. Kept in localStorage. */
export type AskLater = { questionId: string; chosen: number | null; number: number | null; courseCode: string | null; text: string | null; savedAt: number; bookmarked?: boolean };

const ASK_LATER_KEY = "iq-ask-later";
const askLaterListeners = new Set<() => void>();
let askLaterRaw: string | null | undefined;
let askLaterParsed: AskLater[] = [];
let askLaterFlushing = false;

function readAskLater(): AskLater[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ASK_LATER_KEY);
  } catch {}
  if (raw !== askLaterRaw) {
    askLaterRaw = raw;
    try {
      askLaterParsed = raw ? (JSON.parse(raw) as AskLater[]) : [];
    } catch {
      askLaterParsed = [];
    }
  }
  return askLaterParsed;
}

function writeAskLater(list: AskLater[]) {
  try {
    localStorage.setItem(ASK_LATER_KEY, JSON.stringify(list));
  } catch {}
  askLaterListeners.forEach((l) => l());
}

export const askLater = {
  /** For useSyncExternalStore. Returns a stable array between changes. */
  list: readAskLater,
  empty: (): AskLater[] => EMPTY_ASK_LATER,
  subscribe(fn: () => void) {
    askLaterListeners.add(fn);
    const onStorage = (e: StorageEvent) => e.key === ASK_LATER_KEY && fn();
    window.addEventListener("storage", onStorage);
    return () => {
      askLaterListeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  },
  save(item: Omit<AskLater, "savedAt">) {
    writeAskLater([{ ...item, savedAt: Date.now() }, ...readAskLater().filter((x) => x.questionId !== item.questionId)]);
  },
  /**
   * Once back online, bookmark each saved question so it also shows in Me › Bookmarks
   * (which opens Ask). Safe to call repeatedly; only unsent ones are tried.
   */
  async flush() {
    if (!isOnline() || askLaterFlushing) return;
    askLaterFlushing = true;
    try {
      for (const x of readAskLater().filter((i) => !i.bookmarked)) {
        await api(`/me/bookmarks/${x.questionId}`, { method: "PUT" });
        writeAskLater(readAskLater().map((i) => (i.questionId === x.questionId ? { ...i, bookmarked: true } : i)));
      }
    } catch {
      // Try again on the next reconnect.
    } finally {
      askLaterFlushing = false;
    }
  },
  remove(questionId: string) {
    const list = readAskLater();
    if (list.some((x) => x.questionId === questionId)) writeAskLater(list.filter((x) => x.questionId !== questionId));
  },
};
const EMPTY_ASK_LATER: AskLater[] = [];

/** Saved-for-later questions, live. Also bookmarks them on the server whenever the phone is online. */
export function useAskLater() {
  const list = useSyncExternalStore(askLater.subscribe, askLater.list, askLater.empty);
  useEffect(() => {
    const flush = () => void askLater.flush();
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);
  return list;
}
