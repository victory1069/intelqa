"use client";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDownloads } from "@/lib/use-downloads";
import { useOnline } from "@/lib/use-online";
import { useApi } from "@/lib/use-api";
import type { StudentQuiz } from "@/lib/types";
import { QuizCard } from "@/components/quiz-card";
import { AppBar, Banner, Card } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";

/** One course's quizzes: the next one to sit, and the rest on tap. */
function CourseQuizzes({ list }: { list: StudentQuiz[] }) {
  const [open, setOpen] = useState(false);
  const next = list.find((q) => q.openAttemptId) ?? list.find((q) => !q.sittings) ?? list[0];
  const done = list.filter((q) => q.sittings).length;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3 pt-2">
        <span className="font-mono text-sm font-bold">
          {list[0].course.code} <span className="font-sans text-[13px] font-normal text-ink2">· {done ? `${done} of ${list.length} done` : `${list.length} quiz${list.length === 1 ? "" : "zes"}`}</span>
        </span>
        {list.length > 1 && (
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="py-1 text-[13px] font-semibold text-accent-text">{open ? "Show less" : `Show all ${list.length}`}</button>
        )}
      </div>
      {(open ? list : [next]).map((q) => <QuizCard key={q.id} q={q} showCourse={false} />)}
    </div>
  );
}

/** Practise tab: pick a course, then a mode. */
export default function Practise() {
  const { me } = useAuth();
  const downloads = useDownloads();
  const online = useOnline();
  const courses = me?.courses ?? [];
  const { data: tests } = useApi<{ quizzes: StudentQuiz[] }>(online ? "/quizzes" : null);
  const live = tests?.quizzes.filter((q) => q.status === "live") ?? [];
  const inCourse = (id: string) => live.filter((q) => q.course.id === id);
  const byCourse = [...new Set(live.map((q) => q.course.id))].map(inCourse).sort((a, b) => a[0].course.code.localeCompare(b[0].course.code));
  const closed = tests?.quizzes.filter((q) => q.status === "closed") ?? [];
  return (
    <>
      <AppBar title="Practise" sub="Pick a course" lead="none" />
      <main className="flex flex-col gap-5 px-5 pb-4">
        {!online && <Banner icon="offline">Offline. Courses saved on this phone still work.</Banner>}
        {live.length > 0 && (
          <section className="flex flex-col gap-3">
            <span className="label pt-1">{live.length} quiz{live.length === 1 ? "" : "zes"} available</span>
            <span className="-mt-1 text-[13px] text-ink2">Same questions for everyone, timed like the real thing. Sit each one as often as you like.</span>
            {byCourse.map((list) => <CourseQuizzes key={list[0].course.id} list={list} />)}
          </section>
        )}
        <span className="label pt-1">Courses</span>
        <Card className="flex flex-col">
          {courses.map((c, i) => {
            const saved = downloads.has(c.id);
            const count = inCourse(c.id).length;
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
                  {count > 0 && <span className="text-[13px] text-accent-text">{count} quiz{count === 1 ? "" : "zes"} available</span>}
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
