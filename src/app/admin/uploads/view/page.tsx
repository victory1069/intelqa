"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Header, Panel, Status } from "@/components/admin/kit";
import { Banner, Bar } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icon";

type View = {
  upload: { id: string; status: string; session: string; examType: string; progress: { step: number; total: number; label: string } | null; log: string[]; error: string | null; createdAt: string; updatedAt: string };
  pages: { name: string; mime: string; url: string | null }[];
  paper: { id: string; status: string } | null;
};

const STEPS = ["Upload stored", "Preparing pages", "Reading questions and options", "Reading the answer key", "Drafting explanations and topic tags", "Checking options, numbering and repeats", "Saving drafts for review"];

export default function UploadViewPage() {
  return (
    <Suspense>
      <UploadView />
    </Suspense>
  );
}

function UploadView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { data, reload } = useApi<View>(id ? `/admin/uploads/${id}` : null);
  const { data: config } = useApi<{ extractor: "claude" | "local" }>("/admin/uploads/config");
  const [replace, setReplace] = useState<string | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const status = data?.upload.status;
  useEffect(() => {
    if (status !== "processing") return;
    const t = setInterval(() => {
      setNow(Date.now());
      reload();
    }, 3000);
    return () => clearInterval(t);
  }, [status, reload]);

  if (!data) return <Header title="Upload" />;
  const u = data.upload;
  const title = `${u.session} · ${u.examType.replace("_", "-")}`;
  const failedLines = u.log.filter((l) => l.startsWith("✕"));
  // What the log says was read, for the summaries (F08 and the ready state).
  const readCount = u.log.reduce((n, l) => n + Number(l.match(/^✓ .*?· (\d+) questions/)?.[1] ?? 0), 0);
  const failedPages = [...new Set(failedLines.map((l) => Number(l.match(/^✕ p(\d+)/)?.[1])).filter((n) => n > 0))].sort((a, b) => a - b);
  const okPages = [...new Set(u.log.map((l) => Number(l.match(/^✓ p(\d+) ·/)?.[1])).filter((n) => n > 0))].sort((a, b) => a - b);
  const replaceValue = replace ?? failedPages.join(",");
  const list = (ns: number[]) => (ns.length <= 1 ? ns.join("") : `${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}`);

  if (u.status === "processing") {
    const step = u.progress?.step ?? 0;
    // Rough estimate: Claude takes ~25 s a page plus explanations; the built-in parser is near instant.
    const pages = data.pages.length;
    const estimateSec = config?.extractor === "local" ? 10 : 30 + pages * 25 + pages * 12;
    const elapsed = Math.max(0, (now - Date.parse(u.createdAt)) / 1000);
    const leftMin = Math.max(1, Math.ceil((estimateSec - elapsed) / 60));
    return (
      <>
        <Header eyebrow={`Uploads / ${title}`} title="Processing" />
        <main className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          <Panel className="flex w-full max-w-[620px] flex-col gap-8 p-7 lg:p-10">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <strong className="font-display text-[22px]">{u.progress?.label ?? "Starting"}</strong>
              <span className="font-mono text-[13px] text-ink2">{elapsed > estimateSec ? "taking longer than usual" : `about ${leftMin} min left`}</span>
            </div>
            <Bar pct={((step + 0.5) / (u.progress?.total ?? 6)) * 100} height={8} />
            <ol className="flex flex-col gap-5">
              {STEPS.slice(0, 7).map((s, i) => {
                const state = i < step ? "done" : i === step ? "now" : "pending";
                return (
                  <li key={s} className={`flex items-center gap-3 text-sm ${state === "pending" ? "text-ink3" : ""}`}>
                    <span className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full ${state === "done" ? "bg-ok" : state === "now" ? "bg-accent" : "bg-raised"}`}>
                      {state === "now" ? <Spinner size={14} color="#FFFFFF" /> : <Icon name={state === "done" ? "check" : "minus"} size={14} color={state === "pending" ? "var(--ink3)" : "#FFFFFF"} weight={2.8} />}
                    </span>
                    <span className={state === "now" ? "font-bold" : "font-medium"}>{s}</span>
                  </li>
                );
              })}
            </ol>
            <span className="text-[13px] text-ink3">You can leave this page. It goes into the review queue when it&apos;s ready, and the sidebar count updates.</span>
          </Panel>
        </main>
      </>
    );
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header eyebrow={`Uploads / ${title}`} title={u.status === "failed" ? "Couldn't finish this upload" : u.status === "published" ? "Published" : "Ready for review"}>
        <Status s={u.status} />
        {u.status !== "published" && (
          <Button kind="dangerGhost" size="md" onClick={() => act(async () => { await api(`/admin/uploads/${id}`, { method: "DELETE" }); router.push("/admin/uploads"); })}>Delete upload</Button>
        )}
        {data.paper && u.status !== "failed" && <ButtonLink href={`/admin/review?paper=${data.paper.id}`} size="md" iconRight="arrowR">Open review</ButtonLink>}
      </Header>
      {err && <div className="mx-5 mt-6 sm:mx-8 lg:mx-12"><Banner tone="bad" icon="alert">{err}</Banner></div>}
      <main className="grid gap-8 lg:grid-cols-2 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <Panel className="flex min-w-0 flex-col gap-6 p-6 lg:p-9">
          {u.status === "failed" || u.error ? (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-bad-tint"><Icon name="alert" size={28} color="var(--bad-text)" /></span>
              <strong className="font-display text-[22px]">{u.error ?? "Some pages couldn't be read"}</strong>
              <span className="text-[15px] leading-relaxed text-ink2">
                {readCount > 0 && okPages.length > 0 && `${readCount} questions came out cleanly from page${okPages.length === 1 ? "" : "s"} ${list(okPages)}. `}
                {failedPages.length > 0 && `Page${failedPages.length === 1 ? "" : "s"} ${list(failedPages)} couldn't be read. `}
                Retake unreadable pages flat, in daylight, with the whole page in view. Replace just those pages and the pipeline runs again.
                {data.paper ? " Or review the questions that did come out cleanly." : ""}
              </span>
              <div className="flex flex-col gap-4 rounded-xl border border-line p-4">
                <label className="flex flex-wrap items-center gap-2 text-sm">Replace page numbers
                  <input value={replaceValue} onChange={(e) => setReplace(e.target.value)} placeholder="3,4" className="h-9 w-24 rounded-lg border-[1.5px] border-line bg-surface px-2 font-mono text-sm" />
                </label>
                <input type="file" multiple accept={config?.extractor === "local" ? ".pdf,.docx,.txt" : "image/jpeg,image/png,image/webp,.pdf,.docx,.txt"} onChange={(e) => setFiles(e.target.files)} className="max-w-full text-sm" />
                <div className="flex flex-wrap gap-2.5">
                  <Button
                    icon="camera"
                    size="md"
                    disabled={!files?.length}
                    loading={busy}
                    onClick={() => act(async () => {
                      const fd = new FormData();
                      Array.from(files!).forEach((f) => fd.append("files", f));
                      fd.append("replace", replaceValue);
                      await api(`/admin/uploads/${id}/pages`, { method: "POST", body: fd });
                    })}
                  >
                    {replaceValue ? `Replace page${replaceValue.includes(",") ? "s" : ""} ${replaceValue.replace(/,\s*/g, ", ")}` : "Add pages"}
                  </Button>
                  <Button kind="outline" size="md" icon="refresh" loading={busy} onClick={() => act(() => api(`/admin/uploads/${id}/retry`, { method: "POST" }))}>Run again</Button>
                </div>
              </div>
              {data.paper && <ButtonLink href={`/admin/review?paper=${data.paper.id}`} kind="outline" size="md">Review what was read</ButtonLink>}
            </>
          ) : (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-ok-tint"><Icon name="check" size={28} color="var(--ok-text)" weight={2.6} /></span>
              <strong className="font-display text-[22px]">{u.status === "published" ? "This paper is live" : "Drafts are ready to check"}</strong>
              <span className="text-[15px] leading-relaxed text-ink2">
                {readCount > 0 && u.status !== "published" && `${readCount} question${readCount === 1 ? "" : "s"} read. `}
                Nothing goes live until a person has checked every question and its answer key.
              </span>
            </>
          )}
          {data.pages.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {data.pages.map((p, i) => (
                <a key={i} href={p.url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 font-mono text-xs">
                  <Icon name={p.mime.startsWith("image/") ? "image" : "file"} size={14} />p{i + 1}
                </a>
              ))}
            </div>
          )}
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-5 p-6 lg:p-9">
          <span className="label">Pipeline log</span>
          <div className="rounded-xl bg-bg p-5 font-mono break-words text-xs leading-[1.9] text-ink2">
            {u.log.length ? u.log.map((l, i) => (
              <div key={i}><span style={{ color: l.startsWith("✓") ? "var(--ok-text)" : l.startsWith("✕") ? "var(--bad-text)" : "var(--flag-text)" }}>{l[0]}</span>{l.slice(1)}</div>
            )) : "No log yet."}
          </div>
          {failedLines.length > 0 && <span className="text-xs text-ink3">{failedLines.length} step{failedLines.length === 1 ? "" : "s"} failed.</span>}
        </Panel>
      </main>
    </>
  );
}
