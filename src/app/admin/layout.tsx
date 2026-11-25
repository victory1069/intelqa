"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { Gate } from "@/components/gate";
import { Logo } from "@/components/ui/logo";
import { Icon, type Glyph } from "@/components/ui/icon";

type Dash = { waiting: { inReview: number; failed: number; reports: number } };

const NAV: { href: string; name: string; glyph: Glyph; match: RegExp; badge?: (d: Dash) => number; bad?: boolean; superOnly?: boolean }[] = [
  { href: "/admin", name: "Dashboard", glyph: "chart", match: /^\/admin$/ },
  { href: "/admin/uploads", name: "Uploads", glyph: "upload", match: /^\/admin\/uploads/, badge: (d) => d.waiting.failed, bad: true },
  { href: "/admin/uploads?status=in_review", name: "Review queue", glyph: "layers", match: /^\/admin\/review/, badge: (d) => d.waiting.inReview },
  { href: "/admin/bank", name: "Question bank", glyph: "book", match: /^\/admin\/bank/ },
  { href: "/admin/quizzes", name: "Quizzes", glyph: "timer", match: /^\/admin\/quizzes/ },
  { href: "/admin/reports", name: "Reports", glyph: "inbox", match: /^\/admin\/reports/, badge: (d) => d.waiting.reports, bad: true },
  { href: "/admin/analytics", name: "Analytics", glyph: "pie", match: /^\/admin\/analytics/ },
  { href: "/admin/catalogue", name: "Catalogue", glyph: "building", match: /^\/admin\/catalogue/, superOnly: true },
  { href: "/admin/admins", name: "Admins", glyph: "users", match: /^\/admin\/admins/, superOnly: true },
  { href: "/admin/moderation", name: "Moderation", glyph: "shield", match: /^\/admin\/moderation/, superOnly: true },
];

/** Admin shell: a slim top bar with a burger at every size; the menu slides out over the page. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  // The sign-in page sits under /admin but must be reachable signed out.
  const path = usePathname();
  if (path === "/admin/sign-in") return <>{children}</>;
  return (
    <Gate need="admin">
      <Shell>{children}</Shell>
    </Gate>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { me, signOut } = useAuth();
  const path = usePathname();
  const { data } = useApi<Dash>("/admin/dashboard");
  // The phone menu remembers the path it was opened on, so it closes itself on navigation.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const menuOpen = openOn === path;
  const sup = me?.role === "super_admin";
  const items = NAV.filter((n) => !n.superOnly || sup);

  const close = () => setOpenOn(null);
  const current = items.find((n) => n.match.test(path));

  const nav = items.map((n, i) => {
    const on = n.match.test(path);
    const count = data && n.badge ? n.badge(data) : 0;
    return (
      <div key={n.href}>
        {n.superOnly && !items[i - 1]?.superOnly && <span className="caps block px-4 pt-8 pb-3 text-[12px] text-paper/50">Super admin</span>}
        <Link
          href={n.href}
          onClick={close}
          aria-current={on ? "page" : undefined}
          className={`flex h-14 items-center gap-4 rounded-[10px] px-4 transition-colors ${on ? "bg-highlighter text-exam-ink" : "text-paper/75 hover:bg-white/5 hover:text-paper"}`}
        >
          <Icon name={n.glyph} size={20} />
          <span className="caps flex-1 text-[19px]">{n.name}</span>
          {count > 0 && (
            <span className={`rounded-full px-2 py-0.5 font-mono text-[12px] font-bold ${n.bad ? "bg-bad text-white" : on ? "bg-exam-ink text-paper" : "bg-white/15 text-paper"}`}>{count}</span>
          )}
        </Link>
      </div>
    );
  });

  // Anything waiting (failed uploads, papers to review, reports) shows as a dot on the burger.
  const waiting = data ? data.waiting.failed + data.waiting.inReview + data.waiting.reports : 0;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      {/* One slim bar at every size; the menu lives behind the burger so pages get the whole width. */}
      <div className="sticky top-0 z-30 border-b border-line/70 bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-[72px] w-full max-w-[1360px] items-center gap-4 px-5 sm:px-8 lg:px-12">
          <button
            onClick={() => setOpenOn(path)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="relative -ml-2 flex h-12 w-12 flex-col items-center justify-center gap-[6px] rounded-full hover:bg-raised"
          >
            <span className="h-[2.5px] w-6 rounded-full bg-ink" />
            <span className="h-[2.5px] w-6 rounded-full bg-ink" />
            {waiting > 0 && <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full border-2 border-bg bg-bad" />}
          </button>
          <Link href="/admin" className="flex items-center gap-2.5">
            <Logo size={22} tag={false} />
            <span className="caps rounded-[4px] bg-highlighter px-1.5 py-0.5 text-[11px] text-exam-ink">Admin</span>
          </Link>
          {current && <span className="caps ml-2 hidden truncate border-l border-line pl-5 text-[15px] text-ink3 md:block">{current.name}</span>}
          <span className="flex-1" />
          <span className="hidden h-10 w-10 items-center justify-center rounded-full bg-night text-[13px] font-bold text-paper sm:flex" title={me?.displayName ?? undefined}>{me?.initials}</span>
        </div>
      </div>

      {menuOpen && <Drawer onClose={close}>
        <div className="flex items-center justify-between px-2 pb-8">
          <Logo size={22} tag={false} variant="violet" />
          <button onClick={close} aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 hover:bg-white/10">
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav aria-label="Admin" className="flex flex-col gap-1.5">{nav}</nav>
        <div className="mt-auto flex items-center gap-3 border-t border-white/10 px-2 pt-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-highlighter text-[14px] font-bold text-exam-ink">{me?.initials}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[14px] font-semibold">{me?.displayName ?? me?.email ?? me?.phone}</span>
            <span className="caps text-[12px] text-paper/60">{sup ? "Super admin" : "Content admin"}</span>
          </div>
          <button onClick={signOut} aria-label="Sign out" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </Drawer>}

      <div key={path} className="page-in mx-auto flex w-full max-w-[1360px] min-w-0 flex-1 flex-col pb-16">{children}</div>
    </div>
  );
}

/** Slide-out menu over a scrim; Escape or a tap outside closes it. */
function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal aria-label="Admin menu">
      <div className="grain side-in-left flex w-[88%] max-w-[380px] flex-col bg-night px-5 pt-6 pb-8 text-paper">{children}</div>
      <button className="flex-1 bg-scrim" aria-label="Close menu" onClick={onClose} />
    </div>
  );
}
