"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Header, Panel, inputCls, useMyCourses } from "@/components/admin/kit";
import { Banner } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Preview = { rows: number; mapping: { column: string; field: string | null }[]; ready: number; errors: { row: number; message: string }[] };

const FIELD_NAMES: Record<string, string> = { question: "Question text", opt_a: "Option A", opt_b: "Option B", opt_c: "Option C", opt_d: "Option D", opt_e: "Option E", answer: "Correct option", topic: "Topic", explanation: "Explanation" };

export default function ImportPage() {
  return (
    <Suspense>
      <Import />
    </Suspense>
  );
}

/** F19: columns matched automatically; bad rows listed by number before anything is imported. */
function Import() {
  const router = useRouter();
  const { data: mine } = useMyCourses();
  const [courseId, setCourseId] = useState(useSearchParams().get("course") ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(commit: boolean) {
    if (!file || !courseId) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("courseId", courseId);
    fd.append("commit", String(commit));
    try {
      const r = await api<Preview & { imported?: number }>("/admin/questions/import", { method: "POST", body: fd });
      if (commit) router.push(`/admin/bank?course=${courseId}`);
      else setPreview(r);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header eyebrow={`Question bank / Import${file ? ` · ${file.name}${preview ? ` · ${preview.rows} rows` : ""}` : ""}`} title={preview ? "Check your columns" : "Import questions from CSV"}>
        <ButtonLink href="/admin/bank" kind="outline" size="md">Cancel</ButtonLink>
        {preview && <Button size="md" disabled={!preview.ready} loading={busy} onClick={() => send(true)}>Import {preview.ready} to review</Button>}
      </Header>
      {err && <div className="mx-5 mt-6 sm:mx-8 lg:mx-12"><Banner tone="bad" icon="alert">{err}</Banner></div>}
      {!preview ? (
        <main className="max-w-[640px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          <Panel className="flex flex-col gap-6 p-7">
            <span className="text-sm leading-relaxed text-ink2">For questions that are already typed up. Use a header row; columns like <code className="font-mono text-xs">question, a, b, c, d, answer, topic, explanation</code> are matched automatically.</span>
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={inputCls} aria-label="Course">
              <option value="">Choose a course</option>
              {mine?.courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
            </select>
            <input type="file" accept=".csv,text/csv" className="max-w-full" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button disabled={!file || !courseId} loading={busy} onClick={() => send(false)} icon="search">Check the file</Button>
          </Panel>
        </main>
      ) : (
        <main className="grid gap-8 lg:grid-cols-[1fr_1.2fr] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          <Panel className="self-start overflow-hidden">
            <div className="grid grid-cols-[1fr_24px_1fr] gap-4 border-b border-line px-4 py-4 font-mono text-[11px] tracking-wider text-ink3"><span>YOUR COLUMN</span><span /><span>INTELQA FIELD</span></div>
            {preview.mapping.map((m) => (
              <div key={m.column} className="grid grid-cols-[1fr_24px_1fr] items-center gap-4 border-b border-line2 px-4 py-2.5 text-[13.5px] last:border-0">
                <span className="font-mono text-[12.5px] break-all">{m.column}</span>
                <Icon name="arrowR" size={16} color="var(--ink3)" />
                <span className={`rounded-lg border-[1.5px] px-2.5 py-1.5 ${m.field ? "border-line" : "border-flag text-flag-text"}`}>{m.field ? FIELD_NAMES[m.field] : "Ignored"}</span>
              </div>
            ))}
          </Panel>
          <div className="flex flex-col gap-5">
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-0.5 rounded-2xl bg-ok-tint p-6 text-ok-text"><strong className="font-display text-3xl">{preview.ready}</strong><span className="text-[13px]">rows ready</span></div>
              <div className="flex flex-1 flex-col gap-0.5 rounded-2xl bg-bad-tint p-6 text-bad-text"><strong className="font-display text-3xl">{preview.errors.length}</strong><span className="text-[13px]">rows will be skipped</span></div>
            </div>
            {preview.errors.length > 0 && (
              <Panel className="overflow-hidden">
                <div className="border-b border-line px-4 py-4 text-sm font-semibold">Problems</div>
                {preview.errors.slice(0, 50).map((e) => (
                  <div key={e.row} className="flex gap-3 border-b border-line2 px-4 py-2.5 text-[13.5px] last:border-0">
                    <span className="w-16 flex-none font-mono font-bold text-bad-text">Row {e.row}</span>
                    <span className="flex-1 text-ink2">{e.message}</span>
                  </div>
                ))}
              </Panel>
            )}
            <span className="text-[13px] leading-relaxed text-ink3">Imported questions arrive as drafts. They need an answer key and an explanation, then approval, before students see them.</span>
          </div>
        </main>
      )}
    </>
  );
}
