"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { takeNext } from "@/lib/next-url";
import { DEV_AUTH, supabase } from "@/lib/supabase";
import { Banner } from "@/components/ui/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Logo, Mark } from "@/components/ui/logo";
import { Loader } from "@/components/motion/loader";
import { Marquee, RevealText, Rise } from "@/components/motion/reveal";
import { InkText, LagosClock, Spine, useLandingFx } from "@/components/motion/landing";

const DEV_ADMINS = [
  { id: "00000000-0000-4000-8000-000000000002", name: "Kunle Adebayo", role: "Content admin · GST 111/112" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Tochukwu B.", role: "Super admin" },
];

/** "0803 412 7781", "+234 803…", "234803…" or an email → what Supabase expects. */
function parseContact(raw: string): { phone: string } | { email: string } | null {
  const v = raw.trim();
  if (v.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { email: v.toLowerCase() } : null;
  let d = v.replace(/\D/g, "");
  if (d.startsWith("234")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.length === 10 ? { phone: `+234${d}` } : null;
}

/** F01: same one-time-code sign-in as students. Only admin roles get past. */
function SignInCard() {
  const { status, me, sendCode, verifyCode, devSignIn, signOut } = useAuth();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [step, setStep] = useState<"contact" | "code">("contact");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const contact = parseContact(value);
  const isStudent = status === "signedIn" && me?.role === "student";

  useEffect(() => {
    if (status === "signedIn" && me && me.role !== "student") router.replace(takeNext("/admin"));
  }, [status, me, router]);

  async function send() {
    if (!contact) return setError("Enter your phone number (e.g. 0803 412 7781) or your email.");
    setBusy(true);
    setError(null);
    try {
      await sendCode(contact);
      setStep("code");
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!contact || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(contact, code);
    } catch {
      setError("That code doesn't match. Check the latest message and try again.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full rounded-[18px] bg-paper p-6 text-exam-ink shadow-card md:p-7">
      <div className="flex w-full flex-col gap-6">
        <div className="flex items-center gap-2">
          <Logo size={24} tag={false} variant="color" />
          <span className="caps rounded-[4px] bg-exam-ink px-1.5 py-0.5 text-[11px] text-paper">Admin</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="display text-[44px]">{step === "code" ? "Enter the code" : "Sign in"}</h2>
          <p className="text-[15px] text-ink2">
            {step === "code" ? <>We sent a 6-digit code to <strong className="text-ink">{value.trim()}</strong>.</> : "For course reps, tutors and the core team."}
          </p>
        </div>

        {isStudent ? (
          <div className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-5">
            <strong>This account doesn&apos;t have admin access</strong>
            <span className="text-sm text-ink2">You&apos;re signed in as {me?.displayName ?? "a student"}. Ask a super admin to invite you, then sign in again.</span>
            <div className="flex gap-2">
              <Button kind="outline" size="md" onClick={() => router.push("/home")}>Go to the app</Button>
              <Button kind="ghost" size="md" onClick={signOut}>Sign out</Button>
            </div>
          </div>
        ) : step === "contact" ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">Phone or email</span>
              <input
                autoFocus
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                placeholder="you@school.edu.ng"
                autoComplete="username"
                className="h-12 rounded-xl border-[1.5px] border-line bg-surface px-3.5 text-[15px] outline-none focus:border-accent"
              />
            </label>
            {error && <span className="text-sm text-bad-text" role="alert">{error}</span>}
            <Button full loading={busy} disabled={!value.trim() || !supabase()}>Send code</Button>
          </form>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <input
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="6-digit code"
              className="h-14 rounded-xl border-[1.5px] border-line bg-surface px-3.5 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-accent"
            />
            {error && <span className="text-sm text-bad-text" role="alert">{error}</span>}
            <Button full loading={busy} disabled={code.length !== 6}>Sign in</Button>
            <button type="button" onClick={() => { setStep("contact"); setCode(""); setError(null); }} className="text-sm font-semibold text-accent-text">Use a different phone or email</button>
          </form>
        )}

        {!supabase() && !isStudent && (
          <Banner tone="warn" icon="info">Code sign-in isn&apos;t set up on this computer (no Supabase keys). Use a test account below.</Banner>
        )}

        {DEV_AUTH && !isStudent && (
          <div className="flex flex-col gap-2 rounded-[18px] border border-dashed border-line p-4">
            <span className="font-mono text-[11px] font-bold tracking-wide text-ink3">LOCAL TESTING · NO CODE NEEDED</span>
            {DEV_ADMINS.map((u) => (
              <button key={u.id} onClick={() => devSignIn(u.id)} className="flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-raised">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-tint"><Icon name="profile" size={18} color="var(--accent-text)" /></span>
                <span className="flex flex-col"><strong className="text-sm">{u.name}</strong><span className="text-xs text-ink2">{u.role}</span></span>
              </button>
            ))}
          </div>
        )}

        <p className="text-sm text-ink3">Need access? Ask a super admin to invite you.</p>
      </div>
    </div>
  );
}

const PIPELINE = [
  { n: "01", title: "Upload", body: "A PDF, a DOCX, or photos of each page straight from your phone. Add the answer key if it's separate.", log: "✓ stored 6 pages · 4.2 MB" },
  { n: "02", title: "Read", body: "Every question, option and printed answer is read into drafts, with a confidence score and the spot on the page it came from.", log: "✓ p3 · 9 questions · conf 0.96" },
  { n: "03", title: "Review", body: "The original on the left, the question on the right. Fix the wording, confirm the key, crop the diagram.", log: "! Q14 · key says B, AI thinks C" },
  { n: "04", title: "Publish", body: "Live in exams, drills and topic practice. Students taking the course get told, and every past attempt re-marks if a key changes.", log: "✓ 50 questions published" },
];

/** F01 as a landing page: the front door for course reps, tutors and the core team. */
export default function AdminLanding() {
  const root = useRef<HTMLDivElement>(null);
  useLandingFx(root);
  return (
    <div ref={root} className="bg-paper text-exam-ink">
      <Loader id="admin" />
      <Spine
        home="/admin/sign-in"
        cta={{ label: "Sign in", href: "#sign-in" }}
        links={[
          { label: "Sign in", href: "#sign-in" },
          { label: "Pipeline", href: "#pipeline" },
          { label: "Student app", href: "/welcome" },
        ]}
      />
      <LagosClock />
      <main className="lg:pl-[88px]">
        <section className="grain relative flex min-h-[100svh] flex-col bg-night px-5 pt-24 pb-10 text-paper lg:px-12 lg:pt-12">
          <div className="caps flex justify-between text-xs opacity-70 md:text-sm">
            <span>IntelQA · Admin</span>
            <span>Course reps · Tutors · Core team</span>
          </div>
          <div className="mt-10 grid flex-1 gap-10 lg:mt-0 lg:grid-cols-[1.25fr_minmax(360px,440px)] lg:items-end lg:gap-14">
            <div className="flex flex-col gap-8 lg:pb-4">
              <RevealText as="h1" trigger="mount" className="display text-[clamp(64px,min(13vw,19vh),220px)] text-highlighter" text={"Turn past\npapers into\npractice."} />
              <RevealText as="p" trigger="mount" delay={350} className="statement max-w-[26ch] text-[clamp(24px,2.6vw,38px)]" text="Upload a paper, check what was read, and publish it to every student taking the course." />
            </div>
            <Rise trigger="mount" delay={500} className="scroll-mt-24" >
              <div id="sign-in"><SignInCard /></div>
            </Rise>
          </div>
        </section>

        <div className="border-y border-violet-deep bg-violet py-4 text-paper">
          <Marquee speed={26}>
            {["Upload", "Read", "Review", "Publish"].map((w) => (
              <span key={w} className="display flex items-center gap-6 px-6 text-[clamp(32px,5vw,64px)]">
                {w} <Mark size={28} variant="violet" />
              </span>
            ))}
          </Marquee>
        </div>

        <section id="pipeline" data-fx="wipe" className="bg-paper px-5 py-20 lg:px-12 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div className="self-start lg:sticky lg:top-12">
              <span className="caps text-sm text-violet">(01) The pipeline</span>
              <RevealText as="h2" className="display mt-5 text-[clamp(60px,9vw,150px)]" text={"From photo\nto live\npaper."} />
              <Rise className="statement mt-6 max-w-[24ch] text-2xl italic text-ink2">Most papers go from upload to published in under ten minutes.</Rise>
            </div>
            <ol className="flex flex-col">
              {PIPELINE.map((s, i) => (
                <Rise as="li" key={s.n} delay={i * 70} className="grid grid-cols-[auto_1fr] gap-x-6 border-t border-line py-9 last:border-b md:gap-x-10">
                  <span className="display text-[clamp(56px,7vw,110px)] text-transparent [-webkit-text-stroke:1.5px_var(--color-violet)]">{s.n}</span>
                  <div className="flex flex-col gap-3 pt-2">
                    <h3 className="display text-[clamp(32px,3.4vw,52px)]">{s.title}</h3>
                    <p className="max-w-[46ch] text-[16px] leading-relaxed text-ink2">{s.body}</p>
                    <span className="self-start rounded-[6px] bg-night px-3 py-1.5 font-mono text-xs text-paper">{s.log}</span>
                  </div>
                </Rise>
              ))}
            </ol>
          </div>
        </section>

        <section className="grain relative bg-night px-5 py-24 text-paper lg:px-12 lg:py-36">
          <span className="caps text-sm text-highlighter">(02) The rule</span>
          <p data-fx="ink" className="statement mt-6 max-w-[20ch] text-[clamp(36px,5.6vw,92px)]">
            <InkText text="Nothing goes live until a person has checked every question and its answer key." />
          </p>
        </section>

        <section className="bg-violet px-5 pt-20 pb-10 text-paper lg:px-12 lg:pt-32">
          <RevealText as="h2" className="display text-[clamp(64px,12vw,200px)]" text={"Got a paper?\nPut it to work."} accent={["work"]} accentClass="text-highlighter" />
          <Rise className="mt-10">
            <a href="#sign-in" className="nudge caps inline-flex h-16 items-center gap-3 rounded-[6px] bg-highlighter px-9 text-xl text-exam-ink">
              Sign in <Icon name="arrowR" size={22} />
            </a>
          </Rise>
          <footer className="mt-24 flex flex-col gap-6 border-t border-white/20 pt-8">
            <div className="caps flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <a className="draw" href="/welcome">Student app</a>
              <a className="draw" href="mailto:support@intelqa.app">Need access? support@intelqa.app</a>
            </div>
            <span className="display block text-[clamp(84px,24vw,420px)] leading-[0.78] text-paper/95" aria-hidden>Admin</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
