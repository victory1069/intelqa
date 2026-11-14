"use client";
import type { ReactNode } from "react";
import { useApi } from "@/lib/use-api";
import { RevealText } from "@/components/motion/reveal";

/** Page header: caps eyebrow, a big display title that rises in, actions on the right (wrapping below on phones). */
export function Header({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-none flex-wrap items-end gap-x-6 gap-y-6 px-5 pt-10 pb-4 sm:px-8 lg:px-12 lg:pt-16 lg:pb-6">
      <div className="flex min-w-0 flex-1 basis-[280px] flex-col gap-3">
        {eyebrow && <span className="caps truncate text-[13px] text-violet">{eyebrow}</span>}
        {typeof title === "string" ? (
          <RevealText as="h1" trigger="mount" className="display text-[clamp(38px,5vw,64px)] text-ink" text={title} />
        ) : (
          <h1 className="display text-[clamp(38px,5vw,64px)] text-ink">{title}</h1>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  );
}

const STATUS: Record<string, [string, string, string]> = {
  processing: ["bg-accent-tint", "text-accent-text", "PROCESSING"],
  in_review: ["bg-flag-tint", "text-flag-text", "IN REVIEW"],
  published: ["bg-ok-tint", "text-ok-text", "PUBLISHED"],
  failed: ["bg-bad-tint", "text-bad-text", "FAILED"],
  live: ["bg-ok-tint", "text-ok-text", "LIVE"],
  hidden: ["bg-bad-tint", "text-bad-text", "HIDDEN"],
  unverified: ["bg-flag-tint", "text-flag-text", "UNVERIFIED"],
  draft: ["bg-raised", "text-ink2", "DRAFT"],
  closed: ["bg-raised", "text-ink3", "CLOSED"],
  approved: ["bg-ok-tint", "text-ok-text", "APPROVED"],
  flagged: ["bg-flag-tint", "text-flag-text", "FLAGGED"],
  unreviewed: ["bg-raised", "text-ink2", "TO REVIEW"],
};

export function Status({ s, children }: { s: string; children?: ReactNode }) {
  const [bg, fg, label] = STATUS[s] ?? ["bg-raised", "text-ink2", s.toUpperCase()];
  return <span className={`inline-block rounded-md px-2 py-1 font-mono text-[11px] font-bold whitespace-nowrap ${bg} ${fg}`}>{children ?? label}</span>;
}

export type AdminCourse = { id: string; code: string; title: string; status: string; optionCount: number; negativeMark: number; institution: string; topics: number };

export function useMyCourses() {
  return useApi<{ courses: AdminCourse[] }>("/admin/my-courses");
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2.5">
      <span className="text-[14px] font-semibold">{label}</span>
      {children}
      {error ? <span className="text-xs text-bad-text">{error}</span> : hint ? <span className="text-xs text-ink3">{hint}</span> : null}
    </label>
  );
}

export const inputCls = "h-12 rounded-[10px] border-[1.5px] border-line bg-surface px-4 text-[15px] outline-none focus:border-accent";
export const areaCls = "rounded-xl border-[1.5px] border-line bg-surface p-4 text-[15px] leading-relaxed outline-none focus:border-accent";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[18px] border border-line bg-surface ${className}`}>{children}</div>;
}

export function ago(iso: string | Date) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 172800) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
