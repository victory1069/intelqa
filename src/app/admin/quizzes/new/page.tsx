"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, type ApiError } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Field, Header, Panel, areaCls, inputCls, useMyCourses } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Banner, Pill } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";
import { QUIZ_MAX_MINUTES, QUIZ_MAX_QUESTIONS, QUIZ_MIN_QUESTIONS } from "@/shared/game";

type Pool = { topics: { id: string; name: string; available: number }[]; untagged: number; total: number };

const SIZES = [5, 10, 15, 20, 25] as const;

export default function NewQuizPage() {
  return (
    <Suspense>
      <NewQuiz />
    </Suspense>
  );
}

/**
 * The admin sets the rules (course, topics, size, time); the questions are drawn at random,
 * spread across the topics. The next screen shows the draw so a bad question can be swapped.
 */
function NewQuiz() {
  const router = useRouter();
  const { data: mine } = useMyCourses();
  const [courseId, setCourseId] = useState(useSearchParams().get("course") ?? "");
  const { data: pool } = useApi<Pool>(courseId ? `/admin/quizzes/pool?course=${courseId}` : null);
  const course = mine?.courses.find((c) => c.id === courseId);

  const [title, setTitle] = useState("");
  const [count, setCount] = useState(20);
  const [minutes, setMinutes] = useState<number | null>(null); // null = follow the size
  const [picked, setPicked] = useState<string[]>([]); // empty = all topics
  const [more, setMore] = useState(false);
  const [negative, setNegative] = useState(0);
  const [closes, setCloses] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<"draft" | "live" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const time = minutes ?? count; // a minute a question unless the admin sets it
  const topics = pool?.topics ?? [];
  const available = !pool ? 0 : picked.length ? topics.filter((t) => picked.includes(t.id)).reduce((s, t) => s + t.available, 0) : pool.total;
  const chosen = picked.length ? topics.filter((t) => picked.includes(t.id) && t.available) : topics.filter((t) => t.available);
  const short = !!pool && available < count;
  const fallbackTitle = course ? `${course.code} practice test` : "Practice test";

  const missing = [!courseId && "a course", short && "enough questions", !(time >= 1 && time <= QUIZ_MAX_MINUTES) && "a time limit"].filter(Boolean) as string[];

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function create(publish: boolean) {
    setBusy(publish ? "live" : "draft");
    setErr(null);
    try {
      const r = await api<{ id: string }>("/admin/quizzes", {
        method: "POST",
        body: {
          courseId,
          title: title.trim() || fallbackTitle,
          questionCount: count,
          timeLimitMin: time,
          topicIds: picked,
          negativeMark: negative,
          closesAt: closes ? new Date(closes).toISOString() : null,
          instructions: instructions.trim() || null,
          publish,
        },
      });
      router.push(`/admin/quizzes/view?id=${r.id}${publish ? "&published=1" : ""}`);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(null);
    }
  }

  return (
    <>
      <Header eyebrow="Practice tests" title="New practice test" />
      <main className="grid items-start gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12 lg:px-12 lg:py-12">
        <Panel className="flex min-w-0 flex-col gap-9 p-6 sm:p-8 lg:p-10">
          <Field label="Course">
            <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setPicked([]); }} className={inputCls}>
              <option value="">Choose a course</option>
              {mine?.courses.map((c) => <option key={c.id} value={c.id}>{c.institution} · {c.code} · {c.title}</option>)}
            </select>
          </Field>

          <Field label="Title" hint="Students see this on their Practise tab.">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={fallbackTitle} maxLength={80} className={inputCls} />
          </Field>

          <div className="flex flex-col gap-4">
            <span className="text-[14px] font-semibold">Number of questions</span>
            <div className="flex flex-wrap gap-2">
              {SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  aria-pressed={count === n}
                  className={`h-14 min-w-16 rounded-[12px] px-4 font-mono text-[18px] font-bold ${count === n ? "border-2 border-accent bg-accent-tint text-accent-text" : "border-[1.5px] border-line"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={QUIZ_MIN_QUESTIONS}
              max={QUIZ_MAX_QUESTIONS}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              aria-label="Number of questions"
              className="w-full accent-[var(--accent)]"
            />
            <span className="text-xs text-ink3">{count} questions. Up to {QUIZ_MAX_QUESTIONS} per test.</span>
          </div>

          <Field label="Time limit (minutes)" hint={minutes == null ? "A minute a question. Change it if you like." : <button type="button" className="font-semibold text-accent-text" onClick={() => setMinutes(null)}>Reset to a minute a question</button>}>
            <input type="number" min={1} max={QUIZ_MAX_MINUTES} value={time} onChange={(e) => setMinutes(Number(e.target.value) || 1)} className={`${inputCls} max-w-[200px]`} />
          </Field>

          <div className="flex flex-col gap-4">
            <span className="text-[14px] font-semibold">Topics</span>
            {!courseId ? (
              <span className="text-sm text-ink3">Choose a course first.</span>
            ) : !pool ? (
              <span className="text-sm text-ink3">Loading topics…</span>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Pill on={!picked.length} onClick={() => setPicked([])}>All topics · {pool.total}</Pill>
                  {topics.map((t) => (
                    <Pill key={t.id} on={picked.includes(t.id)} onClick={() => t.available && toggle(t.id)}>
                      <span className={t.available ? "" : "opacity-50"}>{t.name} · {t.available}</span>
                    </Pill>
                  ))}
                </div>
                <span className="text-xs leading-relaxed text-ink3">
                  Numbers are checked questions ready to use.{pool.untagged ? ` ${pool.untagged} more have no topic yet; they're included with "All topics".` : ""} Questions are spread evenly across the topics you pick.
                </span>
              </>
            )}
          </div>

          <div className="flex flex-col gap-6 border-t border-line2 pt-7">
            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center gap-2 self-start text-[14px] font-semibold text-ink2">
              <Icon name={more ? "chevU" : "chevD"} size={18} />
              More options
              <span className="font-normal text-ink3">marking, closing date, a note to students</span>
            </button>
            {more && (
              <div className="flex flex-col gap-8">
                <div className="flex flex-col gap-4">
                  <span className="text-[14px] font-semibold">Negative marking</span>
                  <div className="flex flex-wrap gap-2">
                    {[0, 0.25, 0.5].map((n) => (
                      <Pill key={n} on={negative === n} onClick={() => setNegative(n)}>{n ? `−${n} per wrong answer` : "None"}</Pill>
                    ))}
                  </div>
                </div>
                <Field label="Closes on" hint="Optional. After this, students can review but not sit it.">
                  <input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} className={`${inputCls} max-w-[280px]`} />
                </Field>
                <Field label="Note to students" hint="Optional. Shown on the test's start screen.">
                  <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} maxLength={500} placeholder="e.g. Covers everything up to week 6. Sit it before Friday's CA." className={areaCls} />
                </Field>
              </div>
            )}
          </div>
        </Panel>

        {/* Summary: what will be drawn, and the two ways to finish. */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-[104px]">
          <Panel className="flex flex-col gap-6 p-6 sm:p-8">
            <span className="caps text-[12px] text-ink3">This test</span>
            <div className="flex flex-col gap-1.5">
              <strong className="font-display text-[28px] leading-tight">{title.trim() || fallbackTitle}</strong>
              <span className="text-sm text-ink2">{count} questions · {time} min{negative ? ` · −${negative} per wrong` : ""}</span>
            </div>
            <div className="flex flex-col gap-3 border-t border-line2 pt-5 text-sm">
              <span className="font-semibold">Drawn at random from</span>
              {!courseId ? (
                <span className="text-ink3">Choose a course</span>
              ) : !pool ? (
                <span className="text-ink3">Loading…</span>
              ) : chosen.length ? (
                <ul className="flex flex-col gap-2 text-ink2">
                  {chosen.slice(0, 8).map((t) => <li key={t.id} className="flex justify-between gap-3"><span className="truncate">{t.name}</span><span className="font-mono text-ink3">{t.available}</span></li>)}
                  {chosen.length > 8 && <li className="text-ink3">and {chosen.length - 8} more topics</li>}
                  {!picked.length && pool.untagged > 0 && <li className="flex justify-between gap-3"><span>No topic yet</span><span className="font-mono text-ink3">{pool.untagged}</span></li>}
                </ul>
              ) : (
                <span className="text-ink2">{pool.total} checked questions, none tagged by topic yet.</span>
              )}
            </div>
            {short && (
              <Banner tone="bad" icon="alert">
                {available ? `Only ${available} checked question${available === 1 ? "" : "s"} to draw from. Pick fewer questions${picked.length ? " or more topics" : ""}.` : "No checked questions here yet. Publish a paper for this course first."}
              </Banner>
            )}
            {err && <Banner tone="bad" icon="alert">{err}</Banner>}
            <div className="flex flex-col gap-3">
              <Button full loading={busy === "live"} disabled={!!missing.length || !!busy} onClick={() => create(true)} icon="send">Generate and publish</Button>
              <Button full kind="outline" loading={busy === "draft"} disabled={!!missing.length || !!busy} onClick={() => create(false)}>Generate as draft</Button>
            </div>
            <span className="text-xs leading-relaxed text-ink3">
              {missing.length ? `Still needs ${missing.join(", ")}.` : "A draft lets you look through the questions and swap any before students see it. Publishing tells the course's students straight away."}
            </span>
          </Panel>
        </aside>
      </main>
    </>
  );
}
