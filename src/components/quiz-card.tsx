"use client";
import Link from "next/link";
import type { StudentQuiz } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** One line of facts about a test: "25 questions · 20 min · closes 20 Nov". */
export function quizFacts(q: StudentQuiz) {
  return [`${q.questions} questions`, `${q.timeLimitMin} min`, q.status === "closed" ? "closed" : q.closesAt ? `closes ${day(q.closesAt)}` : null].filter(Boolean).join(" · ");
}

/** A practice test set by a course admin. Opens its start screen, or the unfinished sitting. */
export function QuizCard({ q, showCourse = true }: { q: StudentQuiz; showCourse?: boolean }) {
  const href = q.openAttemptId ? `/session?id=${q.openAttemptId}` : `/quiz?id=${q.id}`;
  const state = q.openAttemptId ? "Started · tap to finish" : q.best != null ? `Best ${q.best}% · ${q.sittings} go${q.sittings === 1 ? "" : "es"}` : null;
  return (
    <Link href={href} className={`flex items-center gap-4 rounded-[20px] border border-line bg-surface px-5 py-5 transition-colors hover:border-ink3 ${q.status === "closed" ? "opacity-70" : ""}`}>
      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-accent-tint">
        <Icon name="file" size={24} color="var(--accent-text)" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {showCourse && <span className="caps text-[11px] text-ink3">Practice test · {q.course.code}</span>}
        <strong className="truncate text-[16px]">{q.title}</strong>
        <span className="text-[13px] text-ink2">{state ?? quizFacts(q)}</span>
      </span>
      {q.openAttemptId ? (
        <span className="rounded-md bg-flag-tint px-1.5 py-0.5 font-mono text-[11px] font-bold text-flag-text">RESUME</span>
      ) : !q.sittings && q.status === "live" ? (
        <span className="rounded-md bg-accent-tint px-1.5 py-0.5 font-mono text-[11px] font-bold text-accent-text">NEW</span>
      ) : null}
      <Icon name="chevR" size={18} color="var(--ink3)" />
    </Link>
  );
}
