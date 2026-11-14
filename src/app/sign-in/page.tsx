"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { takeNext } from "@/lib/next-url";
import { DEV_AUTH, supabase } from "@/lib/supabase";
import { AppBar, Banner, Screen, EmptyState, fmtClock } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const DEV_USERS = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Aisha Bello", role: "Student · CS 100L" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Kunle Adebayo", role: "Content admin · GST 111/112" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Tochukwu B.", role: "Super admin" },
];
const MAX_TRIES = 5;
const RESEND_SEC = 60;

type Step = "contact" | "code" | "locked";

export default function SignIn() {
  const { status, me, sendCode, verifyCode, devSignIn, expired } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>("contact");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [resendIn, setResendIn] = useState(RESEND_SEC);
  const [lockLeft, setLockLeft] = useState(600);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "signedIn" && me) router.replace(!me.onboarded ? "/setup" : takeNext(me.role !== "student" ? "/admin" : "/home"));
  }, [status, me, router]);

  useEffect(() => {
    if (step !== "code" && step !== "locked") return;
    const t = setInterval(() => {
      setResendIn((s) => Math.max(0, s - 1));
      setLockLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [step]);

  const digits = phone.replace(/\D/g, "");
  const phoneError = digits.startsWith("0")
    ? "Drop the first 0 and enter the 10 digits after +234, for example 803 412 7781."
    : digits.length > 10
      ? "That's too many digits. Enter the 10 digits after +234."
      : null;
  const phoneOk = digits.length === 10 && !phoneError;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const contact = mode === "phone" ? { phone: `+234${digits}` } : { email: email.trim().toLowerCase() };
  const shown = mode === "phone" ? `+234 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : email.trim();

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await sendCode(contact);
      setStep("code");
      setCode("");
      setResendIn(RESEND_SEC);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) {
      const msg = (e as Error).message;
      if (/rate|too many|security purposes/i.test(msg)) {
        setStep("locked");
        setLockLeft(600);
      } else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(contact, value);
    } catch {
      const used = tries + 1;
      setTries(used);
      setCode("");
      if (used >= MAX_TRIES) {
        setStep("locked");
        setLockLeft(600);
      } else setError(`That code doesn't match. ${MAX_TRIES - used} ${MAX_TRIES - used === 1 ? "try" : "tries"} left.`);
    } finally {
      setBusy(false);
    }
  }

  if (step === "locked") {
    return (
      <Screen>
        <AppBar onLead={() => setStep("contact")} />
        <div className="flex-1">
          <EmptyState glyph="clock" tone="flag" title="Too many tries">
            For your security, codes to this {mode === "phone" ? "number" : "address"} are paused for <strong className="text-ink">10 minutes</strong>.
            {mode === "phone" && " You can sign in with email right now."}
          </EmptyState>
          <p className="mt-4 text-center font-mono text-[28px] font-bold">{fmtClock(lockLeft)}</p>
        </div>
        <div className="flex flex-col gap-2 px-[22px] pb-5">
          {mode === "phone" && <Button full icon="mail" onClick={() => { setMode("email"); setStep("contact"); setTries(0); }}>Use email instead</Button>}
          <a href="mailto:support@intelqa.app" className="flex h-[52px] items-center justify-center font-semibold text-accent-text">Contact support</a>
        </div>
      </Screen>
    );
  }

  if (step === "code") {
    return (
      <Screen>
        <AppBar onLead={() => setStep("contact")} />
        <div className="flex flex-1 flex-col gap-6 px-[22px] pt-1">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-[30px] leading-tight font-extrabold">Enter the code</h1>
            <p className="text-[15px] leading-relaxed text-ink2">
              Sent to <strong className="text-ink">{shown}</strong>.{" "}
              <button className="font-semibold text-accent-text" onClick={() => setStep("contact")}>Change</button>
            </p>
          </div>
          <label className="relative flex gap-2" onClick={() => codeRef.current?.focus()}>
            <span className="sr-only">6-digit code</span>
            <input
              ref={codeRef}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                setError(null);
                if (v.length === 6) verify(v);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="absolute inset-0 opacity-0"
              aria-invalid={!!error}
            />
            {Array.from({ length: 6 }, (_, i) => {
              const active = i === code.length && !busy;
              const bad = !!error && !code;
              return (
                <span
                  key={i}
                  className={`flex h-[60px] flex-1 items-center justify-center rounded-[14px] font-mono text-2xl font-bold ${
                    bad ? "border-2 border-bad bg-bad-tint" : active ? "border-2 border-accent bg-surface" : "border-[1.5px] border-line bg-surface"
                  }`}
                >
                  {code[i] ?? (active ? <span className="h-[26px] w-0.5 animate-pulse bg-accent" /> : "")}
                </span>
              );
            })}
          </label>
          {error && (
            <span className="flex items-start gap-1.5 text-sm leading-snug text-bad-text" role="alert">
              <Icon name="alert" size={17} />
              {error}
            </span>
          )}
          {resendIn > 0 ? (
            <span className="text-sm text-ink2">
              Didn&apos;t get it? Resend in <strong className="font-mono text-ink">{fmtClock(resendIn)}</strong>
            </span>
          ) : (
            <button className="self-start text-sm font-semibold text-accent-text" onClick={send} disabled={busy}>Resend code</button>
          )}
        </div>
        <div className="px-[22px] pt-3 pb-5">
          <Button full disabled={code.length !== 6} loading={busy} onClick={() => verify()}>Verify</Button>
        </div>
      </Screen>
    );
  }

  const canSend = mode === "phone" ? phoneOk : emailOk;
  const configured = !!supabase();
  return (
    <Screen>
      <AppBar onLead={() => router.push("/welcome")} />
      <div className="flex flex-1 flex-col gap-[22px] px-[22px] pt-1">
        {expired && (
          <Banner tone="info" icon="lock">
            <strong>Sign in again to keep going.</strong> It&apos;s been a while, so we signed you out for safety. Your offline results are safe on this phone and will sync after you sign in.
          </Banner>
        )}
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[30px] leading-tight font-extrabold">{mode === "phone" ? "What's your number?" : "What's your email?"}</h1>
          <p className="text-[15px] leading-relaxed text-ink2">
            {mode === "phone" ? "We'll text you a 6-digit code. No password to remember." : "Your school email or any email you check."}
          </p>
        </div>
        <div className="flex rounded-xl bg-raised p-1" role="tablist">
          {(["phone", "email"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => { setMode(m); setError(null); }}
              className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[9px] text-sm ${mode === m ? "bg-surface font-semibold shadow-card" : "font-medium text-ink2"}`}
            >
              <Icon name={m} size={16} />
              {m === "phone" ? "Phone" : "Email"}
            </button>
          ))}
        </div>
        {mode === "phone" ? (
          <label className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Phone number</span>
            <div className="flex gap-2">
              <span className="flex h-14 items-center rounded-[14px] border-[1.5px] border-line bg-surface px-3.5 font-mono text-[15px] font-semibold">+234</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="803 412 7781"
                aria-invalid={!!phoneError}
                className={`h-14 min-w-0 flex-1 rounded-[14px] px-3.5 font-mono text-[17px] tracking-wider outline-none ${
                  phoneError ? "border-2 border-bad bg-bad-tint" : "border-2 border-line bg-surface focus:border-accent"
                }`}
              />
            </div>
            {phoneError && (
              <span className="flex items-start gap-1.5 text-[13px] leading-snug text-bad-text" role="alert">
                <Icon name="alert" size={16} />
                {phoneError}
              </span>
            )}
          </label>
        ) : (
          <label className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="you@students.unilorin.edu.ng"
              className="h-14 rounded-[14px] border-2 border-line bg-surface px-3.5 text-base outline-none focus:border-accent"
            />
          </label>
        )}
        {error && <span className="text-sm text-bad-text" role="alert">{error}</span>}
        {!configured && !DEV_AUTH && <span className="text-sm text-flag-text">Sign-in isn&apos;t set up yet: add your Supabase keys to .env.local.</span>}

        {DEV_AUTH && (
          <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-dashed border-line p-3">
            <span className="label">Local dev · sign in as</span>
            {DEV_USERS.map((u) => (
              <button key={u.id} onClick={() => devSignIn(u.id)} className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5 text-left">
                <span className="flex flex-col">
                  <strong className="text-sm">{u.name}</strong>
                  <span className="text-xs text-ink3">{u.role}</span>
                </span>
                <Icon name="chevR" size={18} color="var(--ink3)" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 px-[22px] pt-3 pb-5">
        <Button full disabled={!canSend || !configured} loading={busy} onClick={send}>
          {busy ? "Sending code…" : "Send code"}
        </Button>
        <span className="text-center text-xs leading-relaxed text-ink3">By continuing you agree to the Terms and Privacy Policy.</span>
      </div>
    </Screen>
  );
}
