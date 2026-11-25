"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { odb, type OfflineAttempt } from "@/lib/offline";
import { bundleQuestions, gradeLocally } from "@/lib/grade-local";
import { useInstall } from "@/lib/install";
import { startOnline } from "@/lib/start";
import type { GradeResult, Result } from "@/lib/types";
import { Gate } from "@/components/gate";
import { KeyedBySearch } from "@/components/keyed";
import { AppBar, Bar, Card, Screen, Sheet, fmtClock } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icon";
import { Mark } from "@/components/ui/logo";
import { BADGES, MODES, levelFor } from "@/shared/game";

export default function ResultPage() {
  return (
    <Gate>
      <Suspense>
        <KeyedBySearch>
          <Router />
        </KeyedBySearch>
      </Suspense>
    </Gate>
  );
}

function Router() {
  const sp = useSearchParams();
  const c = sp.get("c");
  return c ? <OfflineResult clientId={c} /> : <OnlineResult id={sp.get("id") ?? ""} />;
}

function tone(pct: number) {
  return pct >= 70 ? "var(--ok-text)" : pct >= 50 ? "var(--flag-text)" : "var(--bad-text)";
}
function barColor(pct: number) {
  return pct >= 80 ? "var(--ok)" : pct >= 60 ? "var(--flag)" : "var(--bad)";
}

function OnlineResult({ id }: { id: string }) {
  const { data: r } = useApi<Result>(`/attempts/${id}/result`);
  const router = useRouter();
  const [grade] = useState<GradeResult | null>(() => {
    try {
      const g = sessionStorage.getItem(`iq-grade-${id}`);
      return g ? JSON.parse(g) : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);
  const install = useInstall();
  const [installOpen, setInstallOpen] = useState(false);
  const [levelSeen, setLevelSeen] = useState(false);

  useEffect(() => {
    if (r && install.offer) {
      const t = setTimeout(() => setInstallOpen(true), 1200);
      return () => clearTimeout(t);
    }
  }, [r, install.offer]);

  if (!r) return <Screen className="items-center justify-center"><Spinner size={32} color="var(--accent)" /></Screen>;

  // D18: the session that crosses a level line gets its own moment first.
  const lvBefore = grade ? levelFor(grade.xpBefore) : null;
  const lvAfter = grade ? levelFor(grade.totalXp) : null;
  if (lvBefore && lvAfter && lvAfter.n > lvBefore.n && !levelSeen) {
    return (
      <Screen bg="#15132B">
        <main className="flex flex-1 flex-col items-center justify-center gap-4 px-7 text-center text-white">
          <span className="font-mono text-[13px] font-bold tracking-[0.08em] text-highlighter">LEVEL {lvAfter.n} UNLOCKED</span>
          <span className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-violet" style={{ boxShadow: "0 0 0 10px rgba(91,61,245,0.25), 0 0 0 22px rgba(91,61,245,0.12)" }}>
            <Icon name="star" size={56} color="#FFD43B" fill="#FFD43B" weight={1.5} />
          </span>
          <strong className="font-display text-[44px] leading-none font-extrabold tracking-[-0.04em]">{lvAfter.name}</strong>
          <span className="text-[15px] leading-relaxed opacity-80">
            {grade!.totalXp.toLocaleString()} XP.{lvAfter.next ? ` Next up: ${lvAfter.next.name} at ${lvAfter.next.xp.toLocaleString()}.` : " That's the top level."}
          </span>
        </main>
        <div className="flex flex-col gap-2 px-[22px] pt-3 pb-5">
          <ShareButton text={`I just reached ${lvAfter.name} on IntelQA.`} kind="onAccent" />
          <button onClick={() => setLevelSeen(true)} className="p-3 text-[15px] font-semibold text-white">Continue</button>
        </div>
      </Screen>
    );
  }

  const weakest = r.breakdown.find((b) => b.topicId && b.correct / b.total < 0.6);
  const missed = r.wrong + r.skipped;
  const newBadge = grade?.newBadges?.[0] ? BADGES.find((b) => b.key === grade.newBadges[0]) : null;
  const ranked = MODES[r.mode].ranked;
  const moved = grade?.rank?.before && grade.rank.after ? grade.rank.before - grade.rank.after : null;

  async function practise(topicId: string) {
    setBusy(true);
    try {
      router.push(await startOnline({ mode: "topic", topicId }));
    } catch {
      setBusy(false);
    }
  }

  const installSheet = (
    <Sheet open={installOpen} onClose={() => { install.later(); setInstallOpen(false); }} label="Add to home screen">
      {install.ios ? (
        <>
          <strong className="font-display text-2xl leading-tight">Add IntelQA to your home screen</strong>
          <span className="text-sm leading-relaxed text-ink2">On iPhone, that&apos;s the only way to get streak reminders.</span>
          <div className="flex items-center gap-3.5"><Step n={1} /><span className="flex-1 text-[15px]">Tap <strong>Share</strong> in Safari&apos;s toolbar</span><Icon name="share" size={18} color="#0A84FF" /></div>
          <div className="flex items-center gap-3.5"><Step n={2} /><span className="flex-1 text-[15px]">Choose <strong>Add to Home Screen</strong></span><Icon name="plus" size={18} /></div>
          <Button full onClick={() => { install.later(); setInstallOpen(false); }}>Got it</Button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3.5">
            <span className="flex h-16 w-16 items-center justify-center rounded-[22.5%] bg-violet shadow-card"><Mark size={38} variant="violet" /></span>
            <div className="flex flex-col"><strong>IntelQA CBT</strong><span className="text-[13px] text-ink2">Free · works offline</span></div>
          </div>
          <strong className="font-display text-2xl leading-tight">Put it on your home screen</strong>
          <span className="text-[15px] leading-relaxed text-ink2">Opens in one tap, full screen, and works with no data. It isn&apos;t a Play Store download.</span>
          <Button full onClick={async () => { await install.install(); setInstallOpen(false); }}>Add to home screen</Button>
          <Button full kind="ghost" onClick={() => { install.later(); setInstallOpen(false); }}>Maybe later</Button>
        </>
      )}
    </Sheet>
  );

  // C02: perfect score, badge inside the result.
  if (r.percent === 100 && r.maxScore >= 10) {
    return (
      <Screen bg="#5B3DF5">
        <div className="flex justify-between px-2 pt-1.5 text-white">
          <button aria-label="Close" onClick={() => router.push("/home")} className="flex h-11 w-11 items-center justify-center"><Icon name="close" size={22} color="#FFFFFF" /></button>
        </div>
        <main className="flex flex-1 flex-col items-center gap-3.5 px-6 pt-2.5 text-center text-white">
          <span className="font-mono text-[11px] tracking-wide opacity-85">{r.course.code} · {MODES[r.mode].label.toUpperCase()}</span>
          <strong className="font-display text-[96px] leading-[0.9] font-extrabold tracking-[-0.06em]">{r.score}/{r.maxScore}</strong>
          <span>Every one. In {fmtClock(r.timeTakenSec)}.</span>
          {newBadge && (
            <div className="mt-2.5 flex w-full flex-col items-center gap-2.5 rounded-[22px] bg-white p-[18px] text-exam-ink">
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-highlighter" style={{ boxShadow: "0 0 0 6px #FFF6CC" }}>
                <Icon name={newBadge.glyph} size={36} color="#15132B" fill="#15132B" weight={1.5} />
              </span>
              <span className="font-mono text-[11px] font-bold tracking-wide text-violet-deep">BADGE UNLOCKED</span>
              <strong className="font-display text-[22px]">{newBadge.name}</strong>
              <span className="text-sm text-[#4A4860]">{newBadge.sub}</span>
            </div>
          )}
          <span className="flex items-center gap-1.5 rounded-full bg-highlighter px-3 py-1.5 font-mono text-sm font-bold text-exam-ink">
            <Icon name="bolt" size={15} color="#15132B" fill="#15132B" weight={1.5} />+{r.xpEarned} XP
          </span>
        </main>
        <div className="flex flex-col gap-2 px-5 pt-3 pb-5">
          <ShareButton text={`I got ${r.score}/${r.maxScore} on ${r.course.code}. Your turn 👀`} kind="onAccent" />
          <button onClick={() => router.push("/home")} className="p-3 text-[15px] font-semibold text-white">Done</button>
        </div>
        {installSheet}
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar lead="close" onLead={() => router.push("/home")} />
      <main className="flex flex-1 flex-col gap-3 px-5">
        <div className="flex flex-col gap-0.5">
          <span className="label">{r.course.code} · {MODES[r.mode].label}</span>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <strong className="font-display text-[64px] leading-none font-extrabold tracking-[-0.05em]">
              {r.negativeMark > 0 ? r.score : `${r.score}/${r.maxScore}`}
            </strong>
            <span className="font-display text-[28px] font-bold" style={{ color: tone(r.percent) }}>
              {r.negativeMark > 0 ? `/${r.maxScore} · ` : ""}{Math.round(r.percent)}%
            </span>
          </div>
          {r.autoSubmitted && <span className="text-[13px] text-ink3">Submitted automatically when time ran out.</span>}
        </div>

        <div className="flex gap-2">
          <Card className="flex flex-1 flex-col gap-0.5 rounded-[14px] px-3 py-2.5">
            <span className="text-xs text-ink2">Time</span>
            <strong className="font-mono text-base">{fmtClock(r.timeTakenSec)}</strong>
          </Card>
          <div className="flex flex-1 flex-col gap-0.5 rounded-[14px] bg-highlighter px-3 py-2.5 text-exam-ink">
            <span className="text-xs">XP{grade && grade.xp.multiplier > 1 ? ` · ${grade.xp.multiplier}× streak` : " earned"}</span>
            <strong className="font-mono text-base">+{r.xpEarned}</strong>
          </div>
        </div>

        {newBadge && (
          <div className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-3.5">
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-highlighter" style={{ boxShadow: "0 0 0 4px #FFF6CC" }}>
              <Icon name={newBadge.glyph} size={24} color="#15132B" />
            </span>
            <div className="flex flex-col">
              <span className="font-mono text-[11px] font-bold tracking-wide text-accent-text">BADGE UNLOCKED</span>
              <strong className="text-[15px]">{newBadge.name}</strong>
              <span className="text-[13px] text-ink2">{newBadge.sub}</span>
            </div>
          </div>
        )}

        {/* C05 */}
        {r.flagged && r.reviewStatus === "pending" && (
          <div className="flex flex-col gap-2 rounded-[18px] bg-flag-tint p-4 text-flag-text">
            <div className="flex items-center gap-2.5"><Icon name="shield" size={22} /><strong className="text-[15px]">Rank update is being checked</strong></div>
            <span className="text-sm leading-relaxed">That was under 3 seconds a question. We check very fast runs before they go on the board to keep it fair. Most checks finish within a day. Your XP is already added.</span>
          </div>
        )}

        {/* C06 */}
        {r.negativeMark > 0 && (
          <Card className="flex flex-col">
            <Row icon="check" color="var(--ok-text)" label={`${r.correct} correct`} value={`+${r.correct.toFixed(2)}`} />
            <Row icon="cross" color="var(--bad-text)" label={`${r.wrong} wrong × −${r.negativeMark}`} value={`−${(r.wrong * r.negativeMark).toFixed(2)}`} valueColor="var(--bad-text)" />
            <Row icon="minus" color="var(--ink3)" label={`${r.skipped} skipped`} value="0.00" valueColor="var(--ink3)" />
            <div className="flex justify-between px-3.5 py-3 text-[15px] font-bold"><span>Score</span><span className="font-mono">{r.score.toFixed(2)}</span></div>
          </Card>
        )}

        {/* C01 rank / C04 not ranked yet */}
        {ranked && !r.flagged && !r.offline && (r.rank ? (
          <div className="flex items-center gap-3 rounded-[18px] bg-accent px-4 py-3.5 text-on-accent">
            <Icon name={moved && moved > 0 ? "arrowUp" : "board"} size={26} weight={2.6} />
            <div className="flex flex-1 flex-col gap-0.5">
              <strong className="text-base">{moved && moved > 0 ? `You moved up ${moved} place${moved === 1 ? "" : "s"}` : `You're #${r.rank.position} in ${r.course.code}`}</strong>
              <span className="text-[13px] opacity-90">
                #{r.rank.position} of {r.rank.total.toLocaleString()}
                {r.rank.ahead ? ` · ${r.rank.ahead.name} is ${r.rank.ahead.gap || "just"} ${r.rank.ahead.gap === 1 ? "place" : r.rank.ahead.gap ? "places" : ""} ahead` : ""}
              </span>
            </div>
          </div>
        ) : (
          <Card className="flex flex-col gap-3 rounded-[18px] p-4">
            <div className="flex items-center gap-2.5"><Icon name="board" size={22} color="var(--accent-text)" /><strong className="text-[15px]">{Math.max(1, 3 - r.rankedAttempts)} more session{3 - r.rankedAttempts === 1 ? "" : "s"} to get ranked</strong></div>
            <div className="flex gap-1.5">{[0, 1, 2].map((n) => <span key={n} className="h-2.5 flex-1 rounded" style={{ background: n < r.rankedAttempts ? "var(--accent)" : "var(--raised)" }} />)}</div>
            <span className="text-sm leading-relaxed text-ink2">Course boards need 3 drills or exams so one lucky run can&apos;t top them.</span>
          </Card>
        ))}

        {/* C03: facts first, one next step */}
        {r.percent < 40 && weakest && (
          <Card className="flex flex-col gap-1.5 rounded-[18px] p-3.5">
            <strong className="text-[15px]">Most marks went on {weakest.name.toLowerCase()}</strong>
            <span className="text-sm leading-relaxed text-ink2">{weakest.total - weakest.correct} of your {missed} misses were on this one topic.</span>
          </Card>
        )}

        {r.breakdown.length > 1 && (
          <>
            <span className="label pt-1">By topic</span>
            <div className="flex flex-col gap-2.5">
              {r.breakdown.slice(0, 6).map((b) => {
                const pct = (b.correct / b.total) * 100;
                return (
                  <div key={b.name} className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-sm"><span>{b.name}</span><strong className="font-mono" style={{ color: tone(pct) }}>{b.correct}/{b.total}</strong></div>
                    <Bar pct={pct} color={barColor(pct)} />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
      <div className="flex flex-col gap-2 px-5 pt-3 pb-4">
        {r.percent < 40 && weakest ? (
          <>
            <Button full loading={busy} onClick={() => practise(weakest.topicId!)}>Practise {weakest.name.toLowerCase()}</Button>
            <ButtonLink href={`/review?id=${id}`} kind="outline" full>Review {missed} answer{missed === 1 ? "" : "s"}</ButtonLink>
          </>
        ) : (
          <>
            <ButtonLink href={`/review?id=${id}${missed ? "" : "&filter=all"}`} full>{missed ? `Review ${missed} answer${missed === 1 ? "" : "s"}` : "Review answers"}</ButtonLink>
            {weakest ? (
              <Button kind="ghost" full loading={busy} onClick={() => practise(weakest.topicId!)}>Practise {weakest.name.toLowerCase()}</Button>
            ) : (
              <ShareButton text={`I got ${r.score}/${r.maxScore} on ${r.course.code}. Think you can beat me?`} kind="ghost" />
            )}
          </>
        )}
        {r.mode === "quiz" && r.quizId && <ButtonLink href={`/quiz?id=${r.quizId}`} kind="tonal" full>Sit this quiz again</ButtonLink>}
        {r.paperId && (r.mode === "exam" || r.mode === "challenge") && <ChallengeButton paperId={r.paperId} code={r.course.code} score={`${r.score}/${r.maxScore}`} />}
      </div>
      {installSheet}
    </Screen>
  );
}

/** D09: the link carries your best score on this paper, so the friend knows the target. */
function ChallengeButton({ paperId, code, score }: { paperId: string; code: string; score: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      kind="tonal"
      icon="trophy"
      full
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const ch = await api<{ code: string }>("/challenges", { method: "POST", body: { paperId } });
          const text = `I got ${score} on ${code}. Your turn 👀 ${window.location.origin}/c/${ch.code}`;
          if (navigator.share) await navigator.share({ text }).catch(() => {});
          else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
        } finally {
          setBusy(false);
        }
      }}
    >
      Challenge a friend
    </Button>
  );
}

function Step({ n }: { n: number }) {
  return <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent-tint font-mono font-bold text-accent-text">{n}</span>;
}

function Row({ icon, color, label, value, valueColor }: { icon: "check" | "cross" | "minus"; color: string; label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between border-b border-line2 px-3.5 py-3 text-[15px]">
      <span className="flex items-center gap-2"><Icon name={icon} size={16} color={color} weight={2.6} />{label}</span>
      <strong className="font-mono" style={{ color: valueColor }}>{value}</strong>
    </div>
  );
}

function ShareButton({ text, kind }: { text: string; kind: "onAccent" | "ghost" }) {
  const url = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <Button
      kind={kind}
      icon="share"
      full
      onClick={async () => {
        const msg = `${text} ${url}`;
        if (navigator.share) await navigator.share({ text: msg }).catch(() => {});
        else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
      }}
    >
      Share to WhatsApp
    </Button>
  );
}

/** Finished offline: provisional score from the downloaded key, synced later. */
function OfflineResult({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [a, setA] = useState<OfflineAttempt | null>(null);
  const [g, setG] = useState<ReturnType<typeof gradeLocally> | null>(null);
  useEffect(() => {
    (async () => {
      const row = await odb().offlineAttempts.get(clientId);
      if (!row) return;
      const { map } = await bundleQuestions(row.courseId);
      setA(row);
      setG(gradeLocally(row, map));
    })();
  }, [clientId]);
  const pct = useMemo(() => (g ? Math.max(0, (g.score / g.maxScore) * 100) : 0), [g]);
  if (!a || !g) return <Screen className="items-center justify-center"><Spinner size={32} color="var(--accent)" /></Screen>;
  return (
    <Screen>
      <AppBar lead="close" onLead={() => router.push("/home")} />
      <main className="flex flex-1 flex-col gap-3 px-5">
        <span className="label">{a.title}</span>
        <div className="flex items-baseline gap-2.5">
          <strong className="font-display text-[64px] leading-none font-extrabold tracking-[-0.05em]">{g.score}/{g.maxScore}</strong>
          <span className="font-display text-[28px] font-bold" style={{ color: tone(pct) }}>{Math.round(pct)}%</span>
        </div>
        <div className="flex gap-2.5 rounded-2xl bg-raised px-3.5 py-3 text-[13px] leading-relaxed text-ink2">
          <Icon name="cloud" size={20} />
          <span>{a.synced ? "Synced. XP has been added to your profile." : "Provisional: scored with the answer key on this phone. XP is added once it syncs. Offline sessions don't change your course rank."}</span>
        </div>
      </main>
      <div className="flex flex-col gap-2 px-5 pt-3 pb-4">
        <ButtonLink href={`/review?c=${clientId}`} full>Review {g.wrong + g.skipped} answer{g.wrong + g.skipped === 1 ? "" : "s"}</ButtonLink>
        <Link href="/home" className="p-3 text-center font-semibold text-accent-text">Done</Link>
      </div>
    </Screen>
  );
}
