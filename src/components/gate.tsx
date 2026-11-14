"use client";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { setNext } from "@/lib/next-url";
import { Logo, Mark } from "./ui/logo";
import { EmptyState } from "./ui/kit";
import { Button, ButtonLink } from "./ui/button";

/** A01: shown while the app shell loads. Uses the manifest's violet. */
export function Splash() {
  return (
    <div className="grain flex min-h-dvh flex-col items-center justify-between bg-night pb-10 text-paper">
      <div />
      <div className="iq-loader-logo flex flex-col items-center gap-7">
        <Mark size={84} variant="violet" />
        <Logo size={34} variant="violet" />
      </div>
      <div className="flex flex-col items-center gap-3">
        <div className="h-[3px] w-[120px] overflow-hidden rounded-full bg-white/15">
          <div className="h-full w-[45%] animate-pulse bg-highlighter" />
        </div>
        <span className="statement text-lg italic opacity-80">Sit the exam before the exam.</span>
      </div>
    </div>
  );
}

/**
 * Wraps signed-in screens. Signed-out students go to Welcome; students who haven't
 * finished setup go to Setup; admin pages need an admin role.
 */
export function Gate({ children, need = "student" }: { children: ReactNode; need?: "student" | "admin" | "super" | "any" }) {
  const { status, me, suspended, signOut, expired } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signedOut") {
      if (need === "admin" || need === "super") {
        setNext(window.location.pathname + window.location.search);
        router.replace("/admin/sign-in");
      } else if (expired) {
        setNext(window.location.pathname + window.location.search);
        router.replace("/sign-in");
      } else router.replace("/welcome");
    }
    else if (status === "signedIn" && me && !me.onboarded && need === "student") router.replace("/setup");
  }, [status, me, need, router, expired]);

  // E14
  if (suspended) {
    const ref = suspended.match(/\[ref:([A-Z0-9-]+)\]/)?.[1] ?? null;
    const reason = suspended.replace(/\[ref:[^\]]*\]/, "").replace(/^This account is suspended\.?\s*/i, "").trim();
    const mail = `mailto:support@intelqa.app?subject=${encodeURIComponent(`Suspended account${ref ? ` ${ref}` : ""}`)}`;
    return (
      <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-between pb-6">
        <div className="flex flex-col items-center">
          <EmptyState glyph="ban" tone="bad" title="This account is suspended">
            {reason || "It broke our rules."} If you think this is a mistake, write to us and a person will reply within 3 days.
          </EmptyState>
          {ref && <span className="font-mono text-xs tracking-wide text-ink3">Ref · {ref}</span>}
        </div>
        <div className="flex flex-col gap-2 px-5">
          <ButtonLink href={mail} full icon="mail">Email support</ButtonLink>
          <Button kind="ghost" full onClick={signOut}>Sign out</Button>
        </div>
      </div>
    );
  }
  if (status !== "signedIn" || !me) return need === "student" ? <Splash /> : null;
  if (need === "student" && !me.onboarded) return <Splash />;
  // G07 (super-only pages) and the student-in-admin case
  if ((need === "admin" && me.role === "student") || (need === "super" && me.role !== "super_admin")) {
    const sup = need === "super";
    return (
      <div className="flex min-h-[70dvh] items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-2">
          <EmptyState glyph="lock" title={sup ? "Only super admins can see this" : "Admins only"}>
            {sup
              ? "This is limited to the core team. If you've spotted something unfair, send it to a super admin and it'll be looked at today."
              : "This area is for course reps, tutors and the core team. Ask a super admin to invite you."}
          </EmptyState>
          <div className="flex gap-2.5">
            {sup ? (
              <>
                <ButtonLink href="/admin" kind="outline" size="md">Back to dashboard</ButtonLink>
                <ButtonLink href="mailto:support@intelqa.app?subject=For%20a%20super%20admin" size="md" icon="mail">Message a super admin</ButtonLink>
              </>
            ) : (
              <>
                <ButtonLink href="/home" kind="outline" size="md">Go to the app</ButtonLink>
                <Button size="md" kind="ghost" onClick={signOut}>Sign out</Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
