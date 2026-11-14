"use client";
import Link from "next/link";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { AppBar, EmptyState } from "@/components/ui/kit";
import { Icon, type Glyph } from "@/components/ui/icon";

type Note = { id: string; kind: string; title: string; body: string; url: string | null; readAt: string | null; createdAt: string };

const GLYPH: Record<string, [Glyph, string, string]> = {
  streak: ["flame", "bg-hl-tint", "var(--ink)"],
  paper: ["file", "bg-accent-tint", "var(--accent-text)"],
  score_corrected: ["shield", "bg-ok-tint", "var(--ok-text)"],
  challenge: ["trophy", "bg-accent-tint", "var(--accent-text)"],
  rank: ["board", "bg-raised", "var(--ink2)"],
  name: ["profile", "bg-raised", "var(--ink2)"],
};

function when(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  if (days < 1) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Everything we've sent, including corrected scores (E08). Opening the list marks it read. */
export default function Notifications() {
  const { data } = useApi<{ notifications: Note[] }>("/me/notifications");
  const { refresh } = useAuth();
  const hasUnread = !!data?.notifications.some((n) => !n.readAt);
  useEffect(() => {
    if (hasUnread) api("/me/notifications/read", { method: "POST" }).then(() => refresh()).catch(() => {});
  }, [hasUnread, refresh]);

  if (data && !data.notifications.length) {
    return (
      <>
        <AppBar title="Notifications" />
        <EmptyState glyph="bell" tone="accent" title="Nothing yet">New past papers for your courses, corrected scores and friend challenges show up here.</EmptyState>
      </>
    );
  }
  return (
    <>
      <AppBar title="Notifications" />
      <main className="flex flex-col gap-3 px-5 pb-5">
        {data?.notifications.map((n) => {
          const [g, bg, fg] = GLYPH[n.kind] ?? GLYPH.name;
          const inner = (
            <>
              <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${bg}`}><Icon name={g} size={20} color={fg} /></span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex justify-between gap-2">
                  <strong className="text-sm">{n.title}</strong>
                  <span className="flex-none text-xs text-ink3">{when(n.createdAt)}</span>
                </div>
                <span className="text-[13px] leading-snug text-ink2">{n.body}</span>
              </div>
              {!n.readAt && <span className="mt-1 h-2 w-2 flex-none rounded-full bg-accent" aria-label="New" />}
            </>
          );
          const cls = "flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5";
          return n.url && n.url !== "/me/notifications" ? (
            <Link key={n.id} href={n.url} className={cls}>{inner}</Link>
          ) : (
            <div key={n.id} className={cls}>{inner}</div>
          );
        })}
      </main>
    </>
  );
}
