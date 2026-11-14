"use client";
import { useApi } from "@/lib/use-api";
import type { Streak } from "@/lib/types";
import { AppBar, Card } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";
import { STREAK_LADDER } from "@/shared/game";

type StreakData = Streak & { month: string; activeDays: string[] };

/** D15: calendar, multiplier ladder and freezes in one place. */
export default function StreakPage() {
  const { data } = useApi<StreakData>("/me/streak");
  if (!data) return <AppBar title="Streak" />;
  const [y, m] = data.month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const active = new Set(data.activeDays);
  const today = new Date().toISOString().slice(0, 10);
  const monthName = first.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const nextRung = STREAK_LADDER.find((r) => r.days > data.current);

  return (
    <>
      <AppBar title="Streak" />
      <main className="flex flex-col gap-5 px-5 pb-5">
        <div className="flex items-center gap-3.5">
          <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-highlighter"><Icon name="flame" size={34} color="#15132B" fill="#15132B" weight={1.5} /></span>
          <div className="flex flex-col">
            <strong className="font-display text-[32px] leading-none">{data.current} day{data.current === 1 ? "" : "s"}</strong>
            <span className="text-[13px] text-ink2">Best: {data.best} days</span>
          </div>
        </div>
        <Card className="flex flex-col gap-4 rounded-[18px] p-5">
          <div className="flex justify-between"><strong className="text-sm">{monthName}</strong><span className="text-xs text-ink3">{data.activeDays.length} day{data.activeDays.length === 1 ? "" : "s"} practised</span></div>
          <div className="grid grid-cols-7 gap-1.5 text-center font-mono text-[10px] text-ink3">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: lead }, (_, i) => <span key={`e${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const iso = `${data.month}-${String(i + 1).padStart(2, "0")}`;
              const done = active.has(iso);
              const future = iso > today;
              return (
                <span
                  key={iso}
                  className="flex aspect-square items-center justify-center rounded-[9px] font-mono text-[11px] font-bold"
                  style={{
                    background: done ? "#FFD43B" : future ? "transparent" : "var(--raised)",
                    color: done ? "#15132B" : "var(--ink3)",
                    border: iso === today ? "2px solid var(--ink)" : future ? "1.5px dashed var(--line)" : "0",
                  }}
                >
                  {i + 1}
                </span>
              );
            })}
          </div>
        </Card>
        <Card className="flex flex-col rounded-[18px]">
          {STREAK_LADDER.map((r, i) => {
            const reached = data.current >= r.days;
            const isNext = r === nextRung;
            return (
              <div key={r.days} className={`flex items-center px-5 py-4 text-sm ${i ? "border-t border-line2" : ""} ${isNext ? "bg-hl-tint" : ""} ${!reached && !isNext ? "text-ink2" : ""}`}>
                <span className={`flex-1 ${isNext ? "font-semibold" : ""}`}>{r.days} days{isNext ? ` · ${r.days - data.current === 1 ? "tomorrow" : `in ${r.days - data.current} days`}` : ""}</span>
                <strong className="font-mono" style={{ color: reached ? "var(--ok-text)" : undefined }}>{r.multiplier}×{reached ? " ✓" : ""}</strong>
              </div>
            );
          })}
        </Card>
        <div className="flex items-center gap-2.5 rounded-2xl bg-accent-tint px-5 py-4 text-[13px] text-accent-text">
          <Icon name="snow" size={20} />
          <span className="flex-1">{data.freezes} freeze{data.freezes === 1 ? "" : "s"}. You earn one for every 7 days in a row. It&apos;s used for you on a missed day.</span>
        </div>
      </main>
    </>
  );
}
