"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import { useDownloads } from "@/lib/use-downloads";
import { currentSubscription, disablePush, enablePush, pushPermission } from "@/lib/push";
import { isIOS } from "@/lib/install";
import type { Me } from "@/lib/types";
import { AppBar, Banner, Card, Sheet } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Theme = "light" | "dark" | "system";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("iq-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(t: Theme) {
  try {
    if (t === "system") {
      localStorage.removeItem("iq-theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("iq-theme", t);
      document.documentElement.dataset.theme = t;
    }
  } catch {}
}

/** D21: Data saver and the data-used figure are for students on small bundles. */
export default function Settings() {
  const { me, signOut, setMe } = useAuth();
  const router = useRouter();
  const downloads = useDownloads();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [saver, setSaver] = useState(() => {
    try {
      return localStorage.getItem("iq-data-saver") !== "0";
    } catch {
      return true;
    }
  });
  const [nameOpen, setNameOpen] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage ?? null)).catch(() => {});
  }, []);

  if (!me) return null;
  const savedKb = Math.round((downloads.courses ?? []).reduce((s, c) => s + c.bytes, 0) / 1024);

  return (
    <>
      <AppBar title="Settings" />
      <main className="flex flex-col gap-5 px-5 pb-6">
        <Card className="flex flex-col gap-3 rounded-[18px] p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">Stored on this phone</span>
            <strong className="font-mono text-lg">{usage != null ? `${(usage / 1024 / 1024).toFixed(1)} MB` : "—"}</strong>
          </div>
          <span className="text-[11.5px] text-ink2">Downloaded papers {savedKb} KB · the app itself and cached screens make up the rest.</span>
        </Card>

        <Card className="flex flex-col rounded-[18px]">
          <div className="flex items-center gap-3 border-b border-line2 px-5 py-4">
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px]">Data saver</span>
              <span className="text-xs text-ink3">Images load only when you tap</span>
            </div>
            <Toggle on={saver} onChange={(v) => { setSaver(v); try { localStorage.setItem("iq-data-saver", v ? "1" : "0"); } catch {} }} label="Data saver" />
          </div>
          <Link href="/me/downloads" className="flex items-center gap-3 border-b border-line2 px-5 py-4">
            <span className="flex-1 text-[15px]">Downloads</span>
            <span className="text-[13px] text-ink3">{downloads.courses?.length ?? 0} course{downloads.courses?.length === 1 ? "" : "s"} · {savedKb} KB</span>
            <Icon name="chevR" size={18} color="var(--ink3)" />
          </Link>
          <div className="flex items-center gap-3 px-5 py-4">
            <span className="flex-1 text-[15px]">Appearance</span>
            <div className="flex rounded-[9px] bg-raised p-0.5" role="radiogroup" aria-label="Appearance">
              {(["light", "dark", "system"] as const).map((t) => (
                <button key={t} role="radio" aria-checked={theme === t} onClick={() => { setTheme(t); applyTheme(t); }} className={`rounded-[7px] px-2 py-1 text-xs capitalize ${theme === t ? "bg-surface font-semibold" : "text-ink2"}`}>{t}</button>
              ))}
            </div>
          </div>
        </Card>

        <NotificationsCard />
        <Card className="flex flex-col rounded-[18px]">
          <button onClick={() => setNameOpen(true)} className="flex items-center gap-3 border-b border-line2 px-5 py-4 text-left">
            <span className="flex flex-1 flex-col"><span className="text-[15px]">Your name</span><span className="text-xs text-ink3">{me.pendingDisplayName ? `“${me.pendingDisplayName}” waiting for approval` : me.displayName}</span></span>
            <Icon name="chevR" size={18} color="var(--ink3)" />
          </button>
          <button onClick={() => setCoursesOpen(true)} className="flex items-center gap-3 border-b border-line2 px-5 py-4 text-left">
            <span className="flex flex-1 flex-col"><span className="text-[15px]">Courses</span><span className="text-xs text-ink3">{me.courses.map((c) => c.code).join(", ")}</span></span>
            <Icon name="chevR" size={18} color="var(--ink3)" />
          </button>
          <button onClick={async () => { await disablePush().catch(() => {}); await signOut(); router.replace("/welcome"); }} className="flex items-center gap-3 px-5 py-4 text-left text-bad-text">
            <Icon name="logout" size={18} />
            <span className="flex-1 text-[15px]">Sign out</span>
          </button>
        </Card>
      </main>

      <NameSheet open={nameOpen} me={me} onClose={() => setNameOpen(false)} onSaved={setMe} />
      <CoursesSheet open={coursesOpen} me={me} onClose={() => setCoursesOpen(false)} onSaved={setMe} />
    </>
  );
}

/** Push on this phone, plus which kinds of message. At most one push a day. */
function NotificationsCard() {
  const { me, setMe } = useAuth();
  const [perm, setPerm] = useState(() => pushPermission());
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    currentSubscription().then((s) => setSubscribed(!!s)).catch(() => setSubscribed(false));
  }, []);
  if (!me) return null;
  const on = perm === "granted" && !!subscribed;

  async function pref(body: { notifyStreak?: boolean; notifyPapers?: boolean; notifyDaily?: boolean }) {
    setMe(await api<Me>("/me/profile", { method: "PATCH", body }));
  }

  return (
    <Card className="flex flex-col rounded-[18px]">
      <div className="flex items-center gap-3 border-b border-line2 px-5 py-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px]">Notifications on this phone</span>
          <span className="text-xs text-ink3">
            {perm === "unsupported"
              ? isIOS()
                ? "On iPhone, add IntelQA to your home screen first (Share › Add to Home Screen)."
                : "This browser can't receive notifications."
              : perm === "denied"
                ? "Blocked in your browser settings. Allow notifications for this site to turn them on."
                : "At most one a day"}
          </span>
        </div>
        {perm !== "unsupported" && perm !== "denied" && (
          <Toggle
            on={on}
            label="Notifications on this phone"
            onChange={async (v) => {
              if (busy) return;
              setBusy(true);
              try {
                if (v) {
                  const r = await enablePush();
                  setPerm(pushPermission());
                  setSubscribed(r === "on");
                } else {
                  await disablePush();
                  setSubscribed(false);
                }
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </div>
      <div className="flex items-center gap-3 border-b border-line2 px-5 py-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px]">Streak reminders</span>
          <span className="text-xs text-ink3">8:00 pm if you haven&apos;t practised</span>
        </div>
        <Toggle on={me.notify.streak} label="Streak reminders" onChange={(v) => pref({ notifyStreak: v })} />
      </div>
      <div className="flex items-center gap-3 border-b border-line2 px-5 py-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px]">Daily pop quiz</span>
          <span className="text-xs text-ink3">8:00 am when today&apos;s quiz is ready</span>
        </div>
        <Toggle on={me.notify.daily ?? true} label="Daily pop quiz" onChange={(v) => pref({ notifyDaily: v })} />
      </div>
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px]">New paper alerts</span>
          <span className="text-xs text-ink3">When a past paper goes live for your courses</span>
        </div>
        <Toggle on={me.notify.papers} label="New paper alerts" onChange={(v) => pref({ notifyPapers: v })} />
      </div>
    </Card>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-7 w-[46px] flex-none rounded-full ${on ? "bg-accent" : "bg-raised"}`}>
      <span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-card transition-[left]" style={{ left: on ? 21 : 3 }} />
    </button>
  );
}

/** D22: real names are checked; the old name stays on boards until the new one is approved. */
function NameSheet({ open, me, onClose, onSaved }: { open: boolean; me: Me; onClose: () => void; onSaved: (m: Me) => void }) {
  const [first, setFirst] = useState(me.firstName ?? "");
  const [last, setLast] = useState(me.surname ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} label="Your name">
      <strong className="font-display text-[22px]">Your name</strong>
      {me.pendingDisplayName && (
        <Banner tone="warn" icon="clock">
          <strong>“{me.pendingDisplayName}” is waiting for approval.</strong> Leaderboards show “{me.displayName}” until then, usually within a few hours.
        </Banner>
      )}
      <label className="flex flex-col gap-3"><span className="text-[13px] font-semibold">First name</span><input value={first} onChange={(e) => setFirst(e.target.value)} className="h-[54px] rounded-[14px] border-2 border-line bg-surface px-5 outline-none focus:border-accent" /></label>
      <label className="flex flex-col gap-3"><span className="text-[13px] font-semibold">Surname</span><input value={last} onChange={(e) => setLast(e.target.value)} className="h-[54px] rounded-[14px] border-2 border-line bg-surface px-5 outline-none focus:border-accent" /></label>
      <span className="text-[13px] text-ink3">You can change your name once every 30 days. A moderator checks it first.</span>
      {err && <span className="text-sm text-bad-text">{err}</span>}
      {me.pendingDisplayName ? (
        <Button full kind="outline" loading={busy} onClick={async () => { setBusy(true); onSaved(await api<Me>("/me/name-change", { method: "DELETE" })); setBusy(false); }}>Cancel the change</Button>
      ) : (
        <Button
          full
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              onSaved(await api<Me>("/me/profile", { method: "PATCH", body: { firstName: first.trim(), surname: last.trim() } }));
              onClose();
            } catch (e) {
              setErr((e as ApiError).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Request change
        </Button>
      )}
    </Sheet>
  );
}

function CoursesSheet({ open, me, onClose, onSaved }: { open: boolean; me: Me; onClose: () => void; onSaved: (m: Me) => void }) {
  const { data } = useApi<{ courses: { id: string; code: string; title: string; papers: number }[] }>(open && me.institution ? `/catalog/courses?institutionId=${me.institution.id}` : null);
  const [sel, setSel] = useState<Set<string>>(() => new Set(me.courses.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} label="Courses">
      <strong className="font-display text-[22px]">This semester&apos;s courses</strong>
      <div className="flex flex-col gap-1.5">
        {data?.courses.map((c) => {
          const on = sel.has(c.id);
          return (
            <button key={c.id} role="checkbox" aria-checked={on} onClick={() => { const s = new Set(sel); if (on) s.delete(c.id); else s.add(c.id); setSel(s); }} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ${on ? "border-2 border-accent bg-accent-tint" : "border-[1.5px] border-line"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-md ${on ? "bg-accent" : "border-2 border-line"}`}>{on && <Icon name="check" size={13} color="var(--on-accent)" weight={3} />}</span>
              <span className="flex flex-1 flex-col"><span className="font-mono text-[13px] font-bold">{c.code}</span><span className="text-xs text-ink2">{c.title}</span></span>
            </button>
          );
        })}
      </div>
      <Button full disabled={!sel.size} loading={busy} onClick={async () => { setBusy(true); onSaved(await api<Me>("/me/profile", { method: "PATCH", body: { courseIds: [...sel] } })); setBusy(false); onClose(); }}>Save {sel.size} course{sel.size === 1 ? "" : "s"}</Button>
    </Sheet>
  );
}
