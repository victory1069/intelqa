"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/use-api";
import { Header, Panel, inputCls, useMyCourses } from "@/components/admin/kit";
import { LETTERS } from "@/shared/game";

type Analytics = {
  series: { week: string; active: number; sessions: number; avgScore: number | null }[];
  retention3Days: number;
  retentionTarget: number;
  tenPlusGain: number | null;
  signups: { name: string; status: string; students: number; requests: number }[];
  suspectKeys: { id: string; text: string; session: string | null; number: number | null; key: number; top: number; top_pct: number }[];
};

const weekLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * One measure per chart (no shared axis for counts and percentages). Thin bars with rounded
 * tops on a baseline, a hover tooltip per bar, and only the latest value labelled.
 */
function Bars({ title, data, format, max }: { title: string; data: { label: string; value: number | null }[]; format: (v: number) => string; max?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = max ?? Math.max(1, ...data.map((d) => d.value ?? 0));
  const last = data.length - 1;
  return (
    <Panel className="flex flex-col gap-5 p-6">
      <strong className="text-[15px]">{title}</strong>
      <div className="relative flex h-44 items-end gap-1.5 border-b border-line sm:gap-3" role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${d.value == null ? "no data" : format(d.value)}`).join(", ")}`}>
        {data.map((d, i) => (
          <div key={d.label} className="relative flex h-full flex-1 flex-col items-center justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {(i === last || hover === i) && d.value != null && (
              <span className={`absolute z-10 rounded-md px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${hover === i ? "bg-chip text-on-chip" : "text-ink2"}`} style={{ bottom: `calc(${((d.value ?? 0) / top) * 100}% + 4px)` }}>
                {hover === i ? `${d.label} · ${format(d.value)}` : format(d.value)}
              </span>
            )}
            <div className="w-full max-w-7 rounded-t" style={{ height: `${Math.max(d.value ? 2 : 0, ((d.value ?? 0) / top) * 100)}%`, background: "var(--accent)", opacity: hover == null || hover === i ? 1 : 0.55 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 sm:gap-3">{data.map((d) => <span key={d.label} className="min-w-0 flex-1 overflow-hidden text-center font-mono text-[11px] text-ink3">{d.label}</span>)}</div>
    </Panel>
  );
}

/** F18: built to answer whether students come back. */
export default function AnalyticsPage() {
  const { data: mine } = useMyCourses();
  const [picked, setCourse] = useState("");
  const course = picked || mine?.courses[0]?.id || "";
  const [weeks, setWeeks] = useState(8);
  const { data } = useApi<Analytics>(course ? `/admin/analytics?course=${course}&weeks=${weeks}` : null);
  const s = data?.series ?? [];
  const latest = s.at(-1);
  const prev = s.at(-2);
  const kpis = [
    ["Weekly active", latest?.active ?? 0, prev ? latest!.active - prev.active : null, ""],
    ["Sessions this week", latest?.sessions ?? 0, prev ? latest!.sessions - prev.sessions : null, ""],
    ["Avg score", latest?.avgScore != null ? `${latest.avgScore}%` : "—", prev && latest?.avgScore != null && prev.avgScore != null ? latest.avgScore - prev.avgScore : null, " pts"],
    ["10+ session students", data?.tenPlusGain != null ? `${data.tenPlusGain >= 0 ? "+" : ""}${data.tenPlusGain} pts` : "—", null, "score gain since their first sessions"],
  ] as const;
  const maxSignups = Math.max(1, ...(data?.signups ?? []).map((x) => x.students + x.requests));

  return (
    <>
      <Header title="Analytics">
        <select value={course} onChange={(e) => setCourse(e.target.value)} className={`${inputCls} h-10 font-semibold`} aria-label="Course">
          {mine?.courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select>
        <div className="flex rounded-[10px] bg-raised p-[3px]" role="tablist">
          {[[4, "4 weeks"], [8, "8 weeks"], [16, "Semester"]].map(([w, l]) => (
            <button key={w} role="tab" aria-selected={weeks === w} onClick={() => setWeeks(w as number)} className={`rounded-lg px-3 py-1.5 text-[13px] ${weeks === w ? "bg-surface font-semibold shadow-card" : "text-ink2"}`}>{l}</button>
          ))}
        </div>
      </Header>
      <main className="flex flex-col gap-6 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          {kpis.map(([l, v, d, unit]) => (
            <Panel key={l} className="flex flex-col gap-1 p-6">
              <span className="text-xs text-ink2">{l}</span>
              <strong className="font-display text-[28px]">{typeof v === "number" ? v.toLocaleString() : v}</strong>
              {d != null ? (
                <span className="text-xs font-semibold" style={{ color: d >= 0 ? "var(--ok-text)" : "var(--bad-text)" }}>{d >= 0 ? "↑" : "↓"} {Math.abs(d)}{unit || ""} vs last week</span>
              ) : unit && unit.length > 4 ? (
                <span className="text-xs text-ink2">{unit}</span>
              ) : null}
            </Panel>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Bars title="Weekly active students" data={s.map((x) => ({ label: weekLabel(x.week), value: x.active }))} format={(v) => v.toLocaleString()} />
          <Bars title="Average score" data={s.map((x) => ({ label: weekLabel(x.week), value: x.avgScore }))} format={(v) => `${v}%`} max={100} />
        </div>
        {!s.length && <span className="text-sm text-ink3">No sessions in this period yet.</span>}
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <Panel className="flex flex-col gap-5 p-6">
            <strong className="text-[15px]">Back 3+ days this week</strong>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <strong className="font-display text-[40px]">{data?.retention3Days ?? 0}%</strong>
              <span className="text-[13px] font-semibold" style={{ color: (data?.retention3Days ?? 0) >= (data?.retentionTarget ?? 40) ? "var(--ok-text)" : "var(--ink2)" }}>
                {(data?.retention3Days ?? 0) >= (data?.retentionTarget ?? 40) ? "above" : "below"} the {data?.retentionTarget ?? 40}% target
              </span>
            </div>
            <div className="relative h-3 rounded-md bg-raised" role="meter" aria-valuenow={data?.retention3Days ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Students back 3 or more days">
              <div className="h-full rounded-md bg-accent" style={{ width: `${data?.retention3Days ?? 0}%` }} />
              <span className="absolute -top-1 h-5 w-0.5 bg-ink" style={{ left: `${data?.retentionTarget ?? 40}%` }} title="Target" />
            </div>
            <span className="text-xs text-ink3">Share of this week&apos;s active students who practised on 3 or more different days.</span>
          </Panel>
          <Panel className="flex flex-col gap-4 p-6">
            <strong className="text-[15px]">Students and school requests</strong>
            {data?.signups.map((x) => (
              <div key={x.name + x.status} className="flex flex-col gap-1">
                <div className="flex justify-between text-[13px]"><span>{x.name}{x.status !== "live" ? ` · ${x.status === "requested" ? "requests" : "waitlist"}` : ""}</span><strong className="font-mono">{(x.students + x.requests).toLocaleString()}</strong></div>
                <div className="h-2 rounded bg-raised"><div className="h-full rounded" style={{ width: `${((x.students + x.requests) / maxSignups) * 100}%`, background: x.status === "live" ? "var(--accent)" : "var(--ink3)" }} /></div>
              </div>
            ))}
          </Panel>
        </div>
        {!!data?.suspectKeys.length && (
          <Panel className="flex flex-col gap-3 p-6">
            <strong className="text-[15px]">Keys to double-check</strong>
            {data.suspectKeys.map((k) => (
              <Link key={k.id} href={`/admin/bank/question?id=${k.id}`} className="text-sm text-ink2 hover:text-ink">
                <strong className="font-mono text-xs">{k.session ?? ""}{k.number ? ` Q${k.number}` : ""}</strong> · {k.top_pct}% pick {LETTERS[k.top]} over the key&apos;s {LETTERS[k.key]} → check it
              </Link>
            ))}
          </Panel>
        )}
      </main>
    </>
  );
}
