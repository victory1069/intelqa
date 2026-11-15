"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Gate } from "@/components/gate";
import { Field, Header, Panel, ago, inputCls } from "@/components/admin/kit";
import { Dialog, fmtClock, Avatar } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Held = { id: string; student: { id: string; name: string | null; joined: string }; courseCode: string; mode: string; score: number; maxScore: number; timeTakenSec: number; flagReason: string | null; submittedAt: string; secondsPerQuestion: number[]; paperAverageSpq: number | null; history: { total: number; fast: number } };
type Name = { id: string; current: string | null; requested: string; at: string | null };

export default function ModerationPage() {
  return (
    <Gate need="super">
      <Moderation />
    </Gate>
  );
}

/** G04 / G05 / G06 */
function Moderation() {
  const [tab, setTab] = useState<"sessions" | "names" | "hidden">("sessions");
  const sessions = useApi<{ sessions: Held[] }>("/admin/moderation/sessions");
  const names = useApi<{ names: Name[] }>("/admin/moderation/names");
  const hidden = useApi<{ students: { id: string; name: string | null; suspended: boolean }[] }>("/admin/moderation/hidden");
  const [sel, setSel] = useState<string | null>(null);
  const [ban, setBan] = useState<{ id: string; name: string } | null>(null);
  const list = sessions.data?.sessions ?? [];
  const h = list.find((x) => x.id === sel) ?? list[0];

  async function resolve(id: string, action: "allow" | "keep_off" | "hide_student") {
    await api(`/admin/moderation/sessions/${id}`, { method: "POST", body: { action } });
    setSel(null);
    sessions.reload();
    hidden.reload();
  }

  return (
    <div className="flex flex-col lg:h-dvh">
      <Header title="Moderation">
        <div className="no-scrollbar flex max-w-full overflow-x-auto rounded-[10px] bg-raised p-[3px]" role="tablist">
          {([["sessions", `Held sessions ${list.length}`], ["names", `Names ${names.data?.names.length ?? 0}`], ["hidden", `Hidden students ${hidden.data?.students.length ?? 0}`]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-none rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap ${tab === k ? "bg-surface font-semibold shadow-card" : "text-ink2"}`}>{l}</button>
          ))}
        </div>
      </Header>

      {tab === "sessions" && (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_1.15fr]">
          <div className="flex max-h-[40vh] flex-col gap-3 overflow-y-auto border-b border-line p-6 lg:max-h-none lg:border-r lg:border-b-0">
            {list.map((x) => (
              <button key={x.id} onClick={() => setSel(x.id)} className={`flex flex-col gap-1.5 rounded-[14px] bg-surface px-5 py-4 text-left ${x.id === h?.id ? "border-2 border-accent" : "border border-line"}`}>
                <div className="flex justify-between"><strong className="text-sm">{x.student.name}</strong><span className="text-xs text-ink3">{ago(x.submittedAt)}</span></div>
                <span className="text-[13px] text-ink2">{x.courseCode} · {x.mode}</span>
                <div className="flex gap-1.5">
                  <span className="rounded-md bg-bad-tint px-1.5 py-0.5 font-mono text-[11px] font-bold text-bad-text">{(x.timeTakenSec / Math.max(1, x.secondsPerQuestion.length)).toFixed(1)} s/Q</span>
                  <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink2">{Math.round((x.score / x.maxScore) * 100)}% correct</span>
                </div>
              </button>
            ))}
            {!list.length && <span className="p-6 text-sm text-ink2">No sessions waiting. Very fast, very accurate runs land here before they reach a board.</span>}
          </div>
          {h && (
            <div className="flex flex-col gap-6 overflow-y-auto px-4 py-[22px] lg:px-6">
              <div className="flex items-center gap-3">
                <Avatar name={h.student.name ?? "?"} size={44} />
                <div className="flex min-w-0 flex-1 flex-col"><strong className="text-[17px]">{h.student.name}</strong><span className="text-[13px] text-ink2">Joined {new Date(h.student.joined).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Panel className="flex flex-col gap-0.5 p-4"><span className="text-xs text-ink2">Score</span><strong className="font-display text-2xl">{h.score}/{h.maxScore}</strong></Panel>
                <Panel className="flex flex-col gap-0.5 p-4"><span className="text-xs text-ink2">Time</span><strong className="font-display text-2xl">{fmtClock(h.timeTakenSec)}</strong></Panel>
                <div className="flex flex-col gap-0.5 rounded-[14px] bg-bad-tint p-4 text-bad-text"><span className="text-xs">Per question</span><strong className="font-display text-2xl">{(h.timeTakenSec / Math.max(1, h.secondsPerQuestion.length)).toFixed(1)}s</strong></div>
              </div>
              <Panel className="flex flex-col gap-4 p-6">
                <strong className="text-sm">Seconds on each question</strong>
                <div className="flex h-20 items-end gap-[3px] border-b border-line" role="img" aria-label="Seconds spent on each question">
                  {h.secondsPerQuestion.map((s, i) => {
                    const max = Math.max(10, ...h.secondsPerQuestion);
                    return <div key={i} title={`Q${i + 1}: ${s}s`} className="flex-1 rounded-t-sm" style={{ height: `${Math.max(3, (s / max) * 100)}%`, background: s < 3 ? "var(--bad)" : "var(--ink3)" }} />;
                  })}
                </div>
                <span className="text-[12.5px] text-ink3">Red bars are under 3 seconds.{h.paperAverageSpq ? ` The paper average is ${h.paperAverageSpq} seconds per question.` : ""}</span>
              </Panel>
              <div className="rounded-xl bg-flag-tint px-5 py-4 text-[13px] leading-snug text-flag-text">
                <strong>Pattern:</strong> {h.history.fast} of this account&apos;s {h.history.total} ranked sessions were under 3 seconds a question.
              </div>
              <div className="mt-auto flex flex-wrap gap-2.5">
                <Button kind="outline" size="md" onClick={() => resolve(h.id, "allow")}>Allow on board</Button>
                <Button kind="outline" size="md" onClick={() => resolve(h.id, "keep_off")}>Keep this one off</Button>
                <Button kind="danger" size="md" onClick={() => resolve(h.id, "hide_student")}>Hide student from boards</Button>
                <Button kind="dangerGhost" size="md" icon="ban" onClick={() => setBan({ id: h.student.id, name: h.student.name ?? "" })}>Suspend…</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "names" && (
        <main className="flex flex-col gap-4 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          {names.data?.names.map((n) => (
            <div key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface px-4 py-4 md:flex-nowrap md:px-7">
              <div className="flex min-w-0 flex-1 basis-full flex-col gap-1 md:basis-auto">
                <div className="flex flex-wrap items-center gap-2.5"><span className="text-sm text-ink3 line-through">{n.current}</span><Icon name="arrowR" size={14} color="var(--ink3)" /><strong className="text-base">{n.requested}</strong></div>
                {n.at && <span className="text-xs text-ink3">Requested {ago(n.at)}</span>}
              </div>
              <Button kind="dangerGhost" size="sm" onClick={async () => { await api(`/admin/moderation/names/${n.id}`, { method: "POST", body: { action: "reject" } }); names.reload(); }}>Reject</Button>
              <Button size="sm" icon="check" onClick={async () => { await api(`/admin/moderation/names/${n.id}`, { method: "POST", body: { action: "approve" } }); names.reload(); }}>Approve</Button>
            </div>
          ))}
          {!names.data?.names.length && <span className="text-sm text-ink2">No name changes waiting. New sign-ups whose names pass the word filter are approved automatically.</span>}
        </main>
      )}

      {tab === "hidden" && (
        <main className="flex flex-col gap-3 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          {hidden.data?.students.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-4 md:px-7">
              <strong className="flex-1 text-sm">{s.name}{s.suspended ? " · suspended" : ""}</strong>
              {s.suspended ? (
                <Button kind="ghost" size="sm" onClick={async () => { await api(`/admin/students/${s.id}/unsuspend`, { method: "POST" }); hidden.reload(); }}>Lift suspension</Button>
              ) : (
                <Button kind="ghost" size="sm" onClick={async () => { await api(`/admin/students/${s.id}/visibility`, { method: "POST", body: { hidden: false } }); hidden.reload(); }}>Show on boards again</Button>
              )}
            </div>
          ))}
          {!hidden.data?.students.length && <span className="text-sm text-ink2">Nobody is hidden.</span>}
        </main>
      )}

      {ban && <BanDialog student={ban} onClose={() => setBan(null)} onDone={() => { setBan(null); sessions.reload(); hidden.reload(); }} />}
    </div>
  );
}

/** G06: the strongest action, so it has the most friction. Typing the name confirms it. */
function BanDialog({ student, onClose, onDone }: { student: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("Sharing answer keys during live exams");
  const [confirmName, setConfirmName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} label="Suspend account">
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-bad-tint"><Icon name="ban" size={26} color="var(--bad-text)" /></span>
      <strong className="font-display text-2xl">Suspend {student.name}?</strong>
      <span className="text-sm leading-relaxed text-ink2">They&apos;ll be signed out and removed from all boards. Their attempts stay in the data for question stats.</span>
      <Field label="Reason shown to the student">
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
          <option>Sharing answer keys during live exams</option>
          <option>Using several accounts</option>
          <option>Abusive or impersonating name</option>
        </select>
      </Field>
      <Field label={`Type ${student.name} to confirm`}>
        <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} className={`${inputCls} border-bad`} />
      </Field>
      {err && <span className="text-sm text-bad-text">{err}</span>}
      <div className="flex justify-end gap-2.5 pt-1">
        <Button kind="outline" size="md" onClick={onClose}>Cancel</Button>
        <Button kind="danger" size="md" loading={busy} disabled={confirmName.trim() !== student.name.trim()} onClick={async () => { setBusy(true); setErr(null); try { await api(`/admin/students/${student.id}/suspend`, { method: "POST", body: { reason, confirmName } }); onDone(); } catch (e) { setErr((e as ApiError).message); setBusy(false); } }}>Suspend account</Button>
      </div>
    </Dialog>
  );
}
