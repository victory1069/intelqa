"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MathText } from "@/components/ui/math-text";
import { LETTERS } from "@/shared/game";
import { Field, areaCls, inputCls } from "./kit";

export type AdminQuestion = {
  id: string;
  text: string;
  options: string[];
  correctOption: number | null;
  answerVerified: boolean;
  explanation: string | null;
  trap: string | null;
  workedSteps: string[] | null;
  topicId: string | null;
  difficulty: "easy" | "medium" | "hard";
  status: "draft" | "approved" | "hidden";
  flags: string[];
  confidence: number | null;
  imageUrl: string | null;
  imageAlt: string | null;
  hasDiagram: boolean;
  repeatOfId: string | null;
  sourcePage: number | null;
  sourceNumber: number | null;
  sourceBox?: { x: number; y: number; w: number; h: number } | null;
};

type Patch = Partial<Pick<AdminQuestion, "text" | "options" | "correctOption" | "explanation" | "trap" | "workedSteps" | "topicId" | "difficulty" | "repeatOfId">> & { approve?: boolean };

/** F10: edit, verify and approve one question. Render with key={q.id} so switching questions resets it. */
export function QuestionEditor({
  q,
  topics,
  onSaved,
  onCrop,
  approveLabel = "Verify & approve",
}: {
  q: AdminQuestion;
  topics: { id: string; name: string }[];
  onSaved: (q: AdminQuestion, approved: boolean) => void;
  onCrop?: () => void;
  approveLabel?: string;
}) {
  const [text, setText] = useState(q.text);
  const [options, setOptions] = useState(q.options);
  const [key, setKey] = useState<number | null>(q.correctOption);
  const [explanation, setExplanation] = useState(q.explanation ?? "");
  const [trap, setTrap] = useState(q.trap ?? "");
  const [steps, setSteps] = useState((q.workedSteps ?? []).join("\n"));
  const [topicId, setTopicId] = useState(q.topicId ?? "");
  const [difficulty, setDifficulty] = useState(q.difficulty);
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [err, setErr] = useState<string | null>(null);


  const aiKey = !q.answerVerified && q.flags.some((f) => /AI suggested|No key/i.test(f));

  async function save(approve: boolean) {
    setBusy(approve ? "approve" : "save");
    setErr(null);
    const patch: Patch = {
      text: text.trim(),
      options: options.map((o) => o.trim()).filter(Boolean),
      correctOption: key,
      explanation: explanation.trim() || null,
      trap: trap.trim() || null,
      workedSteps: steps.trim() ? steps.split("\n").map((s) => s.trim()).filter(Boolean) : null,
      topicId: topicId || null,
      difficulty,
      ...(approve ? { approve: true } : {}),
    };
    try {
      const r = await api<{ question: AdminQuestion; regrade: { attempts: number; students: number } | null }>(`/admin/questions/${q.id}`, { method: "PATCH", body: patch });
      onSaved(r.question, approve);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {q.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {q.flags.map((f) => <span key={f} className="rounded-md bg-flag-tint px-2 py-1 text-xs text-flag-text">{f}</span>)}
          {q.confidence != null && q.confidence < 0.85 && <span className="rounded-md bg-bad-tint px-2 py-1 font-mono text-[11px] font-bold text-bad-text">CONF {q.confidence.toFixed(2)}</span>}
        </div>
      )}
      <Field label="Question" hint={text.includes("$") ? <span>Preview: <MathText text={text} /></span> : "Use $...$ for maths"}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={areaCls} />
      </Field>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Options and correct answer">
        <div className="flex justify-between gap-3"><span className="text-[13px] font-semibold">Options · pick the correct answer</span><span className="text-xs text-ink3">{options.filter((o) => o.trim()).length} present</span></div>
        {options.map((o, i) => {
          const on = key === i;
          return (
            <div key={i} className={`flex items-center gap-2.5 rounded-xl px-3 ${on ? "border-2 border-accent bg-accent-tint" : "border-[1.5px] border-line bg-surface"}`}>
              <button type="button" role="radio" aria-checked={on} aria-label={`Mark ${LETTERS[i]} correct`} onClick={() => setKey(i)} className={`h-5 w-5 flex-none rounded-full ${on ? "border-[6px] border-accent" : "border-2 border-line"}`} />
              <span className="w-4 font-mono text-[13px] font-bold">{LETTERS[i]}</span>
              <input value={o} onChange={(e) => setOptions(options.map((x, n) => (n === i ? e.target.value : x)))} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
              {on && aiKey && <span className="font-mono text-[10.5px] font-bold text-flag-text">AI · UNVERIFIED</span>}
              {options.length > 2 && <button type="button" aria-label={`Remove option ${LETTERS[i]}`} onClick={() => { setOptions(options.filter((_, n) => n !== i)); if (key === i) setKey(null); else if (key != null && key > i) setKey(key - 1); }}><Icon name="close" size={14} color="var(--ink3)" /></button>}
            </div>
          );
        })}
        {options.length < 5 && <button type="button" onClick={() => setOptions([...options, ""])} className="self-start text-[13px] font-semibold text-accent-text">+ Add option {LETTERS[options.length]}</button>}
      </div>
      {aiKey && (
        <div className="flex items-start gap-2.5 rounded-xl bg-flag-tint px-5 py-4 text-[13px] leading-snug text-flag-text">
          <Icon name="sparkle" size={18} />
          <span><strong>Unverified.</strong> The source had no answer key, so the AI picked one. Until you verify it, this question is kept out of exam simulation.</span>
        </div>
      )}
      <Field label="Explanation · 3 to 6 sentences">
        <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={4} className={areaCls} />
      </Field>
      <Field label="Why the common wrong answer is wrong · optional">
        <textarea value={trap} onChange={(e) => setTrap(e.target.value)} rows={2} className={areaCls} />
      </Field>
      <Field label="Worked steps · one per line, for calculations">
        <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={3} className={`${areaCls} font-mono text-[13px]`} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Topic">
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)} className={inputCls}>
            <option value="">No topic</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Difficulty">
          <div className="flex rounded-[10px] bg-raised p-[3px]">
            {(["easy", "medium", "hard"] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDifficulty(d)} className={`h-9 flex-1 rounded-lg text-[13px] capitalize ${difficulty === d ? "bg-surface font-semibold shadow-card" : "text-ink2"}`}>{d}</button>
            ))}
          </div>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {q.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.imageUrl} alt={q.imageAlt ?? ""} className="h-16 rounded-lg border border-line bg-white p-1" />
        ) : null}
        {onCrop && <Button kind="outline" size="sm" icon="crop" onClick={onCrop}>{q.imageUrl ? "Replace figure" : "Attach a figure"}</Button>}
      </div>
      {err && <span className="text-sm text-bad-text" role="alert">{err}</span>}
      <div className="flex flex-wrap gap-2.5">
        <Button kind="outline" size="md" loading={busy === "save"} onClick={() => save(false)}>Save draft</Button>
        <Button size="md" icon="check" loading={busy === "approve"} disabled={key == null || !explanation.trim()} onClick={() => save(true)}>{approveLabel}</Button>
      </div>
    </div>
  );
}
