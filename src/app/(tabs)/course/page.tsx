"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { useOnline } from "@/lib/use-online";
import { useDownloads } from "@/lib/use-downloads";
import { QuizCard } from "@/components/quiz-card";
import { downloadCourse, isQueued, queueDownload, startOffline, startOnline, type DownloadProgress, type StartBody } from "@/lib/start";
import type { CoursePage, Home, StudentQuiz } from "@/lib/types";
import { AppBar, Banner, Bar, Card, EmptyState, Pill, Sheet, Skeleton, fmtClock } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon, Spinner, type Glyph } from "@/components/ui/icon";

export default function CoursePageRoute() {
  return (
    <Suspense>
      <Course />
    </Suspense>
  );
}

type Paper = CoursePage["papers"][number];
type DlResult = { kind: "done"; bytes: number } | { kind: "cancelled"; saved: number; total: number } | { kind: "failed"; message: string };

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;

function Course() {
  const id = useSearchParams().get("id") ?? "";
  const view = useSearchParams().get("view");
  const router = useRouter();
  const online = useOnline();
  const downloads = useDownloads();
  const { me } = useAuth();
  const { data, error, loading } = useApi<CoursePage>(id ? `/catalog/courses/${id}` : null);
  const bundle = downloads.courses?.find((c) => c.courseId === id);
  const { data: tests } = useApi<{ quizzes: StudentQuiz[] }>(id && online ? `/quizzes?course=${id}` : null);
  // E05: offline, the saved home screen still knows this course's code and download size.
  const { data: home } = useApi<Home>(!online && !bundle ? "/me/home" : null);
  const homeCourse = home?.courses.find((c) => c.id === id);
  const other = downloads.courses?.find((c) => c.courseId !== id);
  const [notSavedClosedFor, setNotSavedClosedFor] = useState<string | null>(null);

  const [examPaper, setExamPaper] = useState<Paper | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [dlResult, setDlResult] = useState<DlResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** E02: one paper at a time, saved as each lands. Cancel keeps the papers already saved. */
  async function startDownload() {
    const ac = new AbortController();
    abortRef.current = ac;
    setDlResult(null);
    setProgress({ papers: [], current: 0, loaded: 0, size: null, received: 0, pct: 0 });
    let last: DownloadProgress | null = null;
    try {
      const b = await downloadCourse(id, { signal: ac.signal, onProgress: (p) => { last = p; setProgress(p); } });
      setDlResult({ kind: "done", bytes: b.bytes });
    } catch (e) {
      const p = last as DownloadProgress | null;
      const saved = p?.papers.filter((x) => x.status === "done").length ?? 0;
      if ((e as Error).name === "AbortError") setDlResult({ kind: "cancelled", saved, total: p?.papers.length ?? 0 });
      else setDlResult({ kind: "failed", message: `${(e as Error).message}${saved ? ` ${saved} paper${saved === 1 ? " is" : "s are"} saved.` : ""}` });
    } finally {
      abortRef.current = null;
      setProgress(null);
      downloads.reload();
    }
  }

  async function go(body: StartBody, offline?: Parameters<typeof startOffline>[1]) {
    setBusy(true);
    setErr(null);
    try {
      router.push(!online && bundle && offline ? await startOffline(bundle, offline) : await startOnline(body));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  if (!data && loading) {
    return (
      <div className="flex flex-col gap-5 px-5 pt-16">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-60 rounded-[18px]" />
      </div>
    );
  }
  if (!data) {
    return (
      <>
        <AppBar title={homeCourse?.code ?? "Course"} sub={homeCourse?.title} />
        <EmptyState glyph="offline" title={online ? "Couldn't load this course" : "This course isn't on this phone"}>
          {online ? error?.message : "You'll need data to open it."}
        </EmptyState>
        {!online && (
          <NotSaved key={id} courseId={id} code={homeCourse?.code ?? "This course"} bytes={homeCourse?.offlineBytes ?? null} other={other ? { id: other.courseId, code: other.code } : null} onClose={() => router.back()} />
        )}
      </>
    );
  }

  const { course, papers } = data;
  const liveTests = tests?.quizzes.filter((q) => q.status === "live") ?? [];
  const closedTests = tests?.quizzes.filter((q) => q.status === "closed") ?? [];
  const doneTests = liveTests.filter((q) => q.sittings).length;
  const downloaded = !!bundle;
  const complete = !!bundle && papers.every((p) => bundle.data.papers.some((x) => x.paper.id === p.id));
  const savedCount = bundle ? papers.filter((p) => bundle.data.papers.some((x) => x.paper.id === p.id)).length : 0;

  // A23: added but nothing published yet.
  if (!papers.length && !data.quizzes && !data.questions) {
    return (
      <>
        <AppBar title={course.code} sub={course.title} />
        <div className="flex-1">
          <EmptyState glyph="file" tone="hl" title={`Nothing in ${course.code} yet`}>
            Our course reps are typing them up and checking the answers. Practice opens the moment the first paper or quiz goes live.
          </EmptyState>
        </div>
      </>
    );
  }

  if (view === "topics") return <Topics data={data} busy={busy} onStart={(topicId) => go({ mode: "topic", topicId }, { mode: "topic", topicId })} />;
  if (view === "retry") {
    return (
      <>
        <AppBar title="Retry mistakes" sub={course.code} />
        <div className="flex-1">
          <EmptyState glyph="target" tone="ok" title="Nothing to retry yet">
            Questions you get wrong in {course.code} will show up here. Get one right twice in a row and it drops off the list.
          </EmptyState>
        </div>
        <div className="px-[22px] pb-5"><Button full onClick={() => setDrillOpen(true)}>Start a {course.code} drill</Button></div>
        <DrillSheet open={drillOpen} onClose={() => setDrillOpen(false)} code={course.code} busy={busy} onStart={(size, filter) => go({ mode: "drill", courseId: id, size, filter }, { mode: "drill", size })} />
      </>
    );
  }

  const modes: { glyph: Glyph; title: string; sub: string; ranked?: boolean; onClick: () => void; disabled?: boolean }[] = [
    ...(papers.length ? [{ glyph: "timer" as const, title: "Exam simulation", sub: "Full paper, real time limit", ranked: true, onClick: () => setExamPaper(papers[0]) }] : []),
    { glyph: "bolt", title: "Quick drill", sub: "10 or 20 random, short timer", ranked: true, onClick: () => setDrillOpen(true) },
    { glyph: "list", title: "Topic practice", sub: "Untimed, feedback after each answer", onClick: () => router.push(`/course?id=${id}&view=topics`) },
    {
      glyph: "refresh",
      title: "Retry mistakes",
      sub: data.mistakes ? `${data.mistakes} question${data.mistakes === 1 ? "" : "s"} you got wrong` : "Nothing to retry yet",
      onClick: () => (data.mistakes ? go({ mode: "retry", courseId: id }) : router.push(`/course?id=${id}&view=retry`)),
      disabled: !online,
    },
  ];

  return (
    <>
      <AppBar title={course.code} sub={course.title}>
        {papers.length > 0 && <button
          aria-label={complete ? "Saved for offline. Download again to update" : downloaded ? "Finish saving for offline" : "Download for offline"}
          disabled={!online || !!progress}
          onClick={startDownload}
          className="flex h-11 w-11 items-center justify-center"
        >
          {progress ? <Spinner size={20} color="var(--accent)" /> : <Icon name={complete ? "check" : "download"} size={22} color={complete ? "var(--ok-text)" : "var(--ink)"} />}
        </button>}
      </AppBar>
      <main className="flex flex-col gap-5 px-5 pb-4">
        {!online && <Banner icon="offline">Offline. {downloaded ? `This course is saved${complete ? "" : ` (${savedCount} of ${papers.length} papers)`}, so exams and drills work. Results sync later.` : "This course isn't saved on this phone."}</Banner>}
        {progress && <SavingCard progress={progress} onCancel={() => abortRef.current?.abort()} />}
        {!progress && dlResult?.kind === "done" && <Banner tone="ok" icon="check">Saved for offline · {kb(dlResult.bytes)}</Banner>}
        {!progress && dlResult?.kind === "cancelled" && (
          <Banner icon="info">Download cancelled. {dlResult.saved ? `${dlResult.saved} of ${dlResult.total} papers are saved on this phone.` : "Nothing was saved."}</Banner>
        )}
        {!progress && dlResult?.kind === "failed" && <Banner tone="bad" icon="alert" action={online ? <button className="font-bold" onClick={startDownload}>Retry</button> : undefined}>{dlResult.message}</Banner>}
        {err && <Banner tone="bad" icon="alert">{err}</Banner>}
        <div className="flex gap-2">
          <Card className="flex flex-1 flex-col gap-0.5 p-4">
            <span className="text-xs text-ink2">Course score</span>
            <strong className="font-display text-[28px]">{data.courseScore != null && data.rankedAttempts >= 3 ? `${Math.round(data.courseScore)}%` : "—"}</strong>
          </Card>
          <Card className="flex flex-1 flex-col gap-0.5 p-4">
            <span className="text-xs text-ink2">{me?.institution?.shortCode ? `${me.institution.shortCode} rank` : "Rank"}</span>
            <strong className="font-display text-[28px]">{data.rank ? `#${data.rank.rank}` : "—"}</strong>
          </Card>
        </div>
        {data.rankedAttempts < 3 && <span className="text-xs text-ink3">{3 - data.rankedAttempts} more exam or drill{3 - data.rankedAttempts === 1 ? "" : "s"} to get ranked.</span>}

        {liveTests.length > 0 && (
          <>
            <div className="flex items-center justify-between pt-1">
              <span className="label">{liveTests.length} quiz{liveTests.length === 1 ? "" : "zes"} available</span>
              <span className="text-[13px] text-ink2">{doneTests} done</span>
            </div>
            <div className="flex flex-col gap-3">
              {liveTests.map((q) => <QuizCard key={q.id} q={q} showCourse={false} />)}
            </div>
          </>
        )}

        <span className="label pt-1">Modes</span>
        <Card className="flex flex-col">
          {modes.map((m, i) => (
            <button key={m.title} onClick={m.onClick} disabled={m.disabled || busy} className={`flex items-center gap-3 px-5 py-4 text-left disabled:opacity-50 ${i ? "border-t border-line2" : ""}`}>
              <Icon name={m.glyph} size={22} color="var(--accent-text)" />
              <span className="flex flex-1 flex-col">
                <strong className="text-[15px]">{m.title}</strong>
                <span className="text-xs text-ink2">{m.sub}</span>
              </span>
              {m.ranked && <Icon name="board" size={16} color="var(--ink3)" label="Counts for rank" />}
            </button>
          ))}
        </Card>

        {closedTests.length > 0 && (
          <>
            <span className="label pt-1">Closed quizzes you sat</span>
            <div className="flex flex-col gap-3">
              {closedTests.map((q) => <QuizCard key={q.id} q={q} showCourse={false} />)}
            </div>
          </>
        )}

        {papers.length > 0 && <>
        <div className="flex items-center justify-between pt-1">
          <span className="label">Past papers</span>
          <span className="flex items-center gap-1 text-[11px] text-ink3"><Icon name="board" size={12} color="var(--ink3)" />= counts for rank</span>
        </div>
        <Card className="flex flex-col">
          {papers.map((p, i) => (
            <button key={p.id} onClick={() => setExamPaper(p)} className={`flex items-center gap-3 px-5 py-4 text-left ${i ? "border-t border-line2" : ""}`}>
              <span className="flex flex-1 flex-col">
                <strong className="text-[15px]">{p.session} · {p.examType === "post_utme" ? "Post-UTME" : p.examType === "test" ? "Test" : "Exam"}</strong>
                <span className="text-xs text-ink2">{p.questions} Qs · {p.timeLimitMin} min · {p.best != null ? `best ${p.best}%` : "not tried"}</span>
              </span>
              {p.best != null ? <Icon name="check" size={18} color="var(--ok-text)" /> : !p.tried && <span className="rounded-md bg-accent-tint px-1.5 py-0.5 font-mono text-[11px] font-bold text-accent-text">NEW</span>}
            </button>
          ))}
        </Card>
        </>}
      </main>

      {!online && !downloaded && papers.length > 0 && notSavedClosedFor !== id && (
        <NotSaved key={id} courseId={id} code={course.code} bytes={homeCourse?.offlineBytes ?? null} other={other ? { id: other.courseId, code: other.code } : null} onClose={() => setNotSavedClosedFor(id)} />
      )}
      <ExamSheet paper={examPaper} code={course.code} onClose={() => setExamPaper(null)} busy={busy} offline={!online} onStart={(p) => go({ mode: "exam", paperId: p.id }, { mode: "exam", paperId: p.id })} />
      <DrillSheet open={drillOpen} onClose={() => setDrillOpen(false)} code={course.code} busy={busy} offline={!online} onStart={(size, filter) => go({ mode: "drill", courseId: id, size, filter }, { mode: "drill", size })} />
    </>
  );
}

/** E02: "Saving for offline", paper by paper. */
function SavingCard({ progress, onCancel }: { progress: DownloadProgress; onCancel: () => void }) {
  const { papers, current, loaded, size, received, pct } = progress;
  const detail = !papers.length
    ? "Getting the paper list"
    : `Paper ${current + 1} of ${papers.length} · ${size ? `${kb(loaded)} of ${kb(size)}` : `${kb(received)} so far`}`;
  return (
    <>
      <Card className="flex flex-col gap-5 rounded-[18px] p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-accent-tint"><Icon name="download" size={22} color="var(--accent-text)" /></span>
          <span className="flex flex-1 flex-col gap-0.5" aria-live="polite">
            <strong className="text-[15px]">Saving for offline</strong>
            <span className="text-xs text-ink2">{detail}</span>
          </span>
          <span className="font-mono text-[15px] font-bold">{pct}%</span>
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Download progress"><Bar pct={pct} /></div>
        <button onClick={onCancel} className="self-end text-[13px] font-semibold text-ink2">Cancel</button>
      </Card>
      {papers.length > 0 && (
        <Card className="flex flex-col rounded-[18px]">
          {papers.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-3 px-5 py-[11px] ${i ? "border-t border-line2" : ""} ${p.status === "waiting" ? "text-ink3" : ""}`}>
              <span className="flex-1 text-[15px]">{p.label}</span>
              {p.status === "done" ? <Icon name="check" size={18} color="var(--ok-text)" weight={2.6} label="Done" /> : p.status === "saving" ? <Spinner size={18} color="var(--accent)" /> : <span className="text-xs">Waiting</span>}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

/** E05: offline and this course isn't saved. Offers to save it later instead of a dead end. */
function NotSaved({ courseId, code, bytes, other, onClose }: { courseId: string; code: string; bytes: number | null; other: { id: string; code: string } | null; onClose: () => void }) {
  const [queued, setQueued] = useState(() => isQueued(courseId));
  return (
    <Sheet open onClose={onClose} label="Course not saved">
      <strong className="font-display text-2xl leading-tight">{code} isn&apos;t on this phone</strong>
      <span className="text-[15px] leading-relaxed text-ink2">
        You&apos;ll need data to open it. We can save it automatically the next time you&apos;re connected.{bytes ? ` It's about ${kb(bytes)}.` : ""}
      </span>
      <Button full icon={queued ? "check" : "download"} disabled={queued} onClick={() => { queueDownload(courseId); setQueued(true); }}>
        {queued ? "We'll save it when you're online" : "Download when online"}
      </Button>
      {other && <ButtonLink href={`/course?id=${other.id}`} kind="ghost" full>Practise {other.code} instead</ButtonLink>}
    </Sheet>
  );
}

/** A24 / A25: states the rules once, so nothing during the exam surprises them. */
function ExamSheet({ paper, code, onClose, onStart, busy, offline }: { paper: Paper | null; code: string; onClose: () => void; onStart: (p: Paper) => void; busy: boolean; offline?: boolean }) {
  if (!paper) return null;
  const ae = paper.optionCount === 5;
  const neg = paper.negativeMark > 0;
  return (
    <Sheet open onClose={onClose} label="Exam setup">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] font-bold tracking-wide text-accent-text">EXAM SIMULATION</span>
        <strong className="font-display text-[26px]">{code} · {paper.session}</strong>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          [String(paper.questions), "questions"],
          [fmtClock(paper.timeLimitMin * 60), "time limit"],
          [ae ? "A–E" : "A–D", neg ? "5 options" : "no minus"],
        ].map(([v, l]) => (
          <div key={l} className="flex flex-col gap-0.5 rounded-[14px] bg-bg p-2.5">
            <strong className="font-mono text-lg">{v}</strong>
            <span className="text-xs text-ink2">{l}</span>
          </div>
        ))}
      </div>
      {neg && (
        <div className="flex gap-3 rounded-2xl bg-bad-tint p-5 text-bad-text">
          <span className="flex-none font-mono text-xl font-bold">−{paper.negativeMark}</span>
          <span className="text-sm leading-snug">Each wrong answer loses {paper.negativeMark === 0.25 ? "a quarter mark" : `${paper.negativeMark} marks`}. Skipped questions score zero, so skip anything you&apos;d only be guessing.</span>
        </div>
      )}
      <ul className="flex flex-col gap-4 text-sm leading-snug text-ink2">
        <li className="flex gap-2.5"><Icon name="eyeOff" size={18} />No answers shown until you submit</li>
        <li className="flex gap-2.5"><Icon name="timer" size={18} />Auto-submits when time runs out</li>
        <li className="flex gap-2.5"><Icon name="download" size={18} />Saved on your phone. A dropped connection loses nothing</li>
        <li className="flex gap-2.5"><Icon name="board" size={18} />{offline ? "Offline sessions earn XP but don't change your rank" : `Counts for your ${code} rank`}</li>
      </ul>
      <Button full loading={busy} onClick={() => onStart(paper)}>Start exam</Button>
    </Sheet>
  );
}

/** A26: two choices, both preset. Starting is one tap. */
function DrillSheet({ open, onClose, code, onStart, busy, offline }: { open: boolean; onClose: () => void; code: string; onStart: (size: 10 | 20, filter: "all" | "weak" | "unseen") => void; busy: boolean; offline?: boolean }) {
  const [size, setSize] = useState<10 | 20>(10);
  const [filter, setFilter] = useState<"all" | "weak" | "unseen">("all");
  return (
    <Sheet open={open} onClose={onClose} label="Quick drill">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] font-bold tracking-wide text-accent-text">QUICK DRILL · {code}</span>
        <strong className="font-display text-[26px]">How many questions?</strong>
      </div>
      <div className="flex gap-2.5">
        {([10, 20] as const).map((n) => (
          <button key={n} onClick={() => setSize(n)} aria-pressed={size === n} className={`flex flex-1 flex-col gap-1 rounded-[18px] p-5 text-left ${size === n ? "border-2 border-accent bg-accent-tint" : "border-[1.5px] border-line"}`}>
            <strong className="font-display text-[32px]">{n}</strong>
            <span className="text-[13px] text-ink2">{n === 10 ? 8 : 16} min timer</span>
          </button>
        ))}
      </div>
      {!offline && (
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold">From</span>
          <div className="flex flex-wrap gap-2">
            <Pill on={filter === "all"} onClick={() => setFilter("all")}>All topics</Pill>
            <Pill on={filter === "weak"} onClick={() => setFilter("weak")}>Weak topics only</Pill>
            <Pill on={filter === "unseen"} onClick={() => setFilter("unseen")}>Unseen only</Pill>
          </div>
        </div>
      )}
      <Button full loading={busy} onClick={() => onStart(size, filter)}>Start {size} questions</Button>
    </Sheet>
  );
}

/** A27: topics with mastery from past attempts, weakest first. */
function Topics({ data, onStart, busy }: { data: CoursePage; onStart: (topicId: string) => void; busy: boolean }) {
  const sorted = [...data.topics].filter((t) => t.questions > 0).sort((a, b) => (a.mastery ?? 101) - (b.mastery ?? 101));
  const color = (m: number) => (m < 50 ? ["var(--bad)", "var(--bad-text)"] : m < 70 ? ["var(--flag)", "var(--flag-text)"] : ["var(--ok)", "var(--ok-text)"]);
  return (
    <>
      <AppBar title="Topic practice" sub={`${data.course.code} · Untimed · XP only`} />
      <main className="flex flex-col gap-3 px-5 pb-4">
        {sorted.map((t, i) => (
          <button key={t.id} disabled={busy} onClick={() => onStart(t.id)} className={`flex flex-col gap-3 rounded-2xl bg-surface px-5 py-4 text-left ${t.mastery == null ? "border border-dashed border-line" : "border border-line"}`}>
            <div className="flex justify-between gap-2">
              <strong className="text-[15px]">{t.name}</strong>
              {t.mastery == null ? <span className="font-mono text-[13px] text-ink3">new</span> : <span className="font-mono text-[13px] font-bold" style={{ color: color(t.mastery)[1] }}>{t.mastery}%</span>}
            </div>
            {t.mastery != null ? <Bar pct={t.mastery} color={color(t.mastery)[0]} /> : <Bar pct={0} />}
            <span className="text-xs text-ink3">{t.questions} questions{t.mastery == null ? " · not tried" : i === 0 && t.mastery < 60 ? " · weakest" : ""}</span>
          </button>
        ))}
        {!sorted.length && <EmptyState glyph="list" title="No topics yet">Questions in this course haven&apos;t been tagged by topic yet.</EmptyState>}
      </main>
    </>
  );
}

