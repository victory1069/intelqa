"use client";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./ui/icon";
import { Button } from "./ui/button";
import { AuthProvider, useAuth } from "@/lib/auth";
import { syncAll } from "@/lib/sync";
import { runQueuedDownloads } from "@/lib/start";
import { api } from "@/lib/api";
import { odb } from "@/lib/offline";
import { takeInvite } from "@/lib/invite";
import { useToast } from "./ui/kit";
import { PasswordGate } from "./auth-form";

/**
 * Registers the service worker (production, or NEXT_PUBLIC_SW_DEV=1 for testing) and shows
 * E09 when a new version is waiting. Never during an exam: it waits until the student is out.
 */
function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const path = usePathname();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW_DEV !== "1") return;
    let reg: ServiceWorkerRegistration | undefined;
    const watch = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const w = r.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w);
        });
      });
    };
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((r) => {
        reg = r;
        watch(r);
      })
      .catch(() => {});
    let reloading = false;
    const onChange = () => {
      if (!reloading) {
        reloading = true;
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    const check = () => document.visibilityState === "visible" && reg?.update().catch(() => {});
    document.addEventListener("visibilitychange", check);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const busy = /^\/(session|play|ask)/.test(path);
  if (!waiting || busy) return null;
  return (
    <div className="fixed inset-x-0 bottom-24 z-30 flex justify-center px-3.5" role="status">
      <div className="flex w-full max-w-[452px] items-center gap-3 rounded-[18px] border border-line bg-surface p-3.5 shadow-card">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent-tint"><Icon name="sparkle" size={20} color="var(--accent-text)" /></span>
        <div className="flex flex-1 flex-col gap-0.5">
          <strong className="text-sm">New version ready</strong>
          <span className="text-xs text-ink2">Your answers and downloads are kept.</span>
        </div>
        <Button size="sm" onClick={() => waiting.postMessage("skip-waiting")}>Reload</Button>
      </div>
    </div>
  );
}

/** Sends saved answers and offline results whenever the phone comes back online. */
function SyncWatcher() {
  const { status } = useAuth();
  const toast = useToast();
  useEffect(() => {
    if (status !== "signedIn") return;
    // Weekly department XP rank: offline results never move course boards, but their XP moves this one.
    const deptRank = () => api<{ me: { rank: number } | null }>("/leaderboard?board=department&period=week").then((b) => b.me?.rank ?? null, () => null);
    const run = async () => {
      const waiting = await odb().offlineAttempts.filter((a) => !!a.submittedAt && !a.synced).count().catch(() => 0);
      const before = waiting ? await deptRank() : null;
      const r = await syncAll();
      if (r.synced) {
        const after = before != null ? await deptRank() : null;
        const moved = before != null && after != null ? before - after : 0;
        // E07
        toast.show(
          `${r.synced} result${r.synced === 1 ? "" : "s"} synced · +${r.xp} XP`,
          moved > 0 ? `You moved up ${moved} place${moved === 1 ? "" : "s"} on your department's weekly board.` : "Your ranks have been updated.",
          { label: "View", href: "/ranks" },
        );
      }
      // E05: courses the student asked to save "when online".
      await runQueuedDownloads().catch(() => 0);
    };
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  return toast.node;
}

/** Adds the friend whose invite link brought this student in, once setup is done. */
function InviteClaimer() {
  const { me } = useAuth();
  useEffect(() => {
    if (!me?.onboarded) return;
    const code = takeInvite();
    if (code && code !== me.inviteCode) api("/me/friends", { method: "POST", body: { inviteCode: code } }).catch(() => {});
  }, [me]);
  return null;
}

/** Any signed-in account without a password sets one before using the app (new accounts, resets, email-link sign-ins). */
function NeedsPassword({ children }: { children: ReactNode }) {
  const { status, me } = useAuth();
  if (status === "signedIn" && me?.passwordSet === false) return <PasswordGate />;
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <NeedsPassword>{children}</NeedsPassword>
      <Suspense fallback={null}>
        <ServiceWorker />
      </Suspense>
      <SyncWatcher />
      <InviteClaimer />
    </AuthProvider>
  );
}
