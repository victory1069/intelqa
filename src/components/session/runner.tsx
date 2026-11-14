"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewQuestion, SessionQuestion } from "@/lib/types";
import { useOnline } from "@/lib/use-online";
import { Banner, Bar, Dialog, Pill, Sheet, fmtClock } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icon";
import { Option, type OptionState } from "@/components/ui/option";
import { MathText } from "@/components/ui/math-text";
import { LETTERS, MODES, type Mode } from "@/shared/game";

export type Answer = { choice: number | null; flagged: boolean; timeSpentMs: number };

export type Feedback = { correct: boolean; question: ReviewQuestion; xp: number };

/** Everything the runner needs from either an online session or an offline one. */
export type Driver = {
  mode: Mode;
  title: string;
  subtitle: string;
  questions: SessionQuestion[];
  initial: Record<string, Answer>;
  /** Deadline in local clock milliseconds (already corrected for server clock skew). */
  deadline: number | null;
  negativeMark: number;
  instantFeedback: boolean;
  offline: boolean;
  save: (questionId: string, a: Answer) => void;
  check?: (questionId: string, choice: number | null) => Promise<Feedback>;
  /** Grades and returns the URL of the result screen. */
  submit: (auto: boolean) => Promise<string>;
  onAsk?: (questionId: string, choice: number | null) => void;
  onLeave: () => void;
};

const DATA_SAVER_KEY = "iq-data-saver";
export function dataSaverOn() {
  try {
    return localStorage.getItem(DATA_SAVER_KEY) !== "0";
  } catch {
    return true;
  }
}

export function Runner({ d, onDone }: { d: Driver; onDone: (url: string) => void }) {
  const online = useOnline();
  const [i, setI] = useState(() => {
    const firstOpen = d.questions.findIndex((q) => d.initial[q.id]?.choice == null);
    return firstOpen < 0 ? 0 : firstOpen;
  });
  const [answers, setAnswers] = useState<Record<string, Answer>>(d.initial);
  const [now, setNow] = useState(() => Date.now());
  const [navOpen, setNavOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [phase, setPhase] = useState<"answering" | "timesup" | "grading" | "error">("answering");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lowDismissed, setLowDismissed] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [checking, setChecking] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const enteredAt = useRef(0);
  const vibrated = useRef(false);
  const submitting = useRef(false);

  // Clamp in case the driver changes under us; a session with no questions never reaches here.
  const q = d.questions[Math.min(i, d.questions.length - 1)];
  const a = answers[q.id] ?? { choice: null, flagged: false, timeSpentMs: 0 };
  const total = d.questions.length;
  const answeredCount = Object.values(answers).filter((x) => x.choice != null).length;
  const flaggedNums = d.questions.map((x, n) => (answers[x.id]?.flagged ? n + 1 : 0)).filter(Boolean);
  const unansweredNums = d.questions.map((x, n) => (answers[x.id]?.choice == null ? n + 1 : 0)).filter(Boolean);
  const left = d.deadline ? Math.max(0, (d.deadline - now) / 1000) : null;
  const low = left != null && left <= 300;
  const isDrill = d.mode === "drill" || d.mode === "daily";

  useEffect(() => {
    enteredAt.current = Date.now();
  }, []);

  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (submitting.current) return;
      submitting.current = true;
      setSubmitOpen(false);
      setPhase(auto ? "timesup" : "grading");
      try {
        const url = await d.submit(auto);
        onDone(url);
      } catch (e) {
        submitting.current = false;
        setSubmitError((e as Error).message);
        setPhase("error");
      }
    },
    [d, onDone],
  );

  // Clock. One vibration at one minute; auto-submit at zero.
  useEffect(() => {
    if (!d.deadline || phase !== "answering") return;
    const deadline = d.deadline;
    const t = setInterval(() => {
      const t2 = Date.now();
      setNow(t2);
      const remaining = (deadline - t2) / 1000;
      if (remaining <= 60 && !vibrated.current) {
        vibrated.current = true;
        navigator.vibrate?.(200);
      }
      if (remaining <= 0) doSubmit(true);
    }, 250);
    return () => clearInterval(t);
  }, [d.deadline, phase, doSubmit]);

  // Time spent per question (fair-play evidence and per-question stats).
  const leaveQuestion = useCallback(() => {
    const spent = Date.now() - enteredAt.current;
    enteredAt.current = Date.now();
    return spent;
  }, []);

  function update(qid: string, patch: Partial<Answer>) {
    const spent = leaveQuestion();
    setAnswers((prev) => {
      const cur = prev[qid] ?? { choice: null, flagged: false, timeSpentMs: 0 };
      const next = { ...cur, ...patch, timeSpentMs: cur.timeSpentMs + spent };
      d.save(qid, next);
      return { ...prev, [qid]: next };
    });
    setSavedFlash(true);
  }

  function go(n: number) {
    const spent = leaveQuestion();
    const cur = answers[q.id];
    if (cur && spent > 0) {
      const next = { ...cur, timeSpentMs: cur.timeSpentMs + spent };
      setAnswers((p) => ({ ...p, [q.id]: next }));
      d.save(q.id, next);
    }
    setSavedFlash(false);
    setI(Math.max(0, Math.min(total - 1, n)));
  }

  async function pick(key: number) {
    if (d.instantFeedback) {
      if (feedback[q.id] || checking) return;
      update(q.id, { choice: key });
      setChecking(true);
      try {
        const f = await d.check!(q.id, key);
        setFeedback((p) => ({ ...p, [q.id]: f }));
      } finally {
        setChecking(false);
      }
      return;
    }
    update(q.id, { choice: key });
  }

  const fb = feedback[q.id];
  // B19: name the option they picked in the trap heading, as review does.
  const pickedText = a.choice == null ? null : (q.options.find((o) => o.key === a.choice)?.text ?? fb?.question.options[a.choice] ?? null);
  const optionState = (key: number): OptionState => {
    if (fb) {
      const correctKey = fb.question.correctOption;
      if (key === correctKey) return a.choice === key ? "picked" : "correct";
      if (key === a.choice) return "wrong";
      return "dim";
    }
    return a.choice === key ? "selected" : "default";
  };

  // B15: full-screen takeover at 0:00.
  if (phase === "timesup") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bad px-8 text-center text-white">
        <span className="font-mono text-[64px] font-bold">00:00</span>
        <strong className="font-display text-[32px]">Time&apos;s up</strong>
        <span className="text-base">Submitting your {answeredCount} answer{answeredCount === 1 ? "" : "s"}…</span>
        <div className="h-1 w-[140px] overflow-hidden rounded bg-white/30"><div className="h-full w-2/3 animate-pulse bg-white" /></div>
      </div>
    );
  }
  // B16
  if (phase === "grading") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-8 text-center">
        <Spinner size={56} color="var(--accent)" />
        <strong className="font-display text-2xl">Marking your paper</strong>
        <span className="text-sm text-ink2">{d.offline ? "Checking against the answer key on this phone" : "Checking your score and updating the leaderboard"}</span>
      </div>
    );
  }
  // B17
  if (phase === "error") {
    return (
      <div className="flex min-h-dvh flex-col justify-between pb-5">
        <div className="flex flex-col items-center gap-3.5 px-7 pt-20 text-center">
          <span className="flex h-[76px] w-[76px] items-center justify-center rounded-3xl bg-flag-tint"><Icon name="cloud" size={38} color="var(--flag-text)" /></span>
          <strong className="font-display text-[26px] leading-tight">Couldn&apos;t reach the server</strong>
          <p className="text-[15px] leading-relaxed text-ink2">
            Your {answeredCount} answers are saved on this phone. We&apos;ll submit them automatically when you&apos;re back online.
            {submitError && !/connection/i.test(submitError) ? ` (${submitError})` : ""}
          </p>
        </div>
        <div className="flex flex-col gap-2 px-[22px]">
          <Button full icon="refresh" onClick={() => doSubmit(false)}>Try again</Button>
          <Button full kind="ghost" onClick={d.onLeave}>Go home</Button>
        </div>
      </div>
    );
  }

  const progressPct = (answeredCount / total) * 100;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header: close, title, timer, navigator */}
      <div className="flex items-center gap-1.5 px-2.5 pt-1">
        <button aria-label="Leave" onClick={() => (d.deadline && MODES[d.mode].ranked ? setLeaveOpen(true) : d.onLeave())} className="flex h-11 w-11 items-center justify-center">
          <Icon name="close" size={22} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[11px] text-ink3">{d.subtitle}</span>
          <span className="truncate text-[13px] font-semibold">{d.title}</span>
        </div>
        {left != null ? (
          <span
            className={`flex items-center gap-1.5 rounded-full py-1.5 pr-3 pl-2.5 font-mono text-[15px] font-bold tabular ${low ? "bg-bad text-white" : "bg-chip text-on-chip"}`}
            role="timer"
            aria-label={`${Math.floor(left / 60)} minutes left`}
          >
            <Icon name="timer" size={16} color={low ? "#FFFFFF" : "#FFD43B"} weight={2.2} />
            {fmtClock(left)}
          </span>
        ) : (
          <span className="px-2.5 font-mono text-[13px] font-bold">{i + 1} / {total}</span>
        )}
        {!d.instantFeedback && (
          <button aria-label="Question navigator" onClick={() => setNavOpen(true)} className="flex h-11 w-11 items-center justify-center">
            <Icon name="grid" size={22} />
          </button>
        )}
      </div>

      {isDrill && total <= 20 ? (
        <div className="flex gap-1.5 px-[18px] pt-2.5" aria-hidden>
          {d.questions.map((x, n) => (
            <span key={x.id} className="h-1.5 flex-1 rounded" style={{ background: n === i ? "var(--ink)" : answers[x.id]?.choice != null ? "var(--accent)" : "var(--raised)" }} />
          ))}
        </div>
      ) : !d.instantFeedback ? (
        <div className="px-4 pt-1.5"><Bar pct={progressPct} height={4} /></div>
      ) : null}

      {low && !lowDismissed && (
        <div className="px-3.5 pt-2">
          <Banner tone="bad" icon="clock" action={<button className="font-bold" onClick={() => { setLowDismissed(true); setNavOpen(true); }}>Show</button>}>
            <strong>5 minutes left.</strong> {unansweredNums.length} unanswered{flaggedNums.length ? `, ${flaggedNums.length} flagged` : ""}.
          </Banner>
        </div>
      )}
      {!online && !d.offline && (
        <div className="px-3.5 pt-2"><Banner icon="offline">No network. Your answers are saved on this phone. Keep going.</Banner></div>
      )}

      <main className="flex flex-1 flex-col gap-3.5 px-5 pt-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-bold tracking-wide text-accent-text">QUESTION {i + 1} OF {total}</span>
          {a.flagged ? (
            <span className="flex items-center gap-1 rounded-md bg-flag-tint px-2 py-1 font-mono text-[11px] font-bold text-flag-text"><Icon name="flag" size={12} weight={2.4} />FLAGGED</span>
          ) : d.negativeMark > 0 ? (
            <span className="rounded-md bg-bad-tint px-2 py-1 font-mono text-[11px] font-bold text-bad-text">WRONG = −{d.negativeMark}</span>
          ) : savedFlash && a.choice != null && !d.instantFeedback ? (
            <span className="flex items-center gap-1 text-xs text-ok-text"><Icon name="check" size={14} weight={2.6} />Saved</span>
          ) : !d.instantFeedback ? (
            <span className="text-xs text-ink3">{answeredCount} answered</span>
          ) : null}
        </div>

        <p className="text-lg leading-relaxed font-medium" style={{ textWrap: "pretty" }}>
          <MathText text={q.text} />
        </p>

        {q.imageUrl && <Figure key={q.id} url={q.imageUrl} alt={q.imageAlt} bytes={q.imageBytes} />}

        <div className={`flex flex-col gap-2.5 ${q.options.length === 5 && q.options.every((o) => o.text.length < 14) ? "grid grid-cols-2" : ""}`} role="radiogroup" aria-label="Options">
          {q.options.map((o, n) => (
            <Option key={o.key} letter={LETTERS[n]} text={o.text} state={optionState(o.key)} tag={fb ? undefined : null} onClick={() => pick(o.key)} disabled={!!fb || checking} />
          ))}
        </div>

        {d.negativeMark > 0 && a.choice != null && !d.instantFeedback && (
          <button onClick={() => update(q.id, { choice: null })} className="flex items-center gap-1.5 self-center p-1 text-sm font-semibold text-accent-text">
            <Icon name="close" size={16} />Clear answer
          </button>
        )}

        {fb && (
          <div className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between">
              <strong className={`text-[15px] ${fb.correct ? "text-ok-text" : "text-ink"}`}>{fb.correct ? "Nice. That's right." : a.choice == null ? "Skipped" : "Not quite."}</strong>
              {fb.xp > 0 && <span className="flex items-center gap-1 rounded-full bg-highlighter px-2.5 py-1 font-mono text-xs font-bold text-exam-ink">+{fb.xp} XP</span>}
            </div>
            {fb.question.explanation && <span className="text-sm leading-relaxed text-ink2"><MathText text={fb.question.explanation} /></span>}
            {fb.question.workedSteps?.length ? (
              <ol className="flex flex-col gap-1.5 text-sm">
                {fb.question.workedSteps.map((s, n) => (
                  <li key={n} className="flex gap-3"><span className="font-mono text-xs font-bold text-accent-text">{n + 1}</span><MathText text={s} /></li>
                ))}
              </ol>
            ) : null}
            {!fb.correct && fb.question.trap && (
              <span className="border-t border-line2 pt-2 text-[13px] leading-snug text-bad-text"><strong>{pickedText != null ? <>Why not &ldquo;<MathText text={pickedText} />&rdquo;?</> : "The trap:"}</strong> <MathText text={fb.question.trap} /></span>
            )}
            {!fb.question.answerVerified && <span className="text-xs text-flag-text">This answer key hasn&apos;t been checked by a tutor yet.</span>}
          </div>
        )}
      </main>

      {/* Bottom bar in the thumb zone */}
      <div className="sticky bottom-0 flex gap-2 border-t border-line bg-surface px-3.5 pt-2.5" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}>
        {d.instantFeedback ? (
          <>
            {fb && !fb.correct && d.onAsk && online && (
              <Button kind="tonal" icon="sparkle" onClick={() => d.onAsk!(q.id, a.choice)}>Ask</Button>
            )}
            {i < total - 1 ? (
              <Button full iconRight="chevR" disabled={!fb} onClick={() => go(i + 1)}>Next question</Button>
            ) : (
              <Button full disabled={!fb} onClick={() => doSubmit(false)}>Finish</Button>
            )}
          </>
        ) : (
          <>
            <Button kind="outline" size="md" icon="back" disabled={i === 0} onClick={() => go(i - 1)}>Prev</Button>
            {a.flagged ? (
              <button onClick={() => update(q.id, { flagged: false })} className="flex h-11 items-center gap-2 rounded-xl border-[1.5px] border-flag bg-flag-tint px-3.5 text-[15px] font-semibold text-flag-text" aria-pressed>
                <Icon name="flag" size={18} fill="var(--flag)" />Flagged
              </button>
            ) : (
              <Button kind="outline" size="md" icon="flag" onClick={() => update(q.id, { flagged: true })}>Flag</Button>
            )}
            {i < total - 1 ? (
              <Button size="md" full iconRight="chevR" onClick={() => go(i + 1)}>Next</Button>
            ) : (
              <Button size="md" full onClick={() => setSubmitOpen(true)}>Submit</Button>
            )}
          </>
        )}
      </div>

      {/* B07 navigator */}
      <Navigator
        open={navOpen}
        onClose={() => setNavOpen(false)}
        questions={d.questions}
        answers={answers}
        current={i}
        left={left}
        onJump={(n) => { go(n); setNavOpen(false); }}
        onSubmit={() => { setNavOpen(false); setSubmitOpen(true); }}
      />

      {/* B13 / B14 */}
      {unansweredNums.length ? (
        <Sheet open={submitOpen} onClose={() => setSubmitOpen(false)} label="Submit">
          <strong className="font-display text-2xl leading-tight">{unansweredNums.length} question{unansweredNums.length === 1 ? "" : "s"} unanswered. Submit anyway?</strong>
          <NumList title="Unanswered" nums={unansweredNums} onPick={(n) => { setSubmitOpen(false); go(n - 1); }} />
          {flaggedNums.length > 0 && <NumList title="Flagged" nums={flaggedNums} flagged onPick={(n) => { setSubmitOpen(false); go(n - 1); }} />}
          {left != null && <span className="text-sm text-ink2">You still have <strong className="font-mono text-ink">{fmtClock(left)}</strong>.</span>}
          <Button full onClick={() => { setSubmitOpen(false); go(unansweredNums[0] - 1); }}>Go to question {unansweredNums[0]}</Button>
          <Button full kind="outline" onClick={() => doSubmit(false)}>Submit anyway</Button>
        </Sheet>
      ) : (
        <Dialog open={submitOpen} onClose={() => setSubmitOpen(false)} label="Submit">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-ok-tint"><Icon name="check" size={28} color="var(--ok-text)" weight={2.6} /></span>
          <strong className="font-display text-[22px]">All {total} answered</strong>
          <span className="text-[15px] leading-relaxed text-ink2">
            {left != null ? `You have ${fmtClock(left)} left` : "Nice"}
            {flaggedNums.length ? ` and ${flaggedNums.length} flagged question${flaggedNums.length === 1 ? "" : "s"} to look at again` : ""}. Once you submit, answers are locked.
          </span>
          <div className="flex gap-2 pt-1">
            <Button kind="outline" full onClick={() => setSubmitOpen(false)}>Check again</Button>
            <Button full onClick={() => doSubmit(false)}>Submit</Button>
          </div>
        </Dialog>
      )}

      {/* B10 */}
      <Dialog open={leaveOpen} onClose={() => setLeaveOpen(false)} label="Leave the exam">
        <strong className="font-display text-[22px]">Leave the exam?</strong>
        <span className="text-[15px] leading-relaxed text-ink2">
          Your {answeredCount} answers are saved. The timer keeps running while you&apos;re away{left != null ? `, so you'll have about ${Math.max(0, Math.round(left / 60))} minutes left if you come back now` : ""}.
        </span>
        <div className="flex flex-col gap-2 pt-1">
          <Button full onClick={() => setLeaveOpen(false)}>Keep going</Button>
          <Button full kind="outline" onClick={d.onLeave}>Leave for now</Button>
        </div>
      </Dialog>
    </div>
  );
}

function NumList({ title, nums, flagged, onPick }: { title: string; nums: number[]; flagged?: boolean; onPick: (n: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-ink2">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {nums.slice(0, 24).map((n) => (
          <button key={n} onClick={() => onPick(n)} className={`flex h-10 w-11 items-center justify-center rounded-[10px] font-mono text-sm font-bold ${flagged ? "border-[1.5px] border-flag bg-flag-tint text-flag-text" : "border-[1.5px] border-line"}`}>
            {n}
          </button>
        ))}
        {nums.length > 24 && <span className="self-center text-sm text-ink3">+{nums.length - 24} more</span>}
      </div>
    </div>
  );
}

function Navigator({
  open, onClose, questions, answers, current, left, onJump, onSubmit,
}: {
  open: boolean; onClose: () => void; questions: SessionQuestion[]; answers: Record<string, Answer>; current: number; left: number | null; onJump: (n: number) => void; onSubmit: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "open" | "flagged">("all");
  const tiles = useMemo(
    () => questions.map((q, n) => ({ n, answered: answers[q.id]?.choice != null, flagged: !!answers[q.id]?.flagged })),
    [questions, answers],
  );
  const shown = tiles.filter((t) => (filter === "open" ? !t.answered : filter === "flagged" ? t.flagged : true));
  const openCount = tiles.filter((t) => !t.answered).length;
  const flagCount = tiles.filter((t) => t.flagged).length;
  return (
    <Sheet open={open} onClose={onClose} label="Questions">
      <div className="flex items-center justify-between">
        <strong className="font-display text-[22px]">Questions</strong>
        {left != null && <span className="font-mono text-sm font-bold">{fmtClock(left)}</span>}
      </div>
      <div className="flex gap-1.5 overflow-x-auto">
        <Pill on={filter === "all"} onClick={() => setFilter("all")}>All {tiles.length}</Pill>
        <Pill on={filter === "open"} onClick={() => setFilter("open")}>Unanswered {openCount}</Pill>
        <Pill on={filter === "flagged"} tone={filter === "flagged" ? undefined : "flag"} onClick={() => setFilter("flagged")}>Flagged {flagCount}</Pill>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {shown.map((t) => {
          const cur = t.n === current;
          const cls = t.flagged ? "bg-flag-tint text-flag-text border-[1.5px] border-flag" : t.answered ? "bg-accent text-on-accent" : "bg-surface border-[1.5px] border-line";
          return (
            <button
              key={t.n}
              onClick={() => onJump(t.n)}
              aria-label={`Question ${t.n + 1}${t.answered ? ", answered" : ""}${t.flagged ? ", flagged" : ""}`}
              className={`relative flex h-[42px] items-center justify-center rounded-[10px] font-mono text-[13px] font-bold ${cls}`}
              style={cur ? { border: "2px solid var(--ink)", boxShadow: "0 0 0 3px var(--accent-tint)" } : undefined}
            >
              {t.n + 1}
              {t.flagged && <span className="absolute top-[3px] right-[3px] h-[7px] w-[7px] rounded-full bg-flag" />}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3.5 text-xs text-ink2">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-accent" />Answered</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border-[1.5px] border-line" />Not yet</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border-[1.5px] border-flag bg-flag-tint" />Flagged</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border-2 border-ink" />Current</span>
      </div>
      <Button full kind="secondary" onClick={onSubmit}>Submit</Button>
    </Sheet>
  );
}

/** B05 / B06: diagrams wait for a tap under Data saver, then open full screen to zoom. */
function Figure({ url, alt, bytes }: { url: string; alt: string | null; bytes: number | null }) {
  const [load, setLoad] = useState(() => !dataSaverOn());
  const [zoom, setZoom] = useState(false);
  if (!load) {
    return (
      <button onClick={() => setLoad(true)} className="flex h-[110px] flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-line bg-raised text-ink2">
        <Icon name="image" size={24} />
        <span className="text-sm font-semibold">Tap to load the figure</span>
        <span className="font-mono text-[11px] text-ink3">{bytes ? `${Math.round(bytes / 1024)} KB · ` : ""}Data saver is on</span>
      </button>
    );
  }
  return (
    <>
      <button onClick={() => setZoom(true)} className="relative flex items-center justify-center overflow-hidden rounded-[14px] border border-line bg-white p-2" aria-label="Open figure full screen">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt ?? "Figure for this question"} className="max-h-[180px] w-auto" />
        <span className="absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-[10px] bg-chip"><Icon name="zoom" size={18} color="#FFFFFF" /></span>
      </button>
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/90 p-4" onClick={() => setZoom(false)} role="dialog" aria-label="Figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={alt ?? ""} className="max-w-none touch-pinch-zoom bg-white" style={{ width: "min(200%, 1200px)" }} />
        </div>
      )}
    </>
  );
}
