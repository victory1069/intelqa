"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApi } from "@/lib/use-api";
import { useOnline } from "@/lib/use-online";
import { startOnline } from "@/lib/start";
import type { ApiError } from "@/lib/api";
import type { StudentQuiz } from "@/lib/types";
import { AppBar, Banner, EmptyState, Skeleton } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export default function QuizPage() {
  return (
    <Suspense>
      <Quiz />
    </Suspense>
  );
}

/** Start screen for a practice test set by a course admin: what it is, the rules, one Start button. */
function Quiz() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const online = useOnline();
  const { data, error, loading } = useApi<{ quiz: StudentQuiz }>(id ? `/quizzes/${id}` : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!data && loading) {
    return (
      <div className="flex flex-col gap-6 px-5 pt-16">
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-32 rounded-[18px]" />
      </div>
    );
  }
  if (!data) {
    return (
      <>
        <AppBar title="Practice test" />
        <EmptyState glyph={online ? "file" : "offline"} title={online ? "This test isn't available" : "You're offline"}>
          {online ? error?.message ?? "It may have been taken down." : "Practice tests need data so everyone sits the same set."}
        </EmptyState>
      </>
    );
  }

  const q = data.quiz;
  const closed = q.status === "closed";
  const neg = q.negativeMark > 0;

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      router.push(await startOnline({ mode: "quiz", quizId: q.id }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <>
      <AppBar title="Practice test" sub={q.course.code} />
      <main className="flex flex-1 flex-col gap-8 px-5 pt-4 pb-6">
        <div className="flex flex-col gap-5 rounded-3xl bg-accent p-7 text-on-accent lg:p-9">
          <span className="font-mono text-[11px] font-bold tracking-wide opacity-85">SET BY YOUR {q.course.code} ADMIN</span>
          <strong className="font-display text-[32px] leading-[1.05] font-extrabold lg:text-[40px]">{q.title}</strong>
          <div className="grid grid-cols-3 gap-3">
            {[
              [String(q.questions), "questions"],
              [`${q.timeLimitMin}`, "minutes"],
              [neg ? `−${q.negativeMark}` : "0", neg ? "per wrong" : "minus marks"],
            ].map(([v, l]) => (
              <div key={l} className="flex flex-col gap-1 rounded-[14px] bg-white/12 p-3.5">
                <strong className="font-mono text-xl">{v}</strong>
                <span className="text-xs opacity-85">{l}</span>
              </div>
            ))}
          </div>
        </div>

        {q.instructions && (
          <div className="flex flex-col gap-2.5">
            <span className="label">From your admin</span>
            <p className="text-[15px] leading-relaxed whitespace-pre-line text-ink2">{q.instructions}</p>
          </div>
        )}

        <ul className="flex flex-col gap-5 text-[15px] leading-snug text-ink2">
          <li className="flex gap-3"><Icon name="layers" size={20} />Questions drawn from across the {q.course.code} topics</li>
          <li className="flex gap-3"><Icon name="eyeOff" size={20} />No answers shown until you submit, then every explanation</li>
          <li className="flex gap-3"><Icon name="timer" size={20} />Auto-submits when time runs out</li>
          <li className="flex gap-3"><Icon name="refresh" size={20} />Sit it as often as you like. Your best score is kept</li>
          {q.closesAt && <li className="flex gap-3"><Icon name="calendar" size={20} />{closed ? "Closed" : "Open until"} {new Date(q.closesAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</li>}
        </ul>

        {q.best != null && (
          <div className="flex items-center gap-4 rounded-[18px] border border-line bg-surface px-5 py-5">
            <Icon name="trophy" size={22} color="var(--ok-text)" />
            <span className="flex flex-1 flex-col gap-0.5">
              <strong className="text-[15px]">Your best: {q.best}%</strong>
              <span className="text-[13px] text-ink2">{q.sittings} go{q.sittings === 1 ? "" : "es"} so far</span>
            </span>
            {q.lastAttemptId && <ButtonLink href={`/review?id=${q.lastAttemptId}&filter=all`} kind="ghost" size="sm">Review</ButtonLink>}
          </div>
        )}

        {closed && <Banner icon="lock">This test has closed. Your results are still here to review.</Banner>}
        {!online && <Banner icon="offline">You&apos;re offline. Practice tests need data.</Banner>}
        {err && <Banner tone="bad" icon="alert">{err}</Banner>}
      </main>
      {!closed && (
        <div className="px-5 pt-3 pb-6">
          {q.openAttemptId ? (
            <ButtonLink href={`/session?id=${q.openAttemptId}`} full>Resume test</ButtonLink>
          ) : (
            <Button full loading={busy} disabled={!online} onClick={start}>{q.sittings ? "Sit it again" : "Start test"}</Button>
          )}
        </div>
      )}
    </>
  );
}
