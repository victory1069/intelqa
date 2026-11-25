"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/use-api";
import { useOnline } from "@/lib/use-online";
import { useDownloads } from "@/lib/use-downloads";
import { startOnline } from "@/lib/start";
import type { Home } from "@/lib/types";
import { enablePush, markAsked, shouldAskForPush } from "@/lib/push";
import { QuizCard, contentLine } from "@/components/quiz-card";
import { Banner, Bar, Card, Dialog, EmptyState, Sheet, Skeleton, StreakChip, XpChip, fmtClock } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Logo } from "@/components/ui/logo";
import { FREEZE_EVERY_DAYS } from "@/shared/game";
import { RevealText } from "@/components/motion/reveal";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** A20: what a missed day would cost, under the streak-at-risk card. */
function freezeLine(streak: Home["streak"]) {
  if (streak.freezes > 0) return `${streak.freezes} streak freeze${streak.freezes === 1 ? "" : "s"} saved. A missed day uses one instead of ending your streak.`;
  const next = (Math.floor(streak.current / FREEZE_EVERY_DAYS) + 1) * FREEZE_EVERY_DAYS;
  return `No streak freeze saved. You'll earn one at ${next} days.`;
}

/** A17: "#38 of 2,140 · ↑12 this week". */
function rankLine(c: Home["courses"][number]) {
  if (!c.rank) return "";
  const move = c.moved ? ` · ${c.moved > 0 ? "↑" : "↓"}${Math.abs(c.moved)} this week` : "";
  return `#${c.rank.rank} of ${c.rank.total.toLocaleString()}${move}`;
}

function useCountdown(to: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  return to ? Math.max(0, (new Date(to).getTime() - now) / 1000) : 0;
}

export default function HomePage() {
  const { data, loading, staleAt, error, reload } = useApi<Home>("/me/home");
  const online = useOnline();
  const downloads = useDownloads();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const resumeLeft = useCountdown(data?.resume?.deadlineAt);
  const streakLeft = useCountdown(data?.streak.endsAt);

  if (!data && loading) return <HomeSkeleton />;
  if (!data) {
    // E16: the server is down (or we're offline) and nothing is saved yet. Downloaded papers still work.
    const down = !error || error.offline || error.status >= 500;
    return (
      <div className="flex flex-1 flex-col justify-between pb-5">
        <EmptyState glyph={down ? "settings" : "alert"} title={down ? (online ? "We're fixing something" : "You're offline") : "Couldn't load your home screen"}>
          {down
            ? `Leaderboards and syncing are unavailable for a bit.${downloads.courses?.length ? " Your downloaded papers still work, and results sync when we're back." : ""}`
            : error?.message}
        </EmptyState>
        <div className="flex flex-col gap-3 px-[22px]">
          {downloads.courses?.length ? <ButtonLink href="/practise" icon="download" full>Practise offline</ButtonLink> : null}
          <Button kind={downloads.courses?.length ? "ghost" : "primary"} icon="refresh" full onClick={reload}>Try again</Button>
        </div>
      </div>
    );
  }

  const first = data.courses.find((c) => c.papers > 0 || c.quizzes > 0);
  async function quickDrill(courseId: string) {
    setStarting(true);
    try {
      router.push(await startOnline({ mode: "drill", courseId, size: 10 }));
    } catch {
      setStarting(false);
    }
  }

  const streakAtRisk = data.streak.current > 0 && !data.streak.practisedToday && new Date().getHours() >= 20;
  const offline = !online;

  // A16: nothing earned yet, so one clear action.
  if (data.firstTime && first) {
    return (
      <>
        <div className="flex items-center justify-between px-5 pt-3">
          <Logo size={22} />
          <Bell unread={data.unread} />
        </div>
        <main className="flex flex-1 flex-col gap-6 px-5 pt-5">
          <RevealText as="h1" trigger="mount" className="display text-[clamp(48px,9vw,88px)]" text={`Welcome,\n${data.firstName}.`} />
          <p className="statement -mt-1 text-2xl italic text-ink2">Let&apos;s see what you know.</p>
          <div className="flex flex-col gap-5 rounded-[22px] bg-accent p-7 text-on-accent">
            <span className="font-mono text-[11px] font-bold tracking-wide opacity-85">START HERE · 3 MINUTES</span>
            <strong className="font-display text-2xl leading-tight">10-question {first.code} drill</strong>
            <span className="text-sm leading-snug opacity-90">Random questions from {first.papers ? `${first.papers} past paper${first.papers === 1 ? "" : "s"}` : "past questions"}. Every answer is explained after.</span>
            <Button kind="onAccent" icon="play" full loading={starting} onClick={() => quickDrill(first.id)}>Start practice</Button>
          </div>
          <QuizList data={data} />
          <span className="label pt-1">Your courses</span>
          <div className="grid grid-cols-2 gap-3">
            {data.courses.map((c) => (
              <Link key={c.id} href={`/course?id=${c.id}`} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
                <span className="font-mono text-[13px] font-bold">{c.code}</span>
                <span className="text-xs text-ink3">{contentLine(c) ? `${contentLine(c)} · not started` : "Nothing here yet"}</span>
              </Link>
            ))}
          </div>
        </main>
      </>
    );
  }

  // E04: offline, saved courses first; the rest stay listed, dimmed, so nothing seems to vanish.
  const visibleCourses = offline ? [...data.courses].sort((a, b) => Number(downloads.has(b.id)) - Number(downloads.has(a.id))) : data.courses;
  const savedPapers = (id: string) => downloads.courses?.find((b) => b.courseId === id)?.data.papers.length ?? 0;

  return (
    <>
      {offline ? (
        <div className="px-3 pt-2"><Banner icon="offline">You&apos;re offline. Downloaded papers still work.</Banner></div>
      ) : staleAt ? (
        <div className="px-3 pt-2">
          <Banner tone="warn" icon="alert" action={<button className="font-bold" onClick={reload}>Retry</button>}>
            Couldn&apos;t refresh. Showing what you had at {new Date(staleAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </Banner>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3 px-5 pt-8 lg:pt-14">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="caps text-[13px] text-violet">{greeting()}</span>
          <RevealText as="h1" trigger="mount" className="display truncate text-[56px] lg:text-[88px]" text={data.firstName ?? ""} />
        </div>
        <div className="flex items-center gap-1.5">
          {data.streak.current > 0 && !streakAtRisk && <StreakChip days={data.streak.current} />}
          <XpChip xp={data.xp.total} />
          <Bell unread={data.unread} />
        </div>
      </div>

      <main className="flex flex-1 flex-col gap-6 px-5 pt-8 pb-6 lg:gap-8 lg:pt-10">
        {streakAtRisk && !offline && (
          <div className="flex flex-col gap-5 rounded-[22px] bg-highlighter p-6 text-exam-ink">
            <div className="flex items-center gap-2.5">
              <Icon name="flame" size={30} color="#15132B" fill="#15132B" weight={1.5} />
              <strong className="font-display text-[26px]">{data.streak.current}-day streak</strong>
            </div>
            <span className="text-[15px] leading-snug">
              Ends at midnight, in {Math.floor(streakLeft / 3600)}h {Math.floor((streakLeft % 3600) / 60)}m. One 10-question drill keeps it alive.
              {data.streak.current < 7 && data.streak.current + 1 >= 7 && " Hit 7 days and your XP multiplier goes to 1.25×."}
            </span>
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} className="h-2 flex-1 rounded" style={{ background: i < Math.min(data.streak.current, 7) ? "#15132B" : "rgba(21,19,43,0.2)" }} />
              ))}
            </div>
            {first && <Button kind="inverse" size="md" icon="bolt" full loading={starting} onClick={() => quickDrill(first.id)}>Quick 10 · {first.code}</Button>}
          </div>
        )}
        {streakAtRisk && !offline && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-5 py-4">
            <Icon name="snow" size={20} color="var(--accent-text)" />
            <span className="flex-1 text-[13px] text-ink2">{freezeLine(data.streak)}</span>
          </div>
        )}

        {data.resume && !offline && (
          <div className="flex flex-col gap-4 rounded-[20px] bg-chip px-4 py-5 text-on-chip">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold tracking-wide text-highlighter">UNFINISHED · {data.resume.mode.toUpperCase()}</span>
              {data.resume.deadlineAt && <span className="font-mono text-xs">{fmtClock(resumeLeft)} left</span>}
            </div>
            <strong className="text-base">{data.resume.courseCode}{data.resume.session ? ` · ${data.resume.session}${data.resume.mode === "quiz" ? "" : " paper"}` : ""}</strong>
            <div className="flex items-center gap-2.5">
              <div className="flex-1"><Bar pct={(data.resume.answered / data.resume.total) * 100} color="#FFD43B" track="rgba(255,255,255,0.18)" /></div>
              <span className="font-mono text-xs">{data.resume.answered}/{data.resume.total}</span>
            </div>
            <ButtonLink href={`/session?id=${data.resume.id}`} kind="highlight" size="md" full>Resume</ButtonLink>
          </div>
        )}

        {data.daily && (
          <Link
            href={data.daily.mine && data.daily.mine.score === null ? `/session?id=${data.daily.mine.attemptId}` : `/daily?course=${data.daily.courseId}`}
            className={`flex items-center gap-3.5 rounded-[20px] border border-line bg-surface px-4 py-5 ${offline ? "pointer-events-none opacity-55" : ""}`}
          >
            <span className={`flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[14px] ${offline ? "bg-raised" : "bg-hl-tint"}`}>
              <Icon name="calendar" size={24} />
            </span>
            <span className="flex flex-1 flex-col gap-0.5">
              <strong className="text-[15px]">Daily challenge · {data.daily.courseCode}</strong>
              <span className="text-[13px] text-ink2">
                {offline ? "Needs data so everyone gets the same set" : data.daily.mine?.score === null ? "Started · tap to finish before midnight" : data.daily.mine ? `Done · ${data.daily.mine.score}/10 in ${fmtClock(data.daily.mine.timeTakenSec ?? 0)}` : `10 questions · ${data.daily.played.toLocaleString()} played today`}
              </span>
            </span>
            <Icon name="chevR" size={20} color="var(--ink3)" />
          </Link>
        )}

        {!offline && <QuizList data={data} />}

        <div className="flex items-center justify-between pt-1">
          <span className="label">{offline ? "On this phone" : "Your courses"}</span>
          {!offline && <Link href="/me/settings" className="text-[13px] font-semibold text-accent-text">Edit</Link>}
        </div>
        <Card className="flex flex-col">
          {visibleCourses.length === 0 && <span className="p-6 text-sm text-ink2">{offline ? "No courses saved on this phone yet. Download one from its course page next time you're online." : "Add your courses in Settings."}</span>}
          {visibleCourses.map((c, i) => {
            const saved = downloads.has(c.id);
            const dim = offline && !saved;
            const ready = savedPapers(c.id);
            return (
              <Link key={c.id} href={`/course?id=${c.id}`} className={`flex items-center gap-3 px-5 py-4 ${i ? "border-t border-line2" : ""} ${dim ? "opacity-50" : ""}`}>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-mono text-sm font-bold">
                    {c.code}
                    {saved && <Icon name="download" size={13} color="var(--ok-text)" label="Downloaded" />}
                  </span>
                  <span className="text-xs text-ink2">
                    {offline
                      ? saved
                        ? `${ready} paper${ready === 1 ? "" : "s"} ready`
                        : "Not downloaded"
                      : !contentLine(c)
                        ? "Nothing here yet"
                        : c.rank
                          ? rankLine(c)
                          : c.rankedAttempts > 0
                            ? `${3 - c.rankedAttempts} more session${3 - c.rankedAttempts === 1 ? "" : "s"} to get ranked`
                            : `${contentLine(c)} · not started`}
                  </span>
                  {!offline && c.quizzes > 0 && (!!c.rank || c.rankedAttempts > 0) && <span className="text-xs text-accent-text">{c.quizzes} quiz{c.quizzes === 1 ? "" : "zes"} available</span>}
                </span>
                {dim ? (
                  <Icon name="lock" size={18} color="var(--ink3)" label="Needs data" />
                ) : c.courseScore != null && c.rankedAttempts >= 3 ? (
                  <strong className="font-display text-[22px]">{Math.round(c.courseScore)}%</strong>
                ) : (
                  <span className="font-display text-[22px] text-ink3">—</span>
                )}
              </Link>
            );
          })}
        </Card>
      </main>

      <div className="sticky bottom-[68px] px-5 pt-2.5 pb-3" style={{ background: "linear-gradient(transparent, var(--bg) 30%)" }}>
        <ButtonLink href="/practise" icon="play" full>Start practice</ButtonLink>
      </div>
      <Moments moment={data.moment} />
      {!data.moment && <PushAsk />}
    </>
  );
}

/** The next quiz in each course, and how many are waiting in all. */
function QuizList({ data }: { data: Home }) {
  if (!data.quizzes?.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between pt-1">
        <span className="label">{data.quizzesLeft > 0 ? `${data.quizzesLeft} quiz${data.quizzesLeft === 1 ? "" : "zes"} to do` : "Quizzes"}</span>
        <Link href="/practise" className="text-[13px] font-semibold text-accent-text">See all</Link>
      </div>
      {data.quizzes.map((q) => <QuizCard key={q.id} q={q} />)}
    </div>
  );
}

function Bell({ unread }: { unread: number }) {
  return (
    <Link href="/me/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative flex h-10 w-10 items-center justify-center">
      <Icon name="bell" size={22} />
      {unread > 0 && <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full border-2 border-bg bg-bad" />}
    </Link>
  );
}

/** A21: our own sheet first; the browser prompt only appears after "Turn on", so a no here doesn't block us for good. */
function PushAsk() {
  const [open, setOpen] = useState(() => shouldAskForPush());
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={() => { markAsked(); setOpen(false); }} label="Notifications">
      <span className="flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-accent-tint"><Icon name="bell" size={30} color="var(--accent-text)" /></span>
      <strong className="font-display text-2xl leading-tight">Want a nudge before your streak ends?</strong>
      <span className="text-[15px] leading-relaxed text-ink2">We&apos;ll only message you about your streak, new past papers for your courses, and corrected scores. At most once a day.</span>
      <Button full loading={busy} onClick={async () => { setBusy(true); await enablePush().catch(() => {}); setBusy(false); setOpen(false); }}>Turn on reminders</Button>
      <Button full kind="ghost" onClick={() => { markAsked(); setOpen(false); }}>Not now</Button>
    </Sheet>
  );
}

/** D16 (a freeze saved the streak) and D17 (the streak ended). Each is shown once. */
function Moments({ moment }: { moment: Home["moment"] }) {
  const key = moment ? `iq-moment-${moment.kind}-${moment.on}` : "";
  const [seen, setSeen] = useState(() => {
    try {
      return !key || localStorage.getItem(key) === "1";
    } catch {
      return true;
    }
  });
  const router = useRouter();
  if (!moment || seen) return null;
  const close = () => {
    try {
      localStorage.setItem(key, "1");
    } catch {}
    setSeen(true);
  };
  return (
    <Dialog open onClose={close} label={moment.kind === "freeze" ? "Streak freeze used" : "Streak ended"}>
      <div className="flex flex-col items-center gap-5 text-center">
        <span className={`flex h-[72px] w-[72px] items-center justify-center rounded-[22px] ${moment.kind === "freeze" ? "bg-accent-tint" : "bg-raised"}`}>
          <Icon name={moment.kind === "freeze" ? "snow" : "flame"} size={36} color={moment.kind === "freeze" ? "var(--accent-text)" : "var(--ink3)"} />
        </span>
        {moment.kind === "freeze" ? (
          <>
            <strong className="font-display text-2xl">Your freeze saved a {moment.days}-day streak</strong>
            <span className="text-[15px] leading-relaxed text-ink2">You didn&apos;t practise yesterday, so we used your freeze. Practise today to keep it going. You have {moment.freezesLeft} freeze{moment.freezesLeft === 1 ? "" : "s"} left.</span>
            <Button full onClick={close}>Keep it going</Button>
          </>
        ) : (
          <>
            <strong className="font-display text-2xl">Your {moment.days}-day streak ended</strong>
            <span className="text-[15px] leading-relaxed text-ink2">It happens. Your best is still {moment.best} days. Do one drill today to start again.</span>
            <Button full onClick={() => { close(); router.push("/practise"); }}>Start day 1</Button>
            <Button full kind="ghost" onClick={close}>Not now</Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-5 px-5 pt-3" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-3"><Skeleton className="h-[11px] w-[90px]" /><Skeleton className="h-[18px] w-[70px]" /></div>
        <div className="flex gap-1.5"><Skeleton className="h-[30px] w-[52px] rounded-full" /><Skeleton className="h-[30px] w-[76px] rounded-full" /></div>
      </div>
      <Skeleton className="mt-1 h-[142px] rounded-[20px]" />
      <Skeleton className="h-[76px] rounded-[20px]" />
      <Skeleton className="mt-1.5 h-2.5 w-[100px]" />
      <Skeleton className="h-[190px] rounded-[20px]" />
    </div>
  );
}
