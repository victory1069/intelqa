"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useOnline } from "@/lib/use-online";
import { odb, useAskLater } from "@/lib/offline";
import { bundleQuestions } from "@/lib/grade-local";
import { startOnline } from "@/lib/start";
import type { ReviewItem } from "@/lib/types";
import { Gate } from "@/components/gate";
import { KeyedBySearch } from "@/components/keyed";
import { AppBar, EmptyState, Pill, Screen, Sheet, useToast } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icon";
import { Option, type OptionState } from "@/components/ui/option";
import { MathText } from "@/components/ui/math-text";
import { LETTERS } from "@/shared/game";

type Filter = "missed" | "all" | "flagged";

export default function ReviewPage() {
  return (
    <Gate>
      <Suspense>
        <KeyedBySearch>
          <Review />
        </KeyedBySearch>
      </Suspense>
    </Gate>
  );
}

/** Loads review items online, or builds them from the downloaded course for offline sessions. */
function useItems(id: string | null, clientId: string | null) {
  const online = useApi<{ total: number; items: ReviewItem[] }>(id ? `/attempts/${id}/review?filter=all` : null);
  const [offline, setOffline] = useState<{ total: number; items: ReviewItem[] } | null>(null);
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const a = await odb().offlineAttempts.get(clientId);
      if (!a) return;
      const { map } = await bundleQuestions(a.courseId);
      setTitle(a.title);
      setOffline({
        total: a.questionIds.length,
        items: a.questionIds.filter((q) => map.has(q)).map((qid, n) => {
          const q = map.get(qid)!;
          const chosen = a.answers[qid]?.choice ?? null;
          return { number: n + 1, chosen, correct: chosen != null && chosen === q.correctOption, flagged: !!a.answers[qid]?.flagged, bookmarked: false, topicName: null, question: q };
        }),
      });
    })();
  }, [clientId]);
  return { data: clientId ? offline : online.data, title };
}

function Review() {
  const sp = useSearchParams();
  const id = sp.get("id");
  const clientId = sp.get("c");
  const router = useRouter();
  const { data, title } = useItems(id, clientId);
  const [filter, setFilter] = useState<Filter>((sp.get("filter") as Filter) || "missed");
  const [open, setOpen] = useState<number | null>(null);
  // C19: questions saved for Ask while offline get bookmarked here once the phone reconnects.
  useAskLater();

  if (!data) return <Screen className="items-center justify-center"><Spinner size={32} color="var(--accent)" /></Screen>;
  const all = data.items;
  const list = all.filter((i) => (filter === "all" ? true : filter === "flagged" ? i.flagged : !i.correct));
  const missedCount = all.filter((i) => !i.correct).length;
  const flaggedCount = all.filter((i) => i.flagged).length;
  const score = all.filter((i) => i.correct).length;

  if (open != null) {
    return (
      <Detail
        items={list}
        index={open}
        total={list.length}
        offline={!!clientId}
        onIndex={setOpen}
        onBack={() => setOpen(null)}
        onBookmark={(qid, on) => {
          const item = all.find((x) => x.question.id === qid);
          if (item) item.bookmarked = on;
        }}
      />
    );
  }

  return (
    <Screen>
      <AppBar title="Review" sub={clientId ? title : `${score}/${data.total} correct`} onLead={() => router.back()} />
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-5 pb-2.5">
        <Pill on={filter === "missed"} onClick={() => setFilter("missed")}>Wrong &amp; skipped · {missedCount}</Pill>
        <Pill on={filter === "all"} onClick={() => setFilter("all")}>All {data.total}</Pill>
        {flaggedCount > 0 && <Pill on={filter === "flagged"} onClick={() => setFilter("flagged")}>Flagged {flaggedCount}</Pill>}
      </div>
      {list.length === 0 && filter === "missed" ? (
        <>
          <div className="flex-1">
            <EmptyState glyph="check" tone="ok" title="Nothing to fix">You got all {data.total} right. You can still read the explanations to check your reasoning.</EmptyState>
          </div>
          <div className="px-[22px] pb-5"><Button full kind="outline" onClick={() => setFilter("all")}>Show all {data.total}</Button></div>
        </>
      ) : (
        <main className="flex flex-col gap-2 px-5 pb-6">
          {list.map((it, n) => {
            const key = it.question.correctOption;
            const skipped = it.chosen == null;
            const badge = it.correct ? "bg-ok-tint text-ok-text" : skipped ? "bg-raised text-ink2" : "bg-bad-tint text-bad-text";
            return (
              <button key={it.question.id} onClick={() => setOpen(n)} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-left">
                <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-[10px] font-mono text-[13px] font-bold ${badge}`}>{it.number}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm">{it.question.text.replace(/\$/g, "")}</span>
                  <span className="font-mono text-[11px] text-ink3">
                    {skipped ? "SKIPPED" : `YOU ${LETTERS[it.chosen!]}`} · ANSWER {key != null ? LETTERS[key] : "?"}
                  </span>
                </span>
                <Icon name="chevR" size={18} color="var(--ink3)" />
              </button>
            );
          })}
        </main>
      )}
    </Screen>
  );
}

function Detail({
  items, index, total, offline, onIndex, onBack, onBookmark,
}: {
  items: ReviewItem[]; index: number; total: number; offline: boolean; onIndex: (n: number) => void; onBack: () => void; onBookmark: (qid: string, on: boolean) => void;
}) {
  const router = useRouter();
  const online = useOnline();
  const toast = useToast();
  const it = items[index];
  const q = it.question;
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const marked = marks[q.id] ?? it.bookmarked;
  const setMarked = (v: boolean) => setMarks((m) => ({ ...m, [q.id]: v }));
  const [reportOpen, setReportOpen] = useState(false);
  const [practising, setPractising] = useState(false);

  const state = (n: number): OptionState => {
    if (n === q.correctOption) return it.chosen === n ? "picked" : "correct";
    if (n === it.chosen) return "wrong";
    return "dim";
  };
  const keyLetter = q.correctOption != null ? LETTERS[q.correctOption] : "?";

  return (
    <Screen>
      <AppBar title={`Question ${it.number}`} sub={`${index + 1} of ${total} to review`} onLead={onBack}>
        {!offline && (
          <button
            aria-label={marked ? "Remove bookmark" : "Bookmark"}
            aria-pressed={marked}
            className="flex h-11 w-11 items-center justify-center"
            onClick={async () => {
              const next = !marked;
              setMarked(next);
              onBookmark(q.id, next);
              await api(`/me/bookmarks/${q.id}`, { method: next ? "PUT" : "DELETE" }).catch(() => setMarked(!next));
            }}
          >
            <Icon name="bookmark" size={22} fill={marked ? "var(--accent)" : "none"} color={marked ? "var(--accent)" : "currentColor"} />
          </button>
        )}
      </AppBar>
      <main className="flex flex-1 flex-col gap-2.5 px-5 pb-4">
        {!q.answerVerified && (
          <div className="flex items-start gap-2.5 rounded-[14px] bg-flag-tint px-3 py-2.5 text-[13px] leading-snug text-flag-text">
            <Icon name="alert" size={18} />
            <span><strong>This answer key hasn&apos;t been checked yet.</strong> A tutor is reviewing it. If you think it&apos;s wrong, tell us.</span>
          </div>
        )}
        {it.chosen == null && <span className="self-start rounded-md bg-raised px-2 py-1 font-mono text-[11px] font-bold text-ink2">YOU SKIPPED THIS</span>}
        <p className="text-base leading-relaxed font-medium"><MathText text={q.text} /></p>
        {q.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.imageUrl} alt={q.imageAlt ?? "Figure"} className="max-h-48 self-center rounded-xl border border-line bg-white p-2" />
        )}
        {q.options.map((o, n) => (
          <Option key={n} letter={LETTERS[n]} text={o} state={state(n)} tag={!q.answerVerified && n === q.correctOption ? (it.chosen === n ? "YOUR ANSWER · LIKELY CORRECT" : "LIKELY CORRECT") : undefined} />
        ))}

        <div className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-bold tracking-wide text-ink3">{q.workedSteps?.length ? "WORKING" : q.answerVerified ? `WHY ${keyLetter}` : "SUGGESTED EXPLANATION"}</span>
            {q.answerVerified && <span className="flex items-center gap-1 text-[11px] text-ok-text"><Icon name="shield" size={12} />Checked by a tutor</span>}
          </div>
          {q.explanation && <span className="text-sm leading-relaxed"><MathText text={q.explanation} /></span>}
          {q.workedSteps?.map((s, n) => (
            <div key={n} className="flex items-baseline gap-3 text-sm leading-relaxed">
              <span className="font-mono text-xs font-bold text-accent-text">{n + 1}</span>
              <MathText text={s} />
            </div>
          ))}
          {q.trap && !it.correct && (
            <span className="border-t border-line2 pt-2.5 text-[13px] leading-snug text-bad-text">
              <strong>{it.chosen != null ? `Why not ${LETTERS[it.chosen]}?` : "The trap:"}</strong> <MathText text={q.trap} />
            </span>
          )}
        </div>

        {q.topicId && !offline && (
          <div className="flex flex-wrap items-center gap-2">
            {it.topicName && <span className="rounded-lg bg-raised px-2.5 py-1.5 text-xs font-semibold">{it.topicName}</span>}
            <button
              disabled={practising || !online}
              className="text-[13px] font-semibold text-accent-text disabled:opacity-50"
              onClick={async () => {
                setPractising(true);
                try {
                  router.push(await startOnline({ mode: "topic", topicId: q.topicId! }));
                } catch {
                  setPractising(false);
                }
              }}
            >
              Practise this topic →
            </button>
          </div>
        )}
        {!it.correct && !offline && (
          <button onClick={() => setReportOpen(true)} className="flex items-center gap-1.5 self-start py-1 text-[13px] font-semibold text-ink2">
            <Icon name="report" size={16} />Report a problem
          </button>
        )}
      </main>
      <div className="sticky bottom-0 flex gap-2 border-t border-line bg-surface px-3.5 pt-2.5" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}>
        {!it.correct && !offline && (
          <Button kind="tonal" size="md" icon="sparkle" full onClick={() => router.push(`/ask?q=${q.id}&n=${it.number}${it.chosen != null ? `&chosen=${it.chosen}` : ""}`)}>
            Still confused? Ask
          </Button>
        )}
        {/* C12: a labelled report button. When Ask takes the wide slot, it moves above the bar. */}
        {!offline && it.correct && (
          <Button kind="outline" size="md" icon="report" full onClick={() => setReportOpen(true)}>Report a problem</Button>
        )}
        {index < total - 1 ? (
          <Button size="md" iconRight="chevR" full={offline} onClick={() => onIndex(index + 1)}>Next</Button>
        ) : (
          <Button size="md" kind="outline" full={offline} onClick={onBack}>Done</Button>
        )}
      </div>
      <ReportSheet
        open={reportOpen}
        number={it.number}
        questionId={q.id}
        onClose={() => setReportOpen(false)}
        onSent={() => {
          setReportOpen(false);
          toast.show("Thanks, report sent", `A tutor will check Q${it.number}. If the key changes, your score is recalculated and you'll be told.`);
        }}
      />
      {toast.node}
    </Screen>
  );
}

const REASONS = [
  ["wrong_key", "The correct answer is wrong"],
  ["unclear_explanation", "The explanation doesn't make sense"],
  ["typo", "Typo or missing option"],
  ["other", "Something else"],
] as const;

/** C14: short and specific. Three reports hide the question until an admin reviews it. */
function ReportSheet({ open, number, questionId, onClose, onSent }: { open: boolean; number: number; questionId: string; onClose: () => void; onSent: () => void }) {
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("wrong_key");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} label="Report a problem">
      <strong className="font-display text-[22px]">What&apos;s wrong with Q{number}?</strong>
      <div className="flex flex-col gap-1.5" role="radiogroup">
        {REASONS.map(([k, label]) => {
          const on = reason === k;
          return (
            <button key={k} role="radio" aria-checked={on} onClick={() => setReason(k)} className={`flex h-12 items-center gap-3 rounded-xl px-3 text-left ${on ? "border-2 border-accent bg-accent-tint" : "border-[1.5px] border-line"}`}>
              <span className={`h-5 w-5 flex-none rounded-full ${on ? "border-[6px] border-accent" : "border-2 border-line"}`} />
              <span className={`text-[15px] ${on ? "font-semibold" : ""}`}>{label}</span>
            </button>
          );
        })}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder={`Optional: what should it be? e.g. "Lecturer said B in class"`}
        className="h-[76px] resize-none rounded-xl border-[1.5px] border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      {err && <span className="text-sm text-bad-text">{err}</span>}
      <Button
        full
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await api(`/questions/${questionId}/report`, { method: "POST", body: { reason, note: note.trim() || undefined } });
            setNote("");
            onSent();
          } catch (e) {
            setErr((e as ApiError).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Send report
      </Button>
    </Sheet>
  );
}
