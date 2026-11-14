"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Field, Header, Panel, Status, ago, areaCls } from "@/components/admin/kit";
import { QuestionEditor, type AdminQuestion } from "@/components/admin/question-editor";
import { CropModal } from "@/components/admin/crop";
import { Banner } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MathText } from "@/components/ui/math-text";
import { LETTERS } from "@/shared/game";

type Stats = {
  question: AdminQuestion & { courseId: string; autoHidden: boolean };
  attempts: number;
  correctPct: number | null;
  optionStats: { letter: string; text: string; picks: number; pct: number; isKey: boolean }[];
  keyWarning: boolean;
  reports: { id: string; reason: string; note: string | null; status: string; createdAt: string; name: string }[];
  papers: { id: string; session: string; examType: string; position: number }[];
};

export default function QuestionPage() {
  return (
    <Suspense>
      <Question />
    </Suspense>
  );
}

/** F16: per-question stats, reports, edit and key change. */
function Question() {
  const sp = useSearchParams();
  const id = sp.get("id");
  if (sp.get("new")) return <NewQuestion courseId={sp.get("course") ?? ""} />;
  return <Existing id={id ?? ""} />;
}

function Existing({ id }: { id: string }) {
  const { data, reload } = useApi<Stats>(id ? `/admin/questions/${id}` : null);
  const { data: topics } = useApi<{ topics: { id: string; name: string }[] }>(data ? `/catalog/courses/${data.question.courseId}/topics` : null);
  const [msg, setMsg] = useState<string | null>(null);
  const [crop, setCrop] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data) return <Header title="Question" />;
  const q = data.question;
  const top = [...data.optionStats].sort((a, b) => b.picks - a.picks)[0];
  const open = data.reports.filter((r) => r.status === "open");
  const hidden = q.autoHidden || q.status === "hidden";

  return (
    <>
      <Header eyebrow={data.papers.map((p) => `${p.session} · Q${p.position + 1}`).join(" · ") || "Not in a published paper"} title={<MathText text={q.text} />}>
        <Status s={hidden ? "hidden" : !q.answerVerified ? "unverified" : q.status === "approved" ? "live" : "draft"} />
        {hidden ? (
          <Button size="md" kind="outline" loading={busy} onClick={async () => { setBusy(true); await api(`/admin/questions/${id}`, { method: "PATCH", body: { hide: false, resolveReports: true } }); await reload(); setBusy(false); }}>Unhide</Button>
        ) : (
          <Button size="md" kind="dangerGhost" loading={busy} onClick={async () => { setBusy(true); await api(`/admin/questions/${id}`, { method: "PATCH", body: { hide: true } }); await reload(); setBusy(false); }}>Hide</Button>
        )}
      </Header>
      {msg && <div className="mx-5 mt-6 sm:mx-8 lg:mx-12"><Banner tone="ok" icon="check">{msg}</Banner></div>}
      <main className="grid gap-8 lg:grid-cols-[1.3fr_1fr] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid grid-cols-3 gap-3 sm:gap-5">
            <Panel className="flex min-w-0 flex-col gap-1 p-4 sm:p-4"><span className="text-xs text-ink2">Attempts</span><strong className="font-display text-3xl">{data.attempts.toLocaleString()}</strong></Panel>
            <Panel className="flex min-w-0 flex-col gap-1 p-4 sm:p-4"><span className="text-xs text-ink2">Correct</span><strong className="font-display text-3xl" style={{ color: data.correctPct != null && data.correctPct < 30 ? "var(--bad-text)" : undefined }}>{data.correctPct == null ? "—" : `${data.correctPct}%`}</strong></Panel>
            <Panel className="flex min-w-0 flex-col gap-1 p-4 sm:p-4"><span className="text-xs text-ink2">Open reports</span><strong className="font-display text-3xl">{open.length}</strong></Panel>
          </div>
          <Panel className="flex flex-col gap-5 p-6">
            <strong className="text-[15px]">Answers picked</strong>
            {data.optionStats.map((o) => {
              const mostWrong = o === top && !o.isKey && o.picks > 0;
              return (
                <div key={o.letter} className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-3 text-sm">
                    <span><strong className="font-mono">{o.letter}</strong> · <MathText text={o.text} /> {o.isKey && <span className="font-mono text-[11px] font-bold text-ok-text">KEY</span>}{mostWrong && <span className="font-mono text-[11px] font-bold text-bad-text"> MOST PICKED</span>}</span>
                    <strong className="font-mono">{o.pct}%</strong>
                  </div>
                  <div className="h-3 overflow-hidden rounded-md bg-raised"><div className="h-full rounded-md" style={{ width: `${o.pct}%`, background: o.isKey ? "var(--ok)" : mostWrong ? "var(--bad)" : "var(--ink3)" }} /></div>
                </div>
              );
            })}
          </Panel>
          <Panel className="p-6 lg:p-[18px]">
            <QuestionEditor
              key={q.id}
              q={q}
              topics={topics?.topics ?? []}
              approveLabel={q.status === "approved" ? "Save & keep live" : "Verify & approve"}
              onCrop={() => setCrop(true)}
              onSaved={async () => {
                setMsg("Saved. If you changed the key, every past attempt has been re-marked and course scores updated.");
                await reload();
              }}
            />
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {data.keyWarning && top && (
            <div className="flex flex-col gap-3 rounded-[18px] bg-bad-tint p-6 text-bad-text">
              <div className="flex items-center gap-2"><Icon name="alert" size={20} /><strong className="text-[15px]">The key may be wrong</strong></div>
              <span className="text-sm leading-relaxed">
                {top.pct}% pick {top.letter} over the key&apos;s {q.correctOption != null ? LETTERS[q.correctOption] : "?"}. Check it against a reliable source. Changing the key re-marks all {data.attempts.toLocaleString()} attempts.
              </span>
            </div>
          )}
          <Panel className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <strong className="text-[15px]">Reports</strong>
              {open.length > 0 && (
                <Button kind="ghost" size="sm" onClick={async () => { await api(`/admin/questions/${id}/reports/dismiss`, { method: "POST" }); await reload(); setMsg("Reports dismissed and the question is visible again."); }}>Dismiss all</Button>
              )}
            </div>
            {data.reports.map((r) => (
              <span key={r.id} className={`text-[13.5px] leading-snug ${r.status === "open" ? "text-ink2" : "text-ink3 line-through"}`}>
                <strong className="font-mono text-[11px]">{r.reason.replace("_", " ").toUpperCase()}</strong>{r.note ? ` · “${r.note}”` : ""} · {r.name} · {ago(r.createdAt)}
              </span>
            ))}
            {!data.reports.length && <span className="text-sm text-ink3">No reports.</span>}
            {q.autoHidden && <Banner tone="bad" icon="eyeOff">Auto-hidden after 3 reports. Fix it and approve, or dismiss the reports.</Banner>}
          </Panel>
        </div>
      </main>
      {crop && (
        <CropModal
          src={null}
          onClose={() => setCrop(false)}
          onSave={async (blob, alt) => {
            const fd = new FormData();
            fd.append("file", blob, "figure.png");
            fd.append("alt", alt);
            await api(`/admin/questions/${id}/image`, { method: "POST", body: fd });
            await reload();
          }}
        />
      )}
    </>
  );
}

/** Manual add: lands as a draft to review like any other. */
function NewQuestion({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Header eyebrow="Question bank" title="Add a question" />
      <main className="max-w-[720px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <Panel className="flex flex-col gap-5 p-7">
          <Field label="Question"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={areaCls} /></Field>
          {options.map((o, i) => (
            <Field key={i} label={`Option ${LETTERS[i]}`}><input value={o} onChange={(e) => setOptions(options.map((x, n) => (n === i ? e.target.value : x)))} className={areaCls} /></Field>
          ))}
          {options.length < 5 && <button className="self-start text-[13px] font-semibold text-accent-text" onClick={() => setOptions([...options, ""])}>+ Add option E</button>}
          {err && <span className="text-sm text-bad-text">{err}</span>}
          <Button
            loading={busy}
            disabled={!courseId || !text.trim() || options.filter((o) => o.trim()).length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ question: { id: string } }>("/admin/questions", { method: "POST", body: { courseId, text: text.trim(), options: options.map((o) => o.trim()).filter(Boolean) } });
                router.replace(`/admin/bank/question?id=${r.question.id}`);
              } catch (e) {
                setErr((e as ApiError).message);
                setBusy(false);
              }
            }}
          >
            Create draft, then set the key
          </Button>
        </Panel>
      </main>
    </>
  );
}
