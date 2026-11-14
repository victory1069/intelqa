"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApi } from "@/lib/use-api";
import { useAuth } from "@/lib/auth";
import { startOnline } from "@/lib/start";
import type { ApiError } from "@/lib/api";
import type { Board } from "@/lib/types";
import { AppBar, Banner, Card, fmtClock } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export default function DailyPage() {
  return (
    <Suspense>
      <Daily />
    </Suspense>
  );
}

/** B21 before playing, A29 after. */
function Daily() {
  const courseId = useSearchParams().get("course") ?? "";
  const { me } = useAuth();
  const router = useRouter();
  const { data } = useApi<Board>(courseId ? `/leaderboard?board=daily&course=${courseId}` : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const code = me?.courses.find((c) => c.id === courseId)?.code ?? "";
  const date = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  const left = data?.resetsAt ? (Date.parse(data.resetsAt) - now) / 1000 : 0;

  if (data?.me) {
    return (
      <>
        <AppBar title="Daily challenge" sub={`${code} · ${date}`} />
        <main className="flex flex-1 flex-col gap-5 px-5">
          <div className="flex flex-col gap-1.5 rounded-[22px] bg-accent p-7 text-on-accent">
            <span className="font-mono text-[11px] font-bold tracking-wide opacity-85">TODAY&apos;S RESULT</span>
            <div className="flex items-baseline gap-2.5">
              <strong className="font-display text-[56px] leading-none font-extrabold">{data.me.value}/10</strong>
              <span className="font-mono text-sm">in {fmtClock(data.me.extra ?? 0)}</span>
            </div>
            <span className="text-[15px]">#{data.me.rank} of {data.total.toLocaleString()} so far today</span>
          </div>
          <Card className="flex items-center gap-3 rounded-[18px] p-5">
            <Icon name="clock" size={22} color="var(--ink2)" />
            <span className="flex-1 text-sm text-ink2">Next challenge in <strong className="font-mono text-ink">{fmtClock(left)}</strong></span>
          </Card>
          <ButtonLink href="/ranks" kind="secondary" size="md" full>See the board</ButtonLink>
        </main>
      </>
    );
  }

  return (
    <>
      <AppBar title="Daily challenge" sub={`${code} · ${date}`} lead="close" />
      <main className="flex flex-1 flex-col gap-8 px-[22px] pt-2.5">
        <div className="flex flex-col gap-4 rounded-3xl bg-highlighter p-8 text-exam-ink">
          <Icon name="calendar" size={32} color="#15132B" />
          <strong className="font-display text-[30px] leading-[1.05] font-extrabold">10 questions.<br />Same for everyone.</strong>
          <span className="text-[15px] leading-snug">Ranked by score, then by time taken. You get one go today.</span>
        </div>
        <ul className="flex flex-col gap-4 text-sm text-ink2">
          <li className="flex items-center gap-2.5"><Icon name="users" size={18} />{(data?.total ?? 0).toLocaleString()} played so far{data?.top[0] ? ` · best ${data.top[0].value}/10 in ${fmtClock(data.top[0].extra ?? 0)}` : ""}</li>
          <li className="flex items-center gap-2.5"><Icon name="timer" size={18} />8 minutes max</li>
          <li className="flex items-center gap-2.5"><Icon name="bolt" size={18} />Counts toward your streak</li>
        </ul>
        {err && <Banner tone="bad" icon="alert">{err}</Banner>}
      </main>
      <div className="px-[22px] pt-3 pb-5">
        <Button
          full
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              router.push(await startOnline({ mode: "daily", courseId }));
            } catch (e) {
              setErr((e as ApiError).message);
              setBusy(false);
            }
          }}
        >
          Start challenge
        </Button>
      </div>
    </>
  );
}
