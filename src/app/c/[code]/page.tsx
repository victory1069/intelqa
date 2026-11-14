"use client";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setNext } from "@/lib/next-url";
import { startOnline } from "@/lib/start";
import { Avatar, Card, EmptyState, Screen, fmtClock } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Spinner } from "@/components/ui/icon";

type Challenge = {
  code: string;
  expired: boolean;
  expiresAt: string;
  creator: { name: string; department: string | null };
  course: { id: string; code: string; title: string };
  paper: { id: string; session: string; examType: string; timeLimitMin: number; questions: number };
  target: { score: number; maxScore: number; timeTakenSec: number } | null;
};
type Side = { score: number; maxScore: number; percent: number; timeTakenSec: number } | null;
type Compare = { you: Side; them: { name: string } & Partial<NonNullable<Side>>; topics: { name: string; you: { correct: number; total: number } | null; them: { correct: number; total: number } | null }[]; paperId: string };

/** D10 (landing, no account needed) and D11 (both results side by side). */
function ChallengePage() {
  const { code } = useParams<{ code: string }>();
  const { status, me } = useAuth();
  const router = useRouter();
  const [ch, setCh] = useState<Challenge | null>(null);
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/public/challenges/${code}`)
      .then(async (r) => (r.ok ? setCh(await r.json()) : setErr((await r.json()).error)))
      .catch(() => setErr("No connection. Open the link again when you have data."));
  }, [code]);
  useEffect(() => {
    if (status === "signedIn" && me?.onboarded) api<Compare>(`/challenges/${code}/compare`).then(setCmp).catch(() => {});
  }, [status, me, code]);

  if (err) {
    return (
      <Screen>
        <div className="px-[22px] pt-3.5"><Logo size={22} /></div>
        <EmptyState glyph="link" title="This challenge doesn't exist">{err}</EmptyState>
      </Screen>
    );
  }
  if (!ch) return <Screen className="items-center justify-center"><Spinner size={32} color="var(--accent)" /></Screen>;

  // E15: expired link still points somewhere useful.
  if (ch.expired && !cmp?.you) {
    return (
      <Screen>
        <div className="px-[22px] pt-3.5"><Logo size={22} /></div>
        <div className="flex flex-1 flex-col items-center gap-3.5 px-7 pt-[70px] text-center">
          <span className="font-display text-[72px] leading-none font-extrabold text-accent">404</span>
          <strong className="font-display text-2xl">This challenge has ended</strong>
          <p className="text-[15px] leading-relaxed text-ink2">Challenge links last 7 days. You can still sit the same paper, {ch.course.code} {ch.paper.session}, on your own.</p>
        </div>
        <div className="flex flex-col gap-2 px-[22px] pb-5">
          <Button full onClick={() => router.push(`/course?id=${ch.course.id}`)}>Sit the paper</Button>
          <Button full kind="ghost" onClick={() => router.push("/home")}>Go home</Button>
        </div>
      </Screen>
    );
  }

  async function accept() {
    if (status !== "signedIn" || !me?.onboarded) {
      setNext(`/c/${code}`);
      router.push(status === "signedIn" ? "/setup" : "/welcome");
      return;
    }
    setBusy(true);
    try {
      router.push(await startOnline({ mode: "challenge", challengeCode: code }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  // D11
  if (cmp?.you) {
    const won = (cmp.you.score ?? 0) > (cmp.them.score ?? -1) || ((cmp.you.score ?? 0) === (cmp.them.score ?? -1) && cmp.you.timeTakenSec < (cmp.them.timeTakenSec ?? Infinity));
    return (
      <Screen>
        <div className="flex h-14 items-center px-5"><strong className="font-display text-lg">You vs {cmp.them.name?.split(" ")[0]}</strong><span className="ml-2 font-mono text-[11px] text-ink3">{ch.course.code} · {ch.paper.session}</span></div>
        <main className="flex flex-1 flex-col gap-3 px-5">
          <div className="flex gap-2">
            <Side name="You" initialsOf={me?.displayName ?? "You"} score={cmp.you.score} max={cmp.you.maxScore} win={won} highlight />
            <Side name={cmp.them.name ?? ""} initialsOf={cmp.them.name ?? ""} score={cmp.them.score ?? 0} max={cmp.them.maxScore ?? ch.paper.questions} win={!won} />
          </div>
          <Card className="flex flex-col rounded-[18px]">
            <CmpRow left={fmtClock(cmp.you.timeTakenSec)} label="Time" right={fmtClock(cmp.them.timeTakenSec ?? 0)} leftWins={cmp.you.timeTakenSec <= (cmp.them.timeTakenSec ?? Infinity)} />
            {cmp.topics.map((t) => (
              <CmpRow key={t.name} left={t.you ? `${t.you.correct}/${t.you.total}` : "—"} label={t.name} right={t.them ? `${t.them.correct}/${t.them.total}` : "—"} leftWins={(t.you?.correct ?? 0) >= (t.them?.correct ?? 0)} />
            ))}
          </Card>
        </main>
        <div className="flex gap-2 px-5 pt-3 pb-4">
          <Button kind="outline" icon="share" full onClick={() => { const t = `I got ${cmp.you!.score}/${cmp.you!.maxScore} on ${ch.course.code} ${ch.paper.session}. ${window.location.href}`; if (navigator.share) navigator.share({ text: t }).catch(() => {}); else window.open(`https://wa.me/?text=${encodeURIComponent(t)}`); }}>Share result</Button>
          <Button full loading={busy} onClick={accept}>Rematch</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="px-[22px] pt-3.5"><Logo size={22} /></div>
      <main className="flex flex-1 flex-col gap-5 px-[22px] pt-[30px]">
        <div className="flex items-center gap-3">
          <Avatar name={ch.creator.name} size={56} me />
          <div className="flex flex-col"><strong className="text-base">{ch.creator.name}</strong><span className="text-[13px] text-ink2">{ch.creator.department ?? ""}</span></div>
        </div>
        <strong className="font-display text-[34px] leading-[1.05] font-extrabold">challenged you to {ch.course.code}</strong>
        {ch.target && (
          <div className="flex flex-col gap-3 rounded-[22px] bg-chip p-[18px] text-on-chip">
            <span className="font-mono text-[11px] tracking-wide text-highlighter">SCORE TO BEAT</span>
            <div className="flex items-baseline gap-2.5">
              <strong className="font-display text-[52px] leading-none font-extrabold">{ch.target.score}/{ch.target.maxScore}</strong>
              <span className="font-mono text-sm">in {fmtClock(ch.target.timeTakenSec)}</span>
            </div>
            <span className="text-sm opacity-85">{ch.paper.session} {ch.paper.examType} · {ch.paper.questions} questions · {ch.paper.timeLimitMin} minutes</span>
          </div>
        )}
        <span className="text-[13px] text-ink3">Challenge open until {new Date(ch.expiresAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
      </main>
      <div className="flex flex-col gap-2 px-[22px] pt-3 pb-5">
        <Button full loading={busy} onClick={accept}>Accept challenge</Button>
        <Button full kind="ghost" onClick={() => router.push("/welcome")}>What is IntelQA?</Button>
      </div>
    </Screen>
  );
}

function Side({ name, initialsOf, score, max, win, highlight }: { name: string; initialsOf: string; score: number; max: number; win: boolean; highlight?: boolean }) {
  return (
    <div className={`flex flex-1 flex-col items-center gap-1.5 rounded-[20px] p-4 ${highlight ? "bg-accent text-on-accent" : "border border-line bg-surface"}`}>
      <Avatar name={initialsOf} size={44} me={highlight} />
      <span className="text-[13px]">{name}</span>
      <strong className="font-display text-[34px]">{score}</strong>
      {win ? <span className="rounded-md bg-highlighter px-1.5 py-0.5 font-mono text-[11px] font-bold text-exam-ink">WINNER</span> : <span className="py-0.5 font-mono text-[11px] text-ink3">OUT OF {max}</span>}
    </div>
  );
}

function CmpRow({ left, label, right, leftWins }: { left: string; label: string; right: string; leftWins: boolean }) {
  return (
    <div className="flex border-b border-line2 px-3.5 py-3 text-sm last:border-0">
      <span className={`flex-1 font-mono ${leftWins ? "font-bold" : ""}`}>{left}</span>
      <span className="text-ink3">{label}</span>
      <span className={`flex-1 text-right font-mono ${!leftWins ? "font-bold" : ""}`}>{right}</span>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ChallengePage />
    </Suspense>
  );
}
