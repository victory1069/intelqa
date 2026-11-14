"use client";
import Link from "next/link";
import { usePendingSync } from "@/lib/use-downloads";
import { AppBar } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";

/** E06: results finished offline, with provisional scores. They sync on their own. */
export default function SyncQueue() {
  const rows = usePendingSync();
  return (
    <>
      <AppBar title="Waiting to sync" sub={`${rows.length} result${rows.length === 1 ? "" : "s"} · offline`} />
      <main className="flex flex-col gap-4 px-5 pb-5">
        <div className="flex gap-2.5 rounded-2xl bg-raised px-5 py-4 text-[13px] leading-relaxed text-ink2">
          <Icon name="cloud" size={20} />
          <span>These scores come from your downloaded answer key. XP is added once they&apos;ve been checked online. Offline sessions don&apos;t change your course rank.</span>
        </div>
        {rows.map((r) => (
          <Link key={r.clientId} href={`/result?c=${r.clientId}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-4">
            <div className="flex flex-1 flex-col gap-0.5">
              <strong className="text-[15px]">{r.title}</strong>
              <span className="text-xs text-ink2">{r.submittedAt ? new Date(r.submittedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}</span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <strong className="font-mono text-[15px]">{r.provisional ? `${r.provisional.score}/${r.provisional.maxScore}` : "—"}</strong>
              <span className="font-mono text-[10px] text-ink3">PROVISIONAL</span>
            </div>
          </Link>
        ))}
        {!rows.length && <span className="p-6 text-center text-sm text-ink2">Everything is synced.</span>}
      </main>
    </>
  );
}
