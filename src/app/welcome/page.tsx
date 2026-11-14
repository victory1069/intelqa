"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { Loader } from "@/components/motion/loader";
import { Marquee, RevealText, Rise } from "@/components/motion/reveal";
import { InkText, LagosClock, Spine, Sticker, useLandingFx } from "@/components/motion/landing";
import { Option } from "@/components/ui/option";
import { Icon, type Glyph } from "@/components/ui/icon";
import { Mark } from "@/components/ui/logo";

const COURSES = ["GST 111", "MTH 101", "PHY 101", "CHM 101", "CSC 111", "BIO 101", "GST 112", "ECO 101"];

const STEPS = [
  { n: "01", title: "Pick your school and courses", body: "UNILORIN first, more schools soon. Choose your department and the courses on your form; we only show papers for those." },
  { n: "02", title: "Sit a real past paper", body: "The same questions, the same number of options, the same minus marks, against a CBT clock that doesn't stop when you panic." },
  { n: "03", title: "Learn why, not just what", body: "Every answer comes with a plain explanation, the trap in the wrong option, and working for calculations. Still stuck? Ask." },
];

const FEATURES: { glyph: Glyph; title: string; body: string; tone: string; r: number }[] = [
  { glyph: "offline", title: "Works offline", body: "Download a course once. Sit exams with no data; results sync later.", tone: "bg-violet text-paper", r: -5 },
  { glyph: "book", title: "Every answer explained", body: "Checked by a person before it goes live. No guessing which key is right.", tone: "bg-highlighter text-exam-ink", r: 4 },
  { glyph: "board", title: "Ranks that mean it", body: "Course boards need three real attempts, so one lucky run can't top them.", tone: "bg-night text-paper", r: -3 },
  { glyph: "calendar", title: "Daily challenge", body: "Ten questions, same set for everyone, a new board every midnight.", tone: "bg-surface text-exam-ink border border-line", r: 5 },
  { glyph: "chat", title: "Ask about it", body: "Still confused after the explanation? Ask a follow-up about that exact question.", tone: "bg-violet text-paper", r: -4 },
  { glyph: "flame", title: "Streaks with freezes", body: "Practise a little each day. Miss one and a saved freeze keeps the streak alive.", tone: "bg-highlighter text-exam-ink", r: 3 },
];

const BOARD = [
  { r: 1, n: "Fatimah Yusuf", s: "95%" },
  { r: 2, n: "Mariam Abdulkadir", s: "94%" },
  { r: 3, n: "Daniel Okonkwo", s: "93%" },
];

/** A02 as a landing page: first visit, usually from a WhatsApp link. */
export default function Welcome() {
  const { status } = useAuth();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  useLandingFx(root);
  useEffect(() => {
    if (status === "signedIn") router.replace("/home");
  }, [status, router]);

  return (
    <div ref={root} className="bg-paper text-exam-ink">
      <Loader id="student" />
      <Spine
        cta={{ label: "Log in", href: "/sign-in" }}
        links={[
          { label: "Start", href: "/sign-in" },
          { label: "How it works", href: "#how" },
          { label: "Features", href: "#features" },
          { label: "For admins", href: "/admin/sign-in" },
        ]}
      />
      <LagosClock />

      <main className="lg:pl-[88px]">
        {/* ── Hero ── */}
        <section className="grain relative flex min-h-[100svh] flex-col overflow-hidden bg-night px-5 pt-24 pb-8 text-paper lg:px-12 lg:pt-12 lg:pb-12">
          <div className="caps flex justify-between text-xs opacity-70 md:text-sm">
            <span>IntelQA CBT</span>
            <span>For 100-level · Nigeria</span>
          </div>
          <RevealText
            as="h1"
            trigger="mount"
            className="display mt-auto text-[clamp(68px,min(17.5vw,24vh),280px)] text-highlighter"
            text={"Sit the\nexam before\nthe exam."}
          />
          <div className="mt-8 grid gap-7 border-t border-white/15 pt-7 lg:mt-12 lg:grid-cols-[1fr_auto] lg:items-end">
            <RevealText
              as="p"
              trigger="mount"
              delay={350}
              className="statement max-w-[24ch] text-[clamp(26px,3.1vw,46px)]"
              text="Real past questions from your school, a real CBT clock, and every answer explained."
            />
            <Rise trigger="mount" delay={650} className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <Link href="/sign-in" className="nudge caps inline-flex h-14 items-center justify-center gap-3 rounded-[6px] bg-highlighter px-7 text-lg text-exam-ink">
                Start practising <Icon name="arrowR" size={20} />
              </Link>
              <Link href="/sign-in" className="caps inline-flex h-14 items-center justify-center rounded-[6px] border border-white/30 px-7 text-lg">
                I have an account
              </Link>
            </Rise>
          </div>
        </section>

        {/* ── Course strip ── */}
        <div className="border-y border-violet-deep bg-violet py-4 text-paper">
          <Marquee speed={32}>
            {COURSES.map((c) => (
              <span key={c} className="display flex items-center gap-6 px-6 text-[clamp(32px,5vw,64px)]">
                {c} <Mark size={28} variant="violet" />
              </span>
            ))}
          </Marquee>
        </div>

        {/* ── Statement ── */}
        <section data-fx="wipe" className="relative overflow-hidden bg-paper px-5 py-24 lg:px-12 lg:py-40">
          <span className="caps text-sm text-violet">(01) Why IntelQA</span>
          <div className="mt-6 grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <p data-fx="ink" className="statement text-[clamp(34px,5.4vw,88px)]">
              <InkText text="Every year, thousands of freshers meet a CBT timer for the first time in the exam hall. We make sure the first time isn't the real time." />
            </p>
            <Sticker r={-4} className="mx-auto w-full max-w-[380px]">
              <div className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-5 shadow-card">
                <div className="flex justify-between font-mono text-[11px] text-ink3">
                  <span>GST 111 · 2023/24 · Q14</span>
                  <span className="rounded bg-exam-ink px-1.5 text-paper">38:12</span>
                </div>
                <span className="text-[16px] leading-snug font-medium">The study of the meaning of words and sentences is called</span>
                <Option letter="A" text="Phonology" />
                <Option letter="B" text="Semantics" state="selected" />
                <Option letter="C" text="Syntax" />
              </div>
            </Sticker>
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how" className="grain relative bg-night px-5 py-20 text-paper lg:px-12 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div className="self-start lg:sticky lg:top-12">
              <span className="caps text-sm text-highlighter">(02) How it works</span>
              <RevealText as="h2" className="display mt-5 text-[clamp(60px,9vw,150px)]" text={"Three\nsteps to\nready."} />
            </div>
            <ol className="flex flex-col">
              {STEPS.map((s, i) => (
                <Rise as="li" key={s.n} delay={i * 80} className="grid grid-cols-[auto_1fr] gap-x-6 border-t border-white/15 py-9 last:border-b md:gap-x-10">
                  <span className="display text-[clamp(56px,7vw,110px)] text-transparent [-webkit-text-stroke:1.5px_var(--color-highlighter)]">{s.n}</span>
                  <div className="flex flex-col gap-3 pt-2">
                    <h3 className="display text-[clamp(28px,3vw,44px)] leading-[0.95]">{s.title}</h3>
                    <p className="max-w-[46ch] text-[16px] leading-relaxed opacity-75">{s.body}</p>
                  </div>
                </Rise>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Sliding line ── */}
        <section className="overflow-hidden bg-paper py-10 lg:py-16" aria-hidden>
          <div data-fx="slide" data-from="4" data-to="-38" className="display whitespace-nowrap text-[clamp(96px,19vw,320px)] text-violet">
            Practise · Rank · Repeat · Practise
          </div>
          <div data-fx="slide" data-from="-40" data-to="2" className="display -mt-[0.12em] whitespace-nowrap text-[clamp(96px,19vw,320px)] text-transparent [-webkit-text-stroke:2px_var(--color-exam-ink)]">
            Repeat · Practise · Rank · Repeat
          </div>
        </section>

        {/* ── Features ── */}
        <section id="features" className="bg-paper px-5 pb-24 lg:px-12 lg:pb-36">
          <div className="flex flex-col gap-4 border-t border-line pt-10 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="caps text-sm text-violet">(03) What you get</span>
              <RevealText as="h2" className="display mt-5 text-[clamp(56px,8vw,128px)]" text={"Everything a\nfresher needs."} />
            </div>
            <Rise className="statement max-w-[28ch] text-2xl italic text-ink2">Free. No install. Add it to your home screen and it opens like an app.</Rise>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
            {FEATURES.map((f) => (
              <Sticker key={f.title} r={f.r}>
                <div className={`flex min-h-[230px] flex-col gap-4 rounded-[22px] p-6 shadow-card ${f.tone}`}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-current/10">
                    <Icon name={f.glyph} size={24} />
                  </span>
                  <h3 className="display mt-auto text-[38px] leading-[0.9]">{f.title}</h3>
                  <p className="text-[15px] leading-relaxed opacity-80">{f.body}</p>
                </div>
              </Sticker>
            ))}
          </div>
        </section>

        {/* ── Numbers ── */}
        <section data-fx="wipe" className="bg-highlighter px-5 py-20 text-exam-ink lg:px-12 lg:py-28">
          <div className="grid gap-10 md:grid-cols-3">
            {[
              { to: 5, unit: "", label: "Ways to practise: exam, drill, topic, retry, daily" },
              { to: 200, unit: "KB", label: "Or less for a whole paper, explanations included" },
              { to: 0, unit: "MB", label: "Of data to sit a downloaded paper offline" },
            ].map((s) => (
              <div key={s.label} className="flex flex-col gap-3 border-t-2 border-exam-ink pt-5">
                <span className="display text-[clamp(96px,12vw,180px)]">
                  <span data-fx="count" data-to={s.to}>{s.to}</span>
                  <span className="text-[0.4em]">{s.unit}</span>
                </span>
                <span className="max-w-[26ch] text-[16px] leading-snug font-medium">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Ranks teaser ── */}
        <section className="grain relative overflow-hidden bg-night px-5 py-24 text-paper lg:px-12 lg:py-36">
          <div className="grid gap-14 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="caps text-sm text-highlighter">(04) Ranks</span>
              <RevealText as="h2" className="display mt-5 text-[clamp(56px,8vw,130px)]" text={"Your course.\nYour school.\nYour friends."} accent={["friends"]} accentClass="text-highlighter" />
              <Rise className="mt-6 max-w-[44ch] text-[17px] leading-relaxed opacity-75">Course boards, a weekly XP board for your department, and one just for the friends you invite. Share a challenge on WhatsApp and see who&apos;s really ready.</Rise>
            </div>
            <div data-fx="parallax" data-speed="0.6" className="mx-auto w-full max-w-[460px]">
              <div className="flex flex-col overflow-hidden rounded-[22px] bg-paper text-exam-ink shadow-card">
                <div className="caps flex justify-between bg-violet px-5 py-3.5 text-sm text-paper"><span>GST 111 · UNILORIN</span><span>Course score</span></div>
                {BOARD.map((b) => (
                  <div key={b.r} className="flex items-center gap-4 border-b border-line px-5 py-4">
                    <span className="display w-8 text-3xl">{b.r}</span>
                    <span className="flex-1 font-semibold">{b.n}</span>
                    <span className="font-mono text-sm">{b.s}</span>
                  </div>
                ))}
                <div className="flex items-center gap-4 bg-highlighter px-5 py-4">
                  <span className="display w-8 text-3xl">38</span>
                  <span className="flex-1 font-semibold">You</span>
                  <span className="caps rounded-[4px] bg-exam-ink px-2 py-0.5 text-xs text-paper">↑ 12 this week</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final call ── */}
        <section className="relative overflow-hidden bg-violet px-5 pt-24 pb-10 text-paper lg:px-12 lg:pt-36">
          <RevealText as="h2" className="display text-[clamp(72px,14vw,240px)]" text={"Ready for\nthe real\nthing?"} accent={["real"]} accentClass="text-highlighter" />
          <Rise className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-in" className="nudge caps inline-flex h-16 items-center justify-center gap-3 rounded-[6px] bg-highlighter px-9 text-xl text-exam-ink">
              Start practising free <Icon name="arrowR" size={22} />
            </Link>
          </Rise>
          <footer className="mt-24 flex flex-col gap-6 border-t border-white/20 pt-8 lg:mt-36">
            <div className="caps flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <Link className="draw" href="/sign-in">Log in</Link>
              <Link className="draw" href="/admin/sign-in">For course reps & admins</Link>
              <a className="draw" href="mailto:support@intelqa.app">support@intelqa.app</a>
            </div>
            <span className="display block text-[clamp(84px,24vw,420px)] leading-[0.78] tracking-[-0.03em] text-paper/95" aria-hidden>
              IntelQA
            </span>
            <span className="caps text-xs opacity-60">© IntelQA · Made for freshers</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
