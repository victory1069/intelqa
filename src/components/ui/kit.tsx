"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type Glyph } from "./icon";
import { Menu } from "@/components/motion/landing";

/** Phone-width column, centred on larger screens. `wide` opens up to a reading column on desktop. */
export function Screen({ children, className = "", bg, wide }: { children: ReactNode; className?: string; bg?: string; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh w-full justify-center" style={bg ? { background: bg } : undefined}>
      <div className={`relative flex min-h-dvh w-full flex-col ${wide ? "max-w-[520px] lg:max-w-[780px] lg:px-4 lg:pb-16" : "max-w-[480px] md:max-w-[560px]"} ${className}`} style={{ paddingTop: "env(safe-area-inset-top)" }}>
        {children}
      </div>
    </div>
  );
}

/** Top bar from AppBar.dc.html. */
export function AppBar({
  title,
  sub,
  lead = "back",
  onLead,
  border,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  lead?: "back" | "close" | "none";
  onLead?: () => void;
  border?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  return (
    <header className={`flex h-14 flex-none items-center gap-1 px-2 ${border ? "border-b border-line" : ""}`}>
      {lead !== "none" && (
        <button
          type="button"
          aria-label={lead === "close" ? "Close" : "Back"}
          onClick={onLead ?? (() => (window.history.length > 1 ? router.back() : router.push("/home")))}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-ink"
        >
          <Icon name={lead === "close" ? "close" : "back"} size={22} />
        </button>
      )}
      <div className={`flex min-w-0 flex-1 flex-col gap-px ${lead === "none" ? "pl-3" : ""}`}>
        {title && <span className="display truncate pt-0.5 text-[26px] text-ink">{title}</span>}
        {sub && <span className="caps truncate text-[12px] text-ink3">{sub}</span>}
      </div>
      <div className="flex flex-none items-center gap-1 pr-1">{children}</div>
    </header>
  );
}

const TABS: { href: string; name: string; glyph: Glyph; match: RegExp }[] = [
  { href: "/home", name: "Home", glyph: "home", match: /^\/(home|daily)/ },
  { href: "/practise", name: "Practise", glyph: "play", match: /^\/(practise|course|quiz)/ },
  { href: "/ranks", name: "Ranks", glyph: "board", match: /^\/ranks/ },
  { href: "/me", name: "Me", glyph: "profile", match: /^\/me/ },
];

/** Bottom tabs on phones: a floating night bar; the active tab lights up in highlighter. Hidden on desktop. */
export function TabBar() {
  const path = usePathname();
  return (
    <div className="sticky bottom-0 z-10 flex-none px-3 pt-2 lg:hidden" style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}>
      <nav aria-label="Main" className="flex h-[64px] items-center justify-around rounded-[14px] bg-night px-1.5 text-paper shadow-card">
        {TABS.map((t) => {
          const on = t.match.test(path);
          return (
            <Link key={t.href} href={t.href} className="flex min-w-16 flex-col items-center gap-1" aria-current={on ? "page" : undefined}>
              <span className={`flex h-[30px] w-14 items-center justify-center rounded-full transition-colors ${on ? "bg-highlighter" : ""}`}>
                <Icon name={t.glyph} size={21} color={on ? "#170F33" : "rgba(243,236,223,0.7)"} />
              </span>
              <span className="caps text-[12px]" style={{ color: on ? "#FFD43B" : "rgba(243,236,223,0.7)" }}>
                {t.name}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Desktop navigation for the student app: a slim bar with the logo and a burger that opens the
 * full-screen menu, so the page itself has room to breathe. Phones use the bottom tab bar instead.
 */
export function TopNav() {
  const path = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const current = TABS.find((t) => t.match.test(path));
  return (
    <>
      <div className="sticky top-0 z-30 hidden border-b border-line/70 bg-bg/90 backdrop-blur lg:block">
        <div className="mx-auto flex h-[76px] max-w-[1200px] items-center gap-5 px-12">
          <Link href="/home" className="caps flex items-center gap-2.5 text-[22px]">
            <svg viewBox="0 0 100 100" width={30} height={30} aria-hidden><path d="M47 9a38 38 0 1 0 0.01 0zM47 26a21 21 0 1 1 -0.01 0z" fill="currentColor" fillRule="evenodd" /><rect x="61.3" y="66.3" width="28" height="18" rx="3" transform="rotate(45 75.3 75.3)" fill="currentColor" /><circle cx="47" cy="47" r="10" fill="#FFD43B" /></svg>
            IntelQA
          </Link>
          {current && <span className="caps border-l border-line pl-5 text-[15px] text-ink3">{current.name}</span>}
          <span className="flex-1" />
          <button onClick={() => setOpenOn(path)} aria-label="Open menu" aria-expanded={openOn === path} className="caps flex h-12 items-center gap-3 rounded-full bg-night pr-5 pl-4 text-[16px] text-paper">
            <span className="flex flex-col gap-[5px]" aria-hidden>
              <span className="h-[2.5px] w-5 rounded-full bg-paper" />
              <span className="h-[2.5px] w-5 rounded-full bg-paper" />
            </span>
            Menu
          </button>
        </div>
      </div>
      {openOn === path && <Menu links={TABS.map((t) => ({ label: t.name, href: t.href }))} active={current?.href} onClose={() => setOpenOn(null)} />}
    </>
  );
}

/** Bottom sheet over a scrim. */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-scrim" onClick={onClose} role="presentation">
      <div className="flex w-full max-w-[480px] flex-col justify-end">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="sheet-in flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-surface px-[22px] pt-2.5 pb-7"
          style={{ paddingBottom: "calc(28px + env(safe-area-inset-bottom))" }}
        >
          <span className="h-1 w-10 flex-none self-center rounded-full bg-line" />
          {children}
        </div>
      </div>
    </div>
  );
}

/** Centred dialog over a scrim. */
export function Dialog({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim p-6" onClick={onClose} role="presentation">
      <div role="alertdialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()} className="flex w-full max-w-[420px] flex-col gap-3.5 rounded-3xl bg-surface p-[22px]">
        {children}
      </div>
    </div>
  );
}

const BANNER = {
  info: "bg-raised text-ink2",
  warn: "bg-flag-tint text-flag-text",
  bad: "bg-bad-tint text-bad-text",
  ok: "bg-ok-tint text-ok-text",
  accent: "bg-accent-tint text-accent-text",
} as const;

export function Banner({ tone = "info", icon, children, action }: { tone?: keyof typeof BANNER; icon?: Glyph; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`flex items-center gap-3.5 rounded-[14px] px-5 py-4 text-[14px] leading-relaxed ${BANNER[tone]}`} role="status">
      {icon && <Icon name={icon} size={18} />}
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

/** Empty / error states: icon tile, title, explanation. */
export function EmptyState({ glyph, tone = "raised", title, children }: { glyph: Glyph; tone?: "raised" | "ok" | "bad" | "flag" | "accent" | "hl"; title: string; children?: ReactNode }) {
  const tile = { raised: ["bg-raised", "var(--ink2)"], ok: ["bg-ok-tint", "var(--ok-text)"], bad: ["bg-bad-tint", "var(--bad-text)"], flag: ["bg-flag-tint", "var(--flag-text)"], accent: ["bg-accent-tint", "var(--accent-text)"], hl: ["bg-hl-tint", "var(--ink)"] }[tone];
  return (
    <div className="flex flex-col items-center gap-3.5 px-7 pt-14 text-center">
      <span className={`flex h-[76px] w-[76px] items-center justify-center rounded-3xl ${tile[0]}`}>
        <Icon name={glyph} size={36} color={tile[1]} />
      </span>
      <strong className="font-display text-2xl leading-tight font-extrabold">{title}</strong>
      {children && <p className="text-[15px] leading-relaxed text-ink2" style={{ textWrap: "pretty" }}>{children}</p>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] border border-line bg-surface ${className}`}>{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block rounded-md bg-raised ${className}`} />;
}

export function Bar({ pct, color = "var(--accent)", height = 6, track = "var(--raised)" }: { pct: number; color?: string; height?: number; track?: string }) {
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: track }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

/** XP and streak counters from the guide's "chips & counters". */
export function XpChip({ xp }: { xp: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-highlighter py-1.5 pr-3 pl-2.5 font-mono text-[13px] font-bold text-exam-ink">
      <Icon name="bolt" size={15} color="#15132B" fill="#15132B" weight={1.5} />
      {xp.toLocaleString()}
    </span>
  );
}

export function StreakChip({ days }: { days: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-chip py-1.5 pr-3 pl-2.5 font-mono text-[13px] font-bold text-on-chip">
      <Icon name="flame" size={15} color="#FFD43B" fill="#FFD43B" weight={1.5} />
      {days}
    </span>
  );
}

export function Pill({ on, children, onClick, tone }: { on?: boolean; children: ReactNode; onClick?: () => void; tone?: "flag" }) {
  const base = "whitespace-nowrap rounded-full px-3 py-2 text-[13px]";
  const cls = on ? "bg-chip text-on-chip font-semibold" : tone === "flag" ? "border-[1.5px] border-flag bg-flag-tint text-flag-text" : "border-[1.5px] border-line";
  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`} aria-pressed={on}>
      {children}
    </button>
  );
}

/** Short-lived message at the bottom of the screen. */
export function useToast() {
  const [msg, setMsg] = useState<{ title: string; body?: string; action?: { label: string; href: string } } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-3.5" role="status">
      <div className="flex w-full max-w-[452px] items-start gap-3 rounded-2xl bg-chip p-3.5 text-on-chip shadow-card">
        <Icon name="check" size={20} color="#FFD43B" weight={2.6} />
        <div className="flex flex-1 flex-col gap-0.5">
          <strong className="text-sm">{msg.title}</strong>
          {msg.body && <span className="text-[13px] leading-snug opacity-85">{msg.body}</span>}
        </div>
        {msg.action && (
          <Link href={msg.action.href} onClick={() => setMsg(null)} className="self-center px-1 text-sm font-bold text-highlighter">{msg.action.label}</Link>
        )}
      </div>
    </div>
  ) : null;
  return { show: (title: string, body?: string, action?: { label: string; href: string }) => setMsg({ title, body, action }), node };
}

export function initials(name: string | null | undefined) {
  return (name ?? "?").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const AV = ["#FFD43B", "#C9BEFF", "#A7E3C1", "#FFC9A3", "#BFE3FF", "#F5B8C8", "#E3E0D6"];
export function Avatar({ name, size = 28, me }: { name: string; size?: number; me?: boolean }) {
  const i = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AV.length;
  return (
    <span
      className="flex flex-none items-center justify-center rounded-full font-bold text-exam-ink"
      style={{ width: size, height: size, fontSize: size * 0.38, background: me ? "#FFD43B" : AV[i] }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function fmtClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
