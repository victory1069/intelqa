"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { usePendingSync } from "@/lib/use-downloads";
import { Bar, Card } from "@/components/ui/kit";
import { Icon, type Glyph } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";

/** D13: who you are, your level, and the numbers that matter. */
export default function Me() {
  const { me, refresh } = useAuth();
  const pending = usePendingSync();
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (!me) return null;
  const lvl = me.xp.level;
  const earned = me.badges.filter((b) => b.earned);
  const preview = [...earned, ...me.badges.filter((b) => !b.earned)].slice(0, 5);
  const span = lvl.next ? lvl.next.xp - lvl.xp : 1;

  return (
    <>
      <div className="flex justify-end px-3 pt-2">
        <Link href="/me/settings" aria-label="Settings" className="flex h-11 w-11 items-center justify-center"><Icon name="settings" size={22} /></Link>
      </div>
      <main className="flex flex-col gap-5 px-5 pb-5">
        <div className="flex items-center gap-3.5">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-highlighter font-display text-2xl font-extrabold text-exam-ink">{me.initials}</span>
          <div className="flex flex-col gap-0.5">
            <strong className="font-display text-2xl">{me.displayName}</strong>
            <span className="text-[13px] text-ink2">{[me.department?.name, me.level ? `${me.level}L` : null, me.institution?.shortCode].filter(Boolean).join(" · ")}</span>
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-[20px] bg-chip p-6 text-on-chip">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-xs font-bold text-highlighter">LEVEL {lvl.n}</span>
            <span className="font-mono text-xs">{me.xp.total.toLocaleString()}{lvl.next ? ` / ${lvl.next.xp.toLocaleString()}` : ""} XP</span>
          </div>
          <strong className="font-display text-[26px]">{lvl.name}</strong>
          <Bar pct={lvl.next ? ((me.xp.total - lvl.xp) / span) * 100 : 100} color="#FFD43B" track="rgba(255,255,255,0.18)" height={8} />
          {lvl.next && <span className="text-[13px] opacity-85">{lvl.toNext.toLocaleString()} XP to {lvl.next.name}</span>}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            [String(me.streak.current), "day streak", "/me/streak"],
            [me.streak.questionsAnswered.toLocaleString(), "answered", null],
            [me.streak.accuracy != null ? `${me.streak.accuracy}%` : "—", "accuracy", null],
          ].map(([v, l, href]) => {
            const inner = (
              <>
                <strong className="font-display text-[22px]">{v}</strong>
                <span className="text-xs text-ink2">{l}</span>
              </>
            );
            return href ? (
              <Link key={l} href={href} className="flex flex-col gap-0.5 rounded-2xl border border-line bg-surface p-4">{inner}</Link>
            ) : (
              <div key={l} className="flex flex-col gap-0.5 rounded-2xl border border-line bg-surface p-4">{inner}</div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="label">Badges · {earned.length} of {me.badges.length}</span>
          <Link href="/me/badges" className="text-[13px] font-semibold text-accent-text">See all</Link>
        </div>
        <div className="flex gap-2.5">
          {preview.map((b, i) => (
            <span key={b.key} title={b.name} className={`flex h-[54px] w-[54px] items-center justify-center rounded-full ${b.earned ? (i % 2 ? "bg-accent" : "bg-highlighter") : "bg-raised opacity-50"}`}>
              <Icon name={b.glyph} size={24} color={b.earned ? (i % 2 ? "var(--on-accent)" : "#15132B") : "var(--ink3)"} />
            </span>
          ))}
        </div>

        <Card className="flex flex-col rounded-[18px]">
          <MenuRow href="/me/week" glyph="share" label="Your week card" />
          <MenuRow href="/me/notifications" glyph="bell" label="Notifications" value={me?.unread ? String(me.unread) : undefined} />
          <MenuRow href="/me/bookmarks" glyph="bookmark" label="Bookmarks" />
          <MenuRow href="/me/downloads" glyph="download" label="Downloads" />
          {pending.length > 0 && <MenuRow href="/me/sync" glyph="cloud" label="Waiting to sync" value={String(pending.length)} />}
          <MenuRow href="/me/settings" glyph="settings" label="Settings" last />
        </Card>
        {me.role !== "student" && <ButtonLink href="/admin" kind="outline" icon="layers" full>Open admin dashboard</ButtonLink>}
      </main>
    </>
  );
}

function MenuRow({ href, glyph, label, value, last }: { href: string; glyph: Glyph; label: string; value?: string; last?: boolean }) {
  return (
    <Link href={href} className={`flex items-center gap-3 px-5 py-5 ${last ? "" : "border-b border-line2"}`}>
      <Icon name={glyph} size={20} />
      <span className="flex-1 text-[15px]">{label}</span>
      {value && <span className="text-[13px] text-ink3">{value}</span>}
      <Icon name="chevR" size={18} color="var(--ink3)" />
    </Link>
  );
}
