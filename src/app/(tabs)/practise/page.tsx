"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useDownloads } from "@/lib/use-downloads";
import { useOnline } from "@/lib/use-online";
import { useApi } from "@/lib/use-api";
import type { StudentQuiz } from "@/lib/types";
import { QuizCard } from "@/components/quiz-card";
import { AppBar, Banner, Card } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";

/** Practise tab: pick a course, then a mode. */
export default function Practise() {
  const { me } = useAuth();
  const downloads = useDownloads();
  const online = useOnline();
  const courses = me?.courses ?? [];
  const { data: tests } = useApi<{ quizzes: StudentQuiz[] }>(online ? "/quizzes" : null);
  const live = tests?.quizzes.filter((q) => q.status === "live") ?? [];
  const closed = tests?.quizzes.filter((q) => q.status === "closed") ?? [];
  return (
    <>
      <AppBar title="Practise" sub="Pick a course" lead="none" />
      <main className="flex flex-col gap-5 px-5 pb-4">
        {!online && <Banner icon="offline">Offline. Courses saved on this phone still work.</Banner>}
        {live.length > 0 && (
          <section className="flex flex-col gap-3">
            <span className="label pt-1">Practice tests</span>
            <span className="-mt-1 text-[13px] text-ink2">Set by your course admins. Same questions for everyone, timed like the real thing.</span>
            {live.map((q) => <QuizCard key={q.id} q={q} />)}
          </section>
        )}
        <span className="label pt-1">Courses</span>
        <Card className="flex flex-col">
          {courses.map((c, i) => {
            const saved = downloads.has(c.id);
            const usable = online || saved;
            return (
              <Link
                key={c.id}
                href={`/course?id=${c.id}`}
                className={`flex items-center gap-3 px-4 py-5 ${i ? "border-t border-line2" : ""} ${usable ? "" : "pointer-events-none opacity-50"}`}
              >
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-mono text-sm font-bold">
                    {c.code}
                    {saved && <Icon name="download" size={13} color="var(--ok-text)" label="Downloaded" />}
                  </span>
                  <span className="text-[13px] text-ink2">{c.title}</span>
                </span>
                {c.status !== "live" && <span className="rounded-md bg-flag-tint px-1.5 py-0.5 font-mono text-[11px] font-bold text-flag-text">SOON</span>}
                <Icon name={usable ? "chevR" : "lock"} size={18} color="var(--ink3)" />
              </Link>
            );
          })}
          {!courses.length && <span className="p-6 text-sm text-ink2">No courses yet. Add them in Settings.</span>}
        </Card>
        {closed.length > 0 && (
          <section className="flex flex-col gap-3 pt-2">
            <span className="label">Closed tests you sat</span>
            {closed.map((q) => <QuizCard key={q.id} q={q} />)}
          </section>
        )}
      </main>
    </>
  );
}
