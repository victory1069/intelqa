"use client";
import { useEffect, useRef, useState } from "react";
import { authMessage, useAuth, type Contact } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Step = "contact" | "password" | "code";
const RESEND_SEC = 60;
const field = "h-14 w-full rounded-[14px] border-2 border-line bg-surface px-4 text-base text-ink outline-none focus:border-accent";

/** "0803 412 7781", "+234 803…" or "234803…" → +2348034127781; null if it isn't 10 digits after the code. */
function toPhone(raw: string) {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("234")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.length === 10 ? `+234${d}` : null;
}

/**
 * Sign-in for students and admins, one flow for both:
 *  1. Email (or phone).
 *  2. Accounts with a password: enter it. "Forgot password?" sends a code.
 *     New accounts: a 6-digit code (or the link in the same email).
 *  3. After a code, the app asks for a password (see PasswordGate), then opens.
 */
export function AuthForm({ titleClass = "font-display text-[30px] leading-tight font-extrabold", intro }: { titleClass?: string; intro?: string }) {
  const { lookup, sendCode, verifyCode, signInWithPassword } = useAuth();
  const [usePhone, setUsePhone] = useState(false);
  const [raw, setRaw] = useState("");
  const [step, setStep] = useState<Step>("contact");
  const [reset, setReset] = useState(false);
  const [password, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  const email = raw.trim().toLowerCase();
  const phone = toPhone(raw);
  const contact: Contact | null = usePhone ? (phone ? { phone } : null) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : null;
  const shown = usePhone ? (phone ? `+234 ${phone.slice(4, 7)} ${phone.slice(7, 10)} ${phone.slice(10)}` : raw) : email;
  const configured = typeof window === "undefined" || !!supabase();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authMessage((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const goCode = async (isReset: boolean) => {
    await sendCode(contact!);
    setReset(isReset);
    setCode("");
    setStep("code");
    setResendIn(RESEND_SEC);
    setTimeout(() => codeRef.current?.focus(), 50);
  };

  const next = () =>
    run(async () => {
      const method = await lookup(contact!);
      if (method === "password") {
        setStep("password");
        setTimeout(() => pwRef.current?.focus(), 50);
      } else await goCode(false);
    });

  const back = () => {
    setStep("contact");
    setError(null);
    setPw("");
    setCode("");
  };

  const changeLink = (
    <button type="button" className="font-semibold text-accent-text" onClick={back}>
      Change
    </button>
  );

  if (step === "password") {
    return (
      <form className="flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (password) run(() => signInWithPassword(contact!, password)); }}>
        <div className="flex flex-col gap-2">
          <h1 className={titleClass}>Welcome back</h1>
          <p className="text-[15px] leading-relaxed text-ink2">Signing in as <strong className="text-ink">{shown}</strong>. {changeLink}</p>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Password</span>
          <div className="relative">
            <input ref={pwRef} type={show ? "text" : "password"} value={password} onChange={(e) => { setPw(e.target.value); setError(null); }} autoComplete="current-password" className={`${field} pr-14`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute top-0 right-0 flex h-14 w-14 items-center justify-center text-ink3">
              <Icon name={show ? "eyeOff" : "eye"} size={20} />
            </button>
          </div>
        </label>
        {error && <span className="text-sm leading-snug text-bad-text" role="alert">{error}</span>}
        <Button full loading={busy} disabled={!password}>Sign in</Button>
        <button type="button" disabled={busy} onClick={() => run(() => goCode(true))} className="self-center text-sm font-semibold text-accent-text">
          Forgot password? Email me a code
        </button>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form className="flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (code.length >= 6) run(() => verifyCode(contact!, code, { reset })); }}>
        <div className="flex flex-col gap-2">
          <h1 className={titleClass}>{reset ? "Reset your password" : "Check your " + (usePhone ? "messages" : "email")}</h1>
          <p className="text-[15px] leading-relaxed text-ink2">
            We sent a code to <strong className="text-ink">{shown}</strong>. {changeLink}
            {!usePhone && <><br />Type the code below, or tap the link in the email.</>}
          </p>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Code</span>
          <input
            ref={codeRef}
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 10)); setError(null); }}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className={`${field} text-center font-mono text-2xl tracking-[0.35em]`}
          />
        </label>
        {error && <span className="text-sm leading-snug text-bad-text" role="alert">{error}</span>}
        <Button full loading={busy} disabled={code.length < 6}>{reset ? "Continue" : "Verify"}</Button>
        {resendIn > 0 ? (
          <span className="text-center text-sm text-ink2">Didn&apos;t get it? Check spam, or resend in <strong className="font-mono text-ink">{resendIn}s</strong></span>
        ) : (
          <button type="button" disabled={busy} onClick={() => run(() => goCode(reset))} className="self-center text-sm font-semibold text-accent-text">Send a new code</button>
        )}
      </form>
    );
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (contact) next(); }}>
      <div className="flex flex-col gap-2">
        <h1 className={titleClass}>Sign in or create an account</h1>
        <p className="text-[15px] leading-relaxed text-ink2">{intro ?? "New here? We'll email you a code, then you'll pick a password."}</p>
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">{usePhone ? "Phone number" : "Email"}</span>
        {usePhone ? (
          <input value={raw} onChange={(e) => { setRaw(e.target.value); setError(null); }} inputMode="tel" autoComplete="tel" placeholder="0803 412 7781" className={`${field} font-mono tracking-wider`} />
        ) : (
          <input value={raw} onChange={(e) => { setRaw(e.target.value); setError(null); }} type="email" autoComplete="email" autoFocus placeholder="you@students.unilorin.edu.ng" className={field} />
        )}
      </label>
      {error && <span className="text-sm leading-snug text-bad-text" role="alert">{error}</span>}
      {!configured && <span className="text-sm text-flag-text">Sign-in isn&apos;t set up yet: add your Supabase keys to .env.local.</span>}
      <Button full loading={busy} disabled={!contact || !configured}>Continue</Button>
      <button type="button" onClick={() => { setUsePhone((p) => !p); setRaw(""); setError(null); }} className="flex items-center justify-center gap-1.5 self-center text-sm font-semibold text-ink2">
        <Icon name={usePhone ? "mail" : "phone"} size={16} />
        {usePhone ? "Use email instead" : "Use a phone number instead"}
      </button>
    </form>
  );
}

/** Shown to any signed-in account without a password, before anything else in the app. */
export function PasswordGate() {
  const { me, setPassword, signOut } = useAuth();
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !me?.onboarded;
  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = again.length > 0 && again !== pw;
  const ok = pw.length >= 8 && pw === again;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setPassword(pw);
    } catch (e) {
      setError(authMessage((e as Error).message));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh w-full justify-center bg-bg">
      <form className="flex w-full max-w-[440px] flex-col gap-6 px-6 pt-16 pb-8" onSubmit={(e) => { e.preventDefault(); if (ok) save(); }}>
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-tint"><Icon name="lock" size={26} color="var(--accent-text)" /></span>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[30px] leading-tight font-extrabold">{isNew ? "Create a password" : "Set a new password"}</h1>
          <p className="text-[15px] leading-relaxed text-ink2">
            {isNew ? "You'll use it with " : "Next time, sign in with "}
            <strong className="text-ink">{me?.email ?? me?.phone ?? "your email"}</strong>
            {isNew ? " to sign in from now on." : " and this password."}
          </p>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Password</span>
          <div className="relative">
            <input type={show ? "text" : "password"} value={pw} onChange={(e) => { setPw(e.target.value); setError(null); }} autoComplete="new-password" autoFocus className={`${field} pr-14`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute top-0 right-0 flex h-14 w-14 items-center justify-center text-ink3">
              <Icon name={show ? "eyeOff" : "eye"} size={20} />
            </button>
          </div>
          <span className={`text-xs ${tooShort ? "text-bad-text" : "text-ink3"}`}>At least 8 characters.</span>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Type it again</span>
          <input type={show ? "text" : "password"} value={again} onChange={(e) => { setAgain(e.target.value); setError(null); }} autoComplete="new-password" className={field} />
          {mismatch && <span className="text-xs text-bad-text">The two passwords don&apos;t match.</span>}
        </label>
        {error && <span className="text-sm leading-snug text-bad-text" role="alert">{error}</span>}
        <Button full loading={busy} disabled={!ok}>Save password</Button>
        <button type="button" onClick={signOut} className="self-center text-sm font-semibold text-ink2">Sign out</button>
      </form>
    </div>
  );
}
