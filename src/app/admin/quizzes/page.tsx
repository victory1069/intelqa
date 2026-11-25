"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/use-api";
import { Header, Status, ago } from "@/components/admin/kit";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, Pill } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";

export type AdminQuizRow = {
  id: string;
  title: string;
  courseId: string;
  courseCode: string;
  status: "draft" | "live" | "closed";
  questions: number;
  timeLimitMin: number;
  topics: number;
  closesAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  sittings: number;
  students: number;
  average: number | null;
};

/** Every quiz in the admin's courses. */
export default function QuizzesPage() {
  const [status, setStatus] = useState("");
  const { data } = useApi<{ quizzes: AdminQuizRow[]; counts: Record<string, number> }>("/admin/quizzes");
  const all = data?.quizzes ?? [];
  const list = all.filter((q) => !status || q.status === status);
  const c = data?.counts ?? {};

  return (
    <>
      <Header title="Quizzes">
        <ButtonLink href="/admin/quizzes/new" icon="plus" size="md">New quiz</ButtonLink>
      </Header>
      <p className="max-w-[640px] px-5 text-[15px] leading-relaxed text-ink2 sm:px-8 lg:px-12">
        Pick a course, the topics and how many questions. The questions are drawn at random across those topics, and students see the test on their Practise tab.
      </p>
      <div className="flex flex-wrap gap-1.5 px-5 pt-8 sm:px-8 lg:px-12">
        <Pill on={!status} onClick={() => setStatus("")}>All {all.length}</Pill>
        <Pill on={status === "live"} onClick={() => setStatus("live")}>Live {c.live ?? 0}</Pill>
        <Pill on={status === "draft"} onClick={() => setStatus("draft")}>Draft {c.draft ?? 0}</Pill>
        <Pill on={status === "closed"} onClick={() => setStatus("closed")}>Closed {c.closed ?? 0}</Pill>
      </div>
      <main className="px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
        {data && !all.length ? (
          <div className="rounded-2xl border border-line bg-surface py-6">
            <EmptyState glyph="timer" tone="accent" title="No quizzes yet">
              Make one in under a minute: choose a course, a size up to 25 questions and a time limit.
            </EmptyState>
            <div className="flex justify-center pb-6"><ButtonLink href="/admin/quizzes/new" icon="plus" size="md">New quiz</ButtonLink></div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="hidden grid-cols-[2.4fr_1fr_1.1fr_1.3fr_1fr_40px] gap-5 border-b border-line px-7 py-4 font-mono text-[11px] tracking-wider text-ink3 md:grid">
              <span>TEST</span><span>STATUS</span><span>SIZE</span><span>STUDENTS</span><span>CREATED</span><span />
            </div>
            {list.map((q) => (
              <Link
                key={q.id}
                href={`/admin/quizzes/view?id=${q.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line2 px-5 py-5 text-sm last:border-0 hover:bg-bg md:grid md:grid-cols-[2.4fr_1fr_1.1fr_1.3fr_1fr_40px] md:gap-5 md:px-7"
              >
                <div className="flex w-full min-w-0 flex-col gap-1 md:w-auto">
                  <strong className="truncate text-[15px]">{q.title}</strong>
                  <span className="text-xs text-ink3">{q.courseCode} · {q.topics ? `${q.topics} topic${q.topics === 1 ? "" : "s"}` : "all topics"}</span>
                </div>
                <Status s={q.status} />
                <span className="text-ink2">{q.questions} Qs · {q.timeLimitMin} min</span>
                <span className="text-ink2">{q.sittings ? `${q.students} student${q.students === 1 ? "" : "s"} · avg ${q.average ?? 0}%` : "Not sat yet"}</span>
                <span className="text-[13px] text-ink2">{ago(q.createdAt)}</span>
                <Icon name="chevR" size={18} color="var(--ink3)" />
              </Link>
            ))}
            {!list.length && <span className="block p-6 text-sm text-ink2">{data ? "Nothing here." : "Loading…"}</span>}
          </div>
        )}
      </main>
    </>
  );
}
