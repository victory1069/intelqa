"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Header, Status } from "@/components/admin/kit";
import { QuestionEditor, type AdminQuestion } from "@/components/admin/question-editor";
import { CropModal } from "@/components/admin/crop";
import { Banner, Dialog, Pill } from "@/components/ui/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MathText } from "@/components/ui/math-text";
import { LETTERS } from "@/shared/game";

type RQ = AdminQuestion & { position: number; topicName: string | null; state: "flagged" | "unreviewed" | "approved" };
type ReviewData = {
  paper: { id: string; courseId: string; session: string; examType: string; timeLimitMin: number; optionCount: number; negativeMark: number; status: string; uploadId: string | null };
  course: { id: string; code: string; title: string };
  upload: { id: string; status: string; error: string | null; createdAt: string } | null;
  counts: { total: number; flagged: number; unreviewed: number; approved: number; verified: number; repeats: number };
  topics: { id: string; name: string }[];
  questions: RQ[];
};
type Pages = { pages: { name: string; mime: string; url: string | null }[] };

export default function ReviewPage() {
  return (
    <Suspense>
      <Review />
    </Suspense>
  );
}

/**
 * Typed originals (DOCX/TXT) shown as text, with the selected question highlighted and
 * scrolled into view, so typed papers get the same side-by-side check as scans.
 */
function SourceText({ uploadId, index, url, find, number }: { uploadId: string; index: number; url: string; find: string | null; number: number | null }) {
  const { data, error } = useApi<{ text: string }>(`/admin/uploads/${uploadId}/text/${index}`);
  if (error) return <a href={url} className="text-sm text-accent-text underline" target="_blank" rel="noreferrer">Open the original document</a>;
  if (!data) return <span className="text-sm text-ink3">Loading the original…</span>;
  // Find the question by its first words; fall back to its number.
  const text = data.text;
  const probe = find?.replace(/\$[^$]*\$/g, "").trim().slice(0, 40) ?? "";
  let at = probe.length > 8 ? text.indexOf(probe) : -1;
  if (at < 0 && number != null) {
    const m = new RegExp(`(^|\\n)\\s*(?:Q(?:uestion)?\\s*\\.?\\s*)?${number}\\s*[.):\\-]`, "i").exec(text);
    if (m) at = m.index + m[1].length;
  }
  // Highlight up to the next blank line or the next question number.
  let end = at;
  if (at >= 0) {
    const rest = text.slice(at);
    const next = /\n\s*\n|\n\s*(?:Q(?:uestion)?\s*\.?\s*)?\d{1,3}\s*[.):-]\s/.exec(rest.slice(1));
    end = at + 1 + (next ? next.index : rest.length - 1);
  }
  return (
    <pre className="h-full w-full overflow-auto rounded bg-white p-7 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-[#2A2840] shadow-md">
      {at < 0 ? text : (
        <>
          {text.slice(0, at)}
          <mark ref={(el) => el?.scrollIntoView({ block: "center" })} className="rounded bg-highlighter/70 text-[#15132B]">{text.slice(at, end)}</mark>
          {text.slice(end)}
        </>
      )}
    </pre>
  );
}

/** F09 entry: everything waiting for review, oldest first. */
function Queue() {
  const { data } = useApi<{ uploads: { id: string; courseCode: string; session: string; semester: number; examType: string; status: string; error: string | null; pages: number; uploadedBy: string; createdAt: string; paperId: string | null }[] }>("/admin/uploads?status=in_review");
  const items = [...(data?.uploads ?? [])].reverse();
  return (
    <>
      <Header eyebrow="Review queue" title="Papers waiting for review" />
      <main className="flex flex-col gap-5 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        {!data ? (
          <span className="text-sm text-ink3">Loading…</span>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-5 rounded-[18px] border border-line bg-surface px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ok-tint"><Icon name="check" size={28} color="var(--ok-text)" /></span>
            <strong className="font-display text-xl">Nothing to review</strong>
            <span className="max-w-[420px] text-sm text-ink2">New uploads land here once their questions have been read. Upload a paper to get started.</span>
            <ButtonLink href="/admin/uploads/new" size="md">Upload a paper</ButtonLink>
          </div>
        ) : (
          items.map((u) => (
            <Link key={u.id} href={u.paperId ? `/admin/review?paper=${u.paperId}` : `/admin/uploads/view?id=${u.id}`} className="flex items-center gap-3 rounded-[16px] border border-line bg-surface px-4 py-4 hover:border-accent lg:gap-4 lg:px-5">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-accent-tint"><Icon name="file" size={22} color="var(--accent-text)" /></span>
              <div className="flex min-w-0 flex-1 flex-col">
                <strong className="text-[15px]">{u.courseCode} · {u.session} · {u.examType === "post_utme" ? "Post-UTME" : u.examType === "test" ? "Test" : "Exam"}</strong>
                <span className="text-[13px] text-ink2">Uploaded by {u.uploadedBy} · {new Date(u.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {u.pages} file{u.pages === 1 ? "" : "s"}</span>
                {u.error && <span className="text-[13px] text-flag-text">{u.error}</span>}
              </div>
              <Icon name="chevR" size={18} color="var(--ink3)" />
            </Link>
          ))
        )}
      </main>
    </>
  );
}

/** F09–F13 */
function Review() {
  const paperId = useSearchParams().get("paper") ?? "";
  if (!paperId) return <Queue />;
  return <PaperReview paperId={paperId} />;
}

function PaperReview({ paperId }: { paperId: string }) {
  const { data, reload, mutate } = useApi<ReviewData>(paperId ? `/admin/papers/${paperId}` : null);
  const { data: src } = useApi<Pages>(data?.paper.uploadId ? `/admin/uploads/${data.paper.uploadId}` : null);
  const [filterPick, setFilter] = useState<"flagged" | "unreviewed" | "approved" | "all" | null>(null);
  const [picked, setSelected] = useState<string | null | undefined>(undefined);
  const [pagePick, setPagePick] = useState<{ q: string | null; page: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [crop, setCrop] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [published, setPublished] = useState<{ questions: number; studentsToNotify: number; minutesFromUpload: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Flagged first; when nothing is flagged, start on what's left to review.
  const filter = filterPick ?? (!data || data.counts.flagged ? "flagged" : data.counts.unreviewed ? "unreviewed" : "all");
  const list = useMemo(() => (data?.questions ?? []).filter((q) => filter === "all" || q.state === filter), [data, filter]);
  const selected = picked === undefined ? (list[0]?.id ?? null) : picked;
  const q = data?.questions.find((x) => x.id === selected) ?? null;
  // The scan follows the selected question unless the admin pages through it by hand.
  const autoPage = q?.sourcePage && src?.pages.length ? Math.min(src.pages.length - 1, q.sourcePage - 1) : 0;
  const page = pagePick && pagePick.q === selected ? pagePick.page : autoPage;
  const setPage = (p: number) => setPagePick({ q: selected, page: p });

  if (!data) return <Header title="Review" />;
  const pageFile = src?.pages[page];
  const allApproved = data.counts.approved === data.counts.total && data.counts.total > 0;

  function onSaved(updated: AdminQuestion, approved: boolean) {
    mutate((d) => {
      if (!d) return d;
      const questions = d.questions.map((x) => (x.id === updated.id ? { ...x, ...updated, state: updated.status === "approved" ? "approved" : updated.flags.length ? "flagged" : "unreviewed" } as RQ : x));
      const counts = {
        ...d.counts,
        flagged: questions.filter((x) => x.state === "flagged").length,
        unreviewed: questions.filter((x) => x.state === "unreviewed").length,
        approved: questions.filter((x) => x.state === "approved").length,
        verified: questions.filter((x) => x.answerVerified).length,
      };
      return { ...d, questions, counts };
    });
    if (approved) {
      const idx = list.findIndex((x) => x.id === updated.id);
      const next = list.slice(idx + 1).find((x) => x.state !== "approved") ?? list.find((x) => x.state !== "approved" && x.id !== updated.id);
      setSelected(next?.id ?? null);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  // F13
  if (published) {
    return (
      <>
        <Header eyebrow={`Review · ${data.course.code}`} title="Published" />
        <main className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          <div className="flex w-full max-w-[560px] flex-col items-center gap-6 text-center">
            <span className="flex h-[84px] w-[84px] items-center justify-center rounded-[26px] bg-ok-tint"><Icon name="check" size={42} color="var(--ok-text)" weight={2.6} /></span>
            <strong className="font-display text-[34px] leading-tight">{data.course.code} · {data.paper.session} is live</strong>
            <span className="text-base leading-relaxed text-ink2">
              {published.questions} questions published for {published.studentsToNotify.toLocaleString()} students taking the course.
              {published.minutesFromUpload != null && ` It took ${published.minutesFromUpload} minutes from upload to publish.`}
            </span>
            <div className="flex flex-wrap justify-center gap-2.5">
              <ButtonLink href={`/admin/bank?course=${data.course.id}`} kind="outline" size="md">View in question bank</ButtonLink>
              <ButtonLink href="/admin/uploads?status=in_review" size="md" iconRight="arrowR">Next in queue</ButtonLink>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <div className="flex flex-col lg:h-dvh">
      <Header
        eyebrow={`Review · ${data.course.code} · ${data.paper.session} · ${data.paper.examType} · ${data.paper.timeLimitMin} min`}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {data.counts.total} questions
            {data.counts.flagged > 0 && <Status s="flagged">{data.counts.flagged} FLAGGED</Status>}
            <Status s="approved">{data.counts.approved} APPROVED</Status>
          </span>
        }
      >
        {data.paper.status === "published" ? (
          <Status s="published" />
        ) : (
          <>
            {data.counts.flagged > 0 && <span className="text-xs text-ink3">Clear {data.counts.flagged} flag{data.counts.flagged === 1 ? "" : "s"} to bulk-approve</span>}
            <Button
              kind="outline"
              size="md"
              disabled={data.counts.flagged > 0 || data.counts.unreviewed === 0}
              loading={busy}
              onClick={() => act(async () => { await api(`/admin/papers/${paperId}/approve-clean`, { method: "POST" }); await reload(); })}
            >
              Approve {data.counts.unreviewed} clean
            </Button>
            <Button size="md" disabled={!allApproved} onClick={() => setConfirm(true)}>Publish</Button>
          </>
        )}
      </Header>
      {err && <div className="px-4 pt-3 lg:px-6"><Banner tone="bad" icon="alert">{err}</Banner></div>}
      {data.upload?.error && <div className="px-4 pt-3 lg:px-6"><Banner tone="warn" icon="alert">{data.upload.error}. Check the numbering for gaps.</Banner></div>}

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        {/* Original */}
        <section className="flex h-[55vh] min-h-0 flex-col border-b border-line bg-raised lg:h-auto lg:border-r lg:border-b-0">
          <div className="flex min-h-11 flex-none flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line px-4 py-1.5 text-[13px] lg:h-11 lg:py-0">
            <button aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevL" size={16} /></button>
            <span className="font-mono">Page {page + 1} of {src?.pages.length ?? "…"}</span>
            <button aria-label="Next page" disabled={!src || page >= src.pages.length - 1} onClick={() => setPage(page + 1)}><Icon name="chevR" size={16} /></button>
            {q?.sourcePage && <span className="text-xs text-ink3">· Q{q.sourceNumber} is on p{q.sourcePage}</span>}
            <span className="flex-1" />
            <button aria-label="Zoom out" onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}><Icon name="minus" size={16} /></button>
            <span className="font-mono">{Math.round(zoom * 100)}%</span>
            <button aria-label="Zoom in" onClick={() => setZoom(Math.min(3, zoom + 0.1))}><Icon name="plus" size={16} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-8">
            {pageFile?.url ? (
              pageFile.mime.startsWith("image/") ? (
                <div className="relative mx-auto" style={{ width: `${zoom * 100}%` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pageFile.url} alt={`Page ${page + 1} of the original`} className="block w-full bg-white shadow-md" />
                  {/* Where each extracted question sits on this page. Click one to open it. */}
                  {data.questions
                    .filter((x) => x.sourcePage === page + 1 && x.sourceBox)
                    .map((x) => {
                      const b = x.sourceBox!;
                      const on = x.id === selected;
                      return (
                        <button
                          key={x.id}
                          onClick={() => { setSelected(x.id); setFilter("all"); }}
                          aria-label={`Question ${x.sourceNumber ?? x.position + 1}`}
                          className="absolute rounded-sm"
                          style={{
                            left: `${b.x * 100}%`,
                            top: `${b.y * 100}%`,
                            width: `${b.w * 100}%`,
                            height: `${b.h * 100}%`,
                            outline: on ? "2.5px solid #5B3DF5" : "1px dashed rgba(91,61,245,0.35)",
                            outlineOffset: 3,
                            background: on ? "rgba(91,61,245,0.08)" : "transparent",
                          }}
                        >
                          <span className="absolute -top-2.5 -left-2.5 rounded bg-violet px-1 font-mono text-[10px] font-bold text-white" style={{ opacity: on ? 1 : 0.6 }}>
                            Q{x.sourceNumber ?? x.position + 1}
                          </span>
                        </button>
                      );
                    })}
                </div>
              ) : pageFile.mime === "application/pdf" ? (
                <iframe src={`${pageFile.url}#page=${q?.sourcePage ?? 1}`} title="Original PDF" className="h-full w-full rounded bg-white" />
              ) : (
                <SourceText uploadId={data.paper.uploadId!} index={page} url={pageFile.url} find={q?.text ?? null} number={q?.sourceNumber ?? null} />
              )
            ) : (
              <span className="text-sm text-ink3">{data.paper.uploadId ? "Loading the original…" : "No original file (typed or imported questions)."}</span>
            )}
          </div>
        </section>

        {/* Extracted */}
        <section className="flex min-h-0 min-w-0 flex-col bg-bg">
          <div className="flex min-h-11 flex-none flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 lg:h-11 lg:py-0">
            <Pill on={filter === "flagged"} onClick={() => setFilter("flagged")}>Flagged {data.counts.flagged}</Pill>
            <Pill on={filter === "unreviewed"} onClick={() => setFilter("unreviewed")}>Not reviewed {data.counts.unreviewed}</Pill>
            <Pill on={filter === "approved"} onClick={() => setFilter("approved")}>Approved {data.counts.approved}</Pill>
            <Pill on={filter === "all"} onClick={() => setFilter("all")}>All {data.counts.total}</Pill>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
            {list.map((x) => {
              const open = x.id === selected;
              return (
                <div key={x.id} className={`rounded-2xl bg-surface ${open ? "border-2 border-accent p-3.5" : "border border-line"}`}>
                  <button onClick={() => setSelected(open ? null : x.id)} className={`flex w-full flex-col gap-1.5 text-left ${open ? "pb-3" : "px-3.5 py-3"}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-bold">Q{x.sourceNumber ?? x.position + 1}</span>
                      <Status s={x.state} />
                      {x.repeatOfId && <span className="rounded-md bg-accent-tint px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-accent-text">REPEAT</span>}
                      {!open && x.flags[0] && <span className="truncate text-[12.5px] text-flag-text">{x.flags[0]}</span>}
                      <span className="flex-1" />
                      {x.sourcePage && <span className="text-xs text-ink3">p{x.sourcePage}</span>}
                    </div>
                    {!open && (
                      <span className="truncate text-[13.5px] text-ink2">
                        <MathText text={x.text} /> · key {x.correctOption != null ? LETTERS[x.correctOption] : "?"}
                      </span>
                    )}
                  </button>
                  {open && (
                    <>
                      {x.repeatOfId && (
                        <div className="mb-3 flex flex-wrap items-center gap-2.5 rounded-xl bg-accent-tint px-3 py-2.5 text-[13px] text-accent-text">
                          <Icon name="copy" size={16} />
                          <span className="min-w-0 flex-1 basis-[180px]">Looks like a repeat from another year. Linked repeats tell students what examiners favour.</span>
                          <Button kind="ghost" size="sm" onClick={() => act(async () => { const r = await api<{ question: AdminQuestion }>(`/admin/questions/${x.id}`, { method: "PATCH", body: { repeatOfId: null } }); onSaved(r.question, false); })}>Not the same</Button>
                        </div>
                      )}
                      <QuestionEditor key={x.id} q={x} topics={data.topics} onSaved={onSaved} onCrop={() => setCrop(true)} />
                    </>
                  )}
                </div>
              );
            })}
            {!list.length && <span className="p-6 text-sm text-ink2">Nothing in this filter.</span>}
          </div>
        </section>
      </div>

      {crop && q && (
        <CropModal
          src={pageFile?.mime.startsWith("image/") ? pageFile.url : null}
          onClose={() => setCrop(false)}
          onSave={async (blob, alt) => {
            const fd = new FormData();
            fd.append("file", blob, "figure.png");
            fd.append("alt", alt);
            await api(`/admin/questions/${q.id}/image`, { method: "POST", body: fd });
            await reload();
          }}
        />
      )}

      {/* F12 */}
      <Dialog open={confirm} onClose={() => setConfirm(false)} label="Publish">
        <strong className="font-display text-[26px]">Publish {data.course.code} · {data.paper.session}?</strong>
        <div className="flex flex-col rounded-[14px] bg-bg">
          {[
            ["Questions approved", `${data.counts.approved} / ${data.counts.total}`],
            ["Answer keys verified", `${data.counts.verified} / ${data.counts.total}`],
            ["Linked as repeats", String(data.counts.repeats)],
            ["Format", `${data.paper.optionCount === 5 ? "A–E" : "A–D"}${data.paper.negativeMark ? ` · −${data.paper.negativeMark}` : ""} · ${data.paper.timeLimitMin} min`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-line px-5 py-4 text-sm last:border-0"><span>{k}</span><strong className="font-mono">{v}</strong></div>
          ))}
        </div>
        <span className="text-[13px] leading-relaxed text-ink3">It goes live in exam simulation, drills and topic practice. You can unpublish later; finished attempts are kept.</span>
        {err && <span className="text-sm text-bad-text">{err}</span>}
        <div className="flex justify-end gap-2.5">
          <Button kind="outline" size="md" onClick={() => setConfirm(false)}>Back to review</Button>
          <Button size="md" loading={busy} onClick={() => act(async () => { const r = await api<{ questions: number; studentsToNotify: number; minutesFromUpload: number | null }>(`/admin/papers/${paperId}/publish`, { method: "POST" }); setConfirm(false); setPublished(r); })}>Publish now</Button>
        </div>
      </Dialog>
      <Link href="/admin/uploads?status=in_review" className="sr-only">Back to review queue</Link>
    </div>
  );
}
