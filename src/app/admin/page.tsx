"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { Header, Panel, Status, ago, useMyCourses } from "@/components/admin/kit";
import { ButtonLink } from "@/components/ui/button";
import { Icon, type Glyph } from "@/components/ui/icon";
import { LETTERS } from "@/shared/game";

type Dash = {
  waiting: { inReview: number; failed: number; reports: number; liveQuestions: number };
  week: Record<string, number | null>;
  recentUploads: { id: string; code: string; session: string; status: string; created_at: string; pages: number; error: string | null }[];
  suspectKeys: { id: string; text: string; course_code: string; session: string | null; number: number | null; key: number; top: number; top_pct: number; key_pct: number }[];
};

function delta(now: number | null, prev: number | null, suffix = "%") {
  if (now == null || prev == null || prev === 0) return null;
  const d = suffix === "%" ? Math.round(((now - prev) / prev) * 100) : Math.round(now - prev);
  return { text: `${d >= 0 ? "↑" : "↓"} ${Math.abs(d)}${suffix === "%" ? "%" : " pts"}`, up: d >= 0 };
}

/** F02 / F03: work waiting first, then a short health check. */
export default function Dashboard() {
  const { me } = useAuth();
  const { data } = useApi<Dash>("/admin/dashboard");
  const { data: courses } = useMyCourses();
  const h = new Date().getHours();
  const hello = `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${me?.firstName ?? ""}`;
  const scope = courses?.courses.length ? courses.courses.slice(0, 4).map((c) => c.code).join(", ") + (courses.courses.length > 4 ? "…" : "") : "";

  if (data && !data.recentUploads.length && data.waiting.liveQuestions === 0) {
    return (
      <>
        <Header eyebrow={`Your courses: ${scope}`} title={`Welcome, ${me?.firstName ?? ""}`} />
        <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          <div className="flex w-full max-w-[560px] flex-col items-center gap-8 text-center">
            <span className="flex h-[84px] w-[84px] items-center justify-center rounded-[26px] bg-accent-tint"><Icon name="upload" size={40} color="var(--accent-text)" /></span>
            <strong className="font-display text-[32px] leading-tight">Upload your first past paper</strong>
            <span className="text-base leading-relaxed text-ink2">Photos from your phone work. So do scanned PDFs and Word files. We&apos;ll pull out the questions, options and answers, and you check them before anything goes live.</span>
            <div className="flex flex-wrap justify-center gap-2">{["PDF", "DOCX", "JPG / PNG · many pages", "CSV"].map((t) => <span key={t} className="rounded-lg bg-raised px-2.5 py-1.5 font-mono text-xs">{t}</span>)}</div>
            <ButtonLink href="/admin/uploads/new" icon="upload">Upload a paper</ButtonLink>
          </div>
        </div>
      </>
    );
  }

  const cards: { n: number; label: string; glyph: Glyph; tint: string; fg: string; cta: string; href: string }[] = data
    ? [
        { n: data.waiting.inReview, label: "Papers waiting for review", glyph: "layers", tint: "bg-flag-tint", fg: "var(--flag-text)", cta: "Review", href: "/admin/uploads?status=in_review" },
        { n: data.waiting.reports, label: "Questions with open reports", glyph: "inbox", tint: "bg-bad-tint", fg: "var(--bad-text)", cta: "Open", href: "/admin/reports" },
        { n: data.waiting.failed, label: data.waiting.failed === 1 ? "Upload failed" : "Uploads failed", glyph: "alert", tint: "bg-bad-tint", fg: "var(--bad-text)", cta: "Fix", href: "/admin/uploads?status=failed" },
        { n: data.waiting.liveQuestions, label: "Live questions", glyph: "book", tint: "bg-accent-tint", fg: "var(--accent-text)", cta: "Bank", href: "/admin/bank" },
      ]
    : [];
  const w = data?.week ?? {};
  const stats = [
    ["Active students", w.active, delta(w.active, w.active_prev)],
    ["Sessions", w.sessions, delta(w.sessions, w.sessions_prev)],
    ["Avg score", w.avg_score != null ? `${w.avg_score}%` : "—", delta(w.avg_score, w.avg_score_prev, "pts")],
  ] as const;

  return (
    <>
      <Header eyebrow={scope && `Your courses: ${scope}`} title={hello}>
        <ButtonLink href="/admin/quizzes/new" icon="plus" size="md" kind="outline">New quiz</ButtonLink>
        <ButtonLink href="/admin/uploads/new" icon="upload" size="md">Upload a paper</ButtonLink>
      </Header>
      <main className="flex flex-col gap-6 lg:gap-8 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4 lg:gap-5">
          {cards.map((c) => (
            <Link key={c.label} href={c.href} className="flex flex-col gap-4 rounded-[18px] border border-line bg-surface p-6">
              <div className="flex items-center justify-between">
                <span className={`flex h-[38px] w-[38px] items-center justify-center rounded-xl ${c.tint}`}><Icon name={c.glyph} size={20} color={c.fg} /></span>
                <span className="text-[13px] font-semibold text-accent-text">{c.cta} →</span>
              </div>
              <strong className="font-display text-4xl leading-none">{c.n.toLocaleString()}</strong>
              <span className="text-sm text-ink2">{c.label}</span>
            </Link>
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Panel className="overflow-hidden">
            <div className="flex justify-between border-b border-line px-6 py-4"><strong className="text-[15px]">Recent uploads</strong><Link href="/admin/uploads" className="text-[13px] font-semibold text-accent-text">All uploads</Link></div>
            {data?.recentUploads.map((u) => (
              <Link key={u.id} href={`/admin/uploads/view?id=${u.id}`} className="flex items-center gap-3.5 border-b border-line2 px-6 py-4 last:border-0">
                <Icon name="file" size={20} color="var(--ink2)" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-semibold">{u.code} · {u.session}</span>
                  <span className="text-xs text-ink3">{u.pages} file{u.pages === 1 ? "" : "s"} · {ago(u.created_at)}</span>
                </div>
                <Status s={u.status} />
              </Link>
            ))}
            {!data?.recentUploads.length && <span className="block p-6 text-sm text-ink2">No uploads yet.</span>}
          </Panel>
          <Panel className="flex flex-col gap-5 p-6">
            <div className="flex justify-between"><strong className="text-[15px]">This week</strong><span className="text-xs text-ink3">vs last week</span></div>
            <div className="grid grid-cols-2 gap-5">
              {stats.map(([l, v, d]) => (
                <div key={l} className="flex flex-col gap-0.5">
                  <span className="text-xs text-ink2">{l}</span>
                  <strong className="font-display text-[26px]">{v ?? 0}</strong>
                  {d && <span className="text-xs font-semibold" style={{ color: d.up ? "var(--ok-text)" : "var(--bad-text)" }}>{d.text}</span>}
                </div>
              ))}
            </div>
            {data?.suspectKeys.map((s) => (
              <Link key={s.id} href={`/admin/bank/question?id=${s.id}`} className="flex gap-2.5 rounded-xl bg-bad-tint p-4 text-[13px] leading-snug text-bad-text">
                <Icon name="alert" size={18} />
                <span><strong>{s.course_code}{s.session ? ` ${s.session}` : ""}{s.number ? ` Q${s.number}` : ""}</strong> has {s.top_pct}% picking {LETTERS[s.top]} against the key&apos;s {LETTERS[s.key]}. That usually means the key is wrong.</span>
              </Link>
            ))}
          </Panel>
        </div>
      </main>
    </>
  );
}
