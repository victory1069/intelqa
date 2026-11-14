"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Header, ago } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";

type Report = { questionId: string; n: number; reasons: string[]; notes: string[]; latest: string; text: string; autoHidden: boolean; courseCode: string };
const REASON: Record<string, string> = { wrong_key: "Wrong answer key", unclear_explanation: "Explanation unclear", typo: "Typo", other: "Something else" };

/** F17: grouped by question, most-reported first. */
export default function Reports() {
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed">("open");
  const { data, reload } = useApi<{ reports: Report[] }>(`/admin/questions/reports/queue?status=${status}`);
  return (
    <>
      <Header title="Reports">
        <div className="flex rounded-[10px] bg-raised p-[3px]" role="tablist">
          {(["open", "resolved", "dismissed"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={`rounded-lg px-3 py-1.5 text-[13px] capitalize ${status === s ? "bg-surface font-semibold shadow-card" : "text-ink2"}`}>{s}</button>
          ))}
        </div>
      </Header>
      <main className="flex flex-col gap-4 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
        {data?.reports.map((r) => {
          const heavy = r.n >= 3;
          return (
            <div key={r.questionId} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface px-4 py-5 md:flex-nowrap md:px-7">
              <span className={`flex h-[52px] w-[52px] flex-none flex-col items-center justify-center rounded-[14px] ${heavy ? "bg-bad text-white" : r.n === 2 ? "bg-flag-tint text-flag-text" : "bg-raised"}`}>
                <strong className="font-display text-xl leading-none">{r.n}</strong>
                <span className="font-mono text-[9.5px]">REPORT{r.n === 1 ? "" : "S"}</span>
              </span>
              <div className="flex min-w-0 flex-1 basis-[200px] flex-col gap-1 md:basis-auto">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-xs text-ink3">{r.courseCode}</span>
                  {r.autoHidden && <span className="rounded-md bg-bad-tint px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-bad-text">AUTO-HIDDEN</span>}
                  <span className="text-xs text-ink3">{r.reasons.map((x) => REASON[x] ?? x).join(" · ")} · {ago(r.latest)}</span>
                </div>
                <span className="truncate text-sm font-semibold"><MathText text={r.text} /></span>
                {r.notes[0] && <span className="truncate text-[13px] text-ink2">“{r.notes[0]}”{r.notes.length > 1 ? ` and ${r.notes.length - 1} more` : ""}</span>}
              </div>
              {status === "open" && <Button kind="ghost" size="sm" onClick={async () => { await api(`/admin/questions/${r.questionId}/reports/dismiss`, { method: "POST" }); reload(); }}>Dismiss</Button>}
              <Link href={`/admin/bank/question?id=${r.questionId}`} className="flex h-9 items-center rounded-[10px] border-[1.5px] border-line px-3 text-sm font-semibold">Open &amp; fix</Link>
            </div>
          );
        })}
        {data && !data.reports.length && <span className="p-6 text-sm text-ink2">No {status} reports.</span>}
      </main>
    </>
  );
}
