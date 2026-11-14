"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useApi } from "@/lib/use-api";
import { Header, Status, inputCls, useMyCourses } from "@/components/admin/kit";
import { ButtonLink, Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MathText } from "@/components/ui/math-text";

type BankRow = { id: string; text: string; topic: string | null; difficulty: string; status: string; attempts: number; correctPct: number | null; years: number };

export default function BankPage() {
  return (
    <Suspense>
      <Bank />
    </Suspense>
  );
}

/** F14 / F15 */
function Bank() {
  const sp = useSearchParams();
  const { data: mine } = useMyCourses();
  const [picked, setCourse] = useState(sp.get("course") ?? "");
  const course = picked || mine?.courses[0]?.id || "";
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [topic, setTopic] = useState("");
  const [year, setYear] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [status, setStatus] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: topics } = useApi<{ topics: { id: string; name: string }[] }>(course ? `/catalog/courses/${course}/topics` : null);
  const params = new URLSearchParams({ course, ...(debounced && { q: debounced }), ...(topic && { topic }), ...(year && { year }), ...(difficulty && { difficulty }), ...(status && { status }) });
  const { data } = useApi<{ total: number; questions: BankRow[] }>(course ? `/admin/questions?${params}` : null);
  const y = new Date().getFullYear();
  const filters = [topic, year, difficulty, status].filter(Boolean).length;

  return (
    <>
      <Header title="Question bank">
        <ButtonLink href={`/admin/bank/import${course ? `?course=${course}` : ""}`} kind="outline" size="md" icon="upload">Import CSV</ButtonLink>
        <ButtonLink href={`/admin/bank/question?new=1&course=${course}`} size="md" icon="plus">Add question</ButtonLink>
      </Header>
      <div className="flex flex-col gap-5 px-5 pt-8 sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-12 w-full items-center gap-3 rounded-[10px] border-[1.5px] border-line bg-surface px-4 text-[15px] sm:w-[360px]">
            <Icon name="search" size={18} color="var(--ink3)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search question text" className="min-w-0 flex-1 bg-transparent outline-none" />
          </label>
          <select value={course} onChange={(e) => { setCourse(e.target.value); setTopic(""); }} className={`${inputCls} border-accent bg-accent-tint font-semibold`} aria-label="Course">
            {mine?.courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters || filters > 0}
            className={`flex h-12 items-center gap-2.5 rounded-[10px] border-[1.5px] px-4 text-[15px] font-semibold ${filters ? "border-accent text-accent-text" : "border-line"}`}
          >
            <Icon name="filter" size={18} />
            Filters{filters ? ` · ${filters}` : ""}
          </button>
          <span className="flex-1" />
          <span className="text-[14px] text-ink3">{data?.total.toLocaleString() ?? "…"} questions</span>
        </div>
        {(showFilters || filters > 0) && (
          <div className="sheet-in flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-surface p-4">
            <select value={topic} onChange={(e) => setTopic(e.target.value)} className={inputCls} aria-label="Topic">
              <option value="">All topics</option>
              {topics?.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={year} onChange={(e) => setYear(e.target.value)} className={inputCls} aria-label="Year">
              <option value="">All years</option>
              {Array.from({ length: 10 }, (_, i) => `${y - i}/${y - i + 1}`).map((s) => <option key={s}>{s}</option>)}
            </select>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={inputCls} aria-label="Difficulty">
              <option value="">Any difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} aria-label="Status">
              <option value="">Any status</option><option value="approved">Live</option><option value="draft">Draft</option><option value="unverified">Unverified</option><option value="hidden">Hidden</option>
            </select>
            {filters > 0 && (
              <button type="button" className="px-2 text-[14px] font-semibold text-accent-text" onClick={() => { setTopic(""); setYear(""); setDifficulty(""); setStatus(""); }}>Clear</button>
            )}
          </div>
        )}
      </div>

      {data && data.total === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          <div className="flex w-full max-w-[460px] flex-col items-center gap-5 text-center">
            <span className="flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-raised"><Icon name="search" size={34} color="var(--ink2)" /></span>
            <strong className="font-display text-2xl">No questions match</strong>
            <span className="text-[15px] leading-relaxed text-ink2">{filters ? "One of the filters rules everything out. Clear them one at a time to find the cause." : debounced ? `Nothing contains “${debounced}”.` : "This course has no questions yet."}</span>
            <div className="flex flex-wrap justify-center gap-2.5">
              {filters > 0 && <Button size="md" onClick={() => { setTopic(""); setYear(""); setDifficulty(""); setStatus(""); }}>Clear filters</Button>}
              <ButtonLink href="/admin/uploads/new" kind="outline" size="md">Upload a paper</ButtonLink>
            </div>
          </div>
        </div>
      ) : (
        <main className="px-5 py-6 sm:px-8 lg:px-12 lg:py-8">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="hidden grid-cols-[3fr_1.3fr_0.8fr_0.8fr_0.8fr_0.9fr] gap-5 border-b md:grid border-line px-6 py-4 font-mono text-[11px] tracking-wider text-ink3">
              <span>QUESTION</span><span>TOPIC</span><span>YEARS</span><span>LEVEL</span><span>CORRECT</span><span>STATUS</span>
            </div>
            {data?.questions.map((r) => {
              const pc = r.correctPct;
              return (
                <Link key={r.id} href={`/admin/bank/question?id=${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line2 px-4 py-4 text-[13.5px] last:border-0 hover:bg-bg md:grid md:grid-cols-[3fr_1.3fr_0.8fr_0.8fr_0.8fr_0.9fr] md:gap-y-3 md:px-7">
                  <span className="w-full truncate md:w-auto"><MathText text={r.text} /></span>
                  <span className="max-w-full truncate text-ink2">{r.topic ?? "—"}</span>
                  <span className="font-mono text-xs">×{r.years}</span>
                  <span className="text-ink2 capitalize">{r.difficulty}</span>
                  <span className="font-mono font-bold" style={{ color: pc == null ? "var(--ink3)" : pc < 30 ? "var(--bad-text)" : pc < 60 ? "var(--flag-text)" : "var(--ok-text)" }}>{pc == null ? "—" : `${pc}%`}</span>
                  <span><Status s={r.status} /></span>
                </Link>
              );
            })}
          </div>
          {data && data.total > data.questions.length && <span className="block pt-3 text-center text-xs text-ink3">Showing the newest {data.questions.length}. Narrow the filters to see others.</span>}
        </main>
      )}
    </>
  );
}
