"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, type ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Field, Header, Panel, Status, areaCls, inputCls } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Banner, Dialog, Skeleton, fmtClock, useToast } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";
import { MathText } from "@/components/ui/math-text";
import { LETTERS, QUIZ_MAX_MINUTES } from "@/shared/game";

type QuizDetail = {
  quiz: {
    id: string;
    courseId: string;
    title: string;
    instructions: string | null;
    topicIds: string[];
    questionIds: string[];
    timeLimitMin: number;
    negativeMark: number;
    status: "draft" | "live" | "closed";
    closesAt: string | null;
    publishedAt: string | null;
    createdAt: string;
  };
  course: { id: string; code: string; title: string };
  topics: { id: string; name: string }[];
  questions: {
    id: string;
    number: number;
    text: string;
    options: string[];
    correctOption: number | null;
    explanation: string | null;
    imageUrl: string | null;
    topicName: string | null;
    difficulty: string;
    live: boolean;
    answered: number;
    correctPct: number | null;
  }[];
  stats: { sittings: number; students: number; average: number | null; best: number | null; avgTimeSec: number | null };
};

export default function QuizViewPage() {
  return (
    <Suspense>
      <QuizView />
    </Suspense>
  );
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function QuizView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const router = useRouter();
  const { data, reload, error } = useApi<QuizDetail>(id ? `/admin/quizzes/${id}` : null);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [justPublished] = useState(params.get("published") === "1");

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      reload();
      if (done) toast.show(done);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <>
        <Header eyebrow="Quizzes" title="Quiz" />
        <main className="flex flex-col gap-6 px-5 py-8 sm:px-8 lg:px-12">
          {error ? <Banner tone="bad" icon="alert">{error.message}</Banner> : <><Skeleton className="h-32 rounded-[18px]" /><Skeleton className="h-96 rounded-[18px]" /></>}
        </main>
      </>
    );
  }

  const { quiz, course, stats, questions, topics } = data;
  const locked = stats.sittings > 0; // questions are fixed once anyone has finished it
  const patch = (body: Record<string, unknown>, done: string) => run("patch", () => api(`/admin/quizzes/${quiz.id}`, { method: "PATCH", body }), done);

  const actions = (
    <>
      {quiz.status === "draft" && <Button size="md" icon="send" loading={busy === "patch"} disabled={!!busy} onClick={() => patch({ status: "live" }, "Published. The course's students have been told.")}>Publish</Button>}
      {quiz.status === "live" && <Button size="md" kind="outline" icon="lock" loading={busy === "patch"} disabled={!!busy} onClick={() => patch({ status: "closed" }, "Closed. Students can still review their results.")}>Close test</Button>}
      {quiz.status === "closed" && <Button size="md" kind="outline" icon="refresh" loading={busy === "patch"} disabled={!!busy} onClick={() => patch({ status: "live" }, "Reopened")}>Reopen</Button>}
    </>
  );

  return (
    <>
      <Header eyebrow={<Link href="/admin/quizzes" className="hover:underline">Quizzes · {course.code}</Link>} title={quiz.title}>
        {actions}
      </Header>

      <main className="flex flex-col gap-10 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
        <div className="flex flex-wrap items-center gap-3">
          <Status s={quiz.status} />
          <span className="text-sm text-ink2">
            {quiz.status === "draft" ? "Only admins can see this draft." : quiz.status === "live" ? `Live on ${course.code} students' Practise tab${quiz.closesAt ? ` until ${new Date(quiz.closesAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}.` : "Closed. Students can review but not sit it."}
          </span>
        </div>

        {justPublished && quiz.status === "live" && !stats.sittings && <Banner tone="ok" icon="check">Published. {course.code} students can see it now and have been sent a notification.</Banner>}
        {err && <Banner tone="bad" icon="alert">{err}</Banner>}

        {/* Numbers first: size, time, and how students did. */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5 lg:gap-5">
          {[
            ["Questions", String(questions.length)],
            ["Time limit", `${quiz.timeLimitMin} min`],
            ["Students", String(stats.students)],
            ["Average", stats.average != null ? `${stats.average}%` : "—"],
            ["Avg time", stats.avgTimeSec != null ? fmtClock(stats.avgTimeSec) : "—"],
          ].map(([l, v]) => (
            <Panel key={l} className="flex flex-col gap-2 p-5 lg:p-6">
              <span className="caps text-[12px] text-ink3">{l}</span>
              <strong className="font-display text-[32px] leading-none">{v}</strong>
            </Panel>
          ))}
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
          {/* The drawn questions, with the key, so the admin can check the draw. */}
          <section className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <strong className="text-[18px]">Questions</strong>
                <span className="text-[13px] text-ink2">
                  {locked ? "Fixed, because students have sat this test." : "Drawn at random. Swap any you don't want, or draw a whole new set."}
                </span>
              </div>
              {!locked && (
                <Button size="sm" kind="outline" icon="refresh" loading={busy === "redraw"} disabled={!!busy} onClick={() => run("redraw", () => api(`/admin/quizzes/${quiz.id}/redraw`, { method: "POST" }), "New set drawn")}>
                  Draw a new set
                </Button>
              )}
            </div>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
              {questions.map((q) => {
                const expanded = open === q.id;
                return (
                  <div key={q.id} className="border-b border-line2 last:border-0">
                    <div className="flex items-start gap-4 px-5 py-5 md:px-7">
                      <span className="w-7 flex-none pt-0.5 font-mono text-[13px] font-bold text-ink3">{q.number}</span>
                      <button onClick={() => setOpen(expanded ? null : q.id)} aria-expanded={expanded} className="flex min-w-0 flex-1 flex-col gap-2.5 text-left">
                        <MathText text={q.text} className={`text-[15px] leading-relaxed ${expanded ? "" : "line-clamp-2"}`} />
                        <span className="flex flex-wrap items-center gap-2 text-xs text-ink3">
                          {q.topicName && <span className="rounded-md bg-raised px-2 py-0.5 text-ink2">{q.topicName}</span>}
                          <span className="capitalize">{q.difficulty}</span>
                          {q.correctOption != null && <span>· Answer {LETTERS[q.correctOption]}</span>}
                          {q.correctPct != null && <span className={q.correctPct < 40 ? "font-semibold text-bad-text" : ""}>· {q.correctPct}% got it right</span>}
                          {!q.live && <span className="font-semibold text-bad-text">· Hidden from students</span>}
                        </span>
                      </button>
                      {!locked && (
                        <button
                          onClick={() => run(`swap-${q.id}`, () => api(`/admin/quizzes/${quiz.id}/swap`, { method: "POST", body: { questionId: q.id } }), `Question ${q.number} swapped`)}
                          disabled={!!busy}
                          className="flex h-10 flex-none items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold text-ink2 hover:border-ink3 disabled:opacity-50"
                          aria-label={`Swap question ${q.number}`}
                        >
                          <Icon name="refresh" size={15} />
                          <span className="hidden sm:inline">{busy === `swap-${q.id}` ? "Swapping…" : "Swap"}</span>
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <div className="flex flex-col gap-3 px-5 pb-6 pl-16 md:px-7 md:pl-[76px]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {q.imageUrl && <img src={q.imageUrl} alt="" className="max-h-60 self-start rounded-lg border border-line" />}
                        {q.options.map((o, i) => (
                          <div key={i} className={`flex gap-3 rounded-[10px] px-4 py-3 text-sm ${i === q.correctOption ? "bg-ok-tint text-ok-text" : "bg-bg"}`}>
                            <span className="font-mono font-bold">{LETTERS[i]}</span>
                            <MathText text={o} />
                          </div>
                        ))}
                        {q.explanation && <p className="pt-1 text-[13px] leading-relaxed text-ink2"><strong>Explanation: </strong>{q.explanation}</p>}
                        <Link href={`/admin/bank/question?id=${q.id}`} className="self-start text-[13px] font-semibold text-accent-text">Edit in the question bank</Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Settings: what can change after the draw. */}
          <aside className="flex flex-col gap-6 lg:sticky lg:top-[104px]">
            <Panel className="flex flex-col gap-6 p-6 sm:p-8">
              <div className="flex items-center justify-between">
                <span className="caps text-[12px] text-ink3">Details</span>
                {!editing && <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-[13px] font-semibold text-accent-text"><Icon name="edit" size={15} />Edit</button>}
              </div>
              {editing ? (
                <EditDetails
                  quiz={quiz}
                  locked={locked}
                  busy={busy === "patch"}
                  onCancel={() => setEditing(false)}
                  onSave={async (body) => {
                    await patch(body, "Saved");
                    setEditing(false);
                  }}
                />
              ) : (
                <dl className="flex flex-col gap-5 text-sm">
                  <Row k="Course">{course.code} · {course.title}</Row>
                  <Row k="Topics">{topics.length ? topics.map((t) => t.name).join(", ") : "All topics"}</Row>
                  <Row k="Marking">{quiz.negativeMark ? `−${quiz.negativeMark} per wrong answer` : "No negative marking"}</Row>
                  <Row k="Closes">{quiz.closesAt ? new Date(quiz.closesAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Stays open until you close it"}</Row>
                  {quiz.instructions && <Row k="Note to students"><span className="whitespace-pre-line">{quiz.instructions}</span></Row>}
                  {stats.best != null && <Row k="Best score">{stats.best}% · {stats.sittings} sitting{stats.sittings === 1 ? "" : "s"}</Row>}
                </dl>
              )}
            </Panel>
            {!locked && (
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-2 self-start px-1 text-[13px] font-semibold text-bad-text">
                <Icon name="trash" size={15} />Delete this test
              </button>
            )}
          </aside>
        </div>
      </main>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} label="Delete quiz">
        <strong className="font-display text-2xl">Delete “{quiz.title}”?</strong>
        <span className="text-sm leading-relaxed text-ink2">The questions stay in the bank. Students who haven&apos;t finished it will lose their sitting.</span>
        <div className="flex gap-3 pt-2">
          <Button kind="outline" size="md" full onClick={() => setConfirmDelete(false)}>Keep it</Button>
          <Button
            kind="danger"
            size="md"
            full
            loading={busy === "delete"}
            onClick={() => run("delete", async () => {
              await api(`/admin/quizzes/${quiz.id}`, { method: "DELETE" });
              router.replace("/admin/quizzes");
            })}
          >
            Delete
          </Button>
        </div>
      </Dialog>
      {toast.node}
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-ink3">{k}</dt>
      <dd className="leading-relaxed">{children}</dd>
    </div>
  );
}

function EditDetails({ quiz, locked, busy, onSave, onCancel }: { quiz: QuizDetail["quiz"]; locked: boolean; busy: boolean; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(quiz.title);
  const [minutes, setMinutes] = useState(quiz.timeLimitMin);
  const [closes, setCloses] = useState(toLocalInput(quiz.closesAt));
  const [note, setNote] = useState(quiz.instructions ?? "");
  const [negative, setNegative] = useState(quiz.negativeMark);
  return (
    <div className="flex flex-col gap-6">
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className={inputCls} /></Field>
      <Field label="Time limit (minutes)"><input type="number" min={1} max={QUIZ_MAX_MINUTES} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 1)} className={inputCls} /></Field>
      <Field label="Negative marking" hint={locked ? "Fixed once students have sat it." : undefined}>
        <select value={negative} disabled={locked} onChange={(e) => setNegative(Number(e.target.value))} className={inputCls}>
          <option value={0}>None</option>
          <option value={0.25}>−0.25 per wrong answer</option>
          <option value={0.5}>−0.5 per wrong answer</option>
        </select>
      </Field>
      <Field label="Closes on" hint="Leave empty to keep it open."><input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} className={inputCls} /></Field>
      <Field label="Note to students"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className={areaCls} /></Field>
      <div className="flex gap-3">
        <Button kind="outline" size="md" full onClick={onCancel}>Cancel</Button>
        <Button
          size="md"
          full
          loading={busy}
          disabled={title.trim().length < 3}
          onClick={() => onSave({ title: title.trim(), timeLimitMin: minutes, closesAt: closes ? new Date(closes).toISOString() : null, instructions: note.trim() || null, ...(locked ? {} : { negativeMark: negative }) })}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
