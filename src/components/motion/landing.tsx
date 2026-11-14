"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Mark } from "@/components/ui/logo";
import { Icon } from "@/components/ui/icon";
import { useLoaderDone } from "./reveal";

const reduced = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ───────────── Scroll progress ───────────── */

function useScrollProgress(onChange: (p: number) => void) {
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - innerHeight;
      onChange(max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0);
    };
    const on = () => (raf ||= requestAnimationFrame(read));
    read();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => {
      removeEventListener("scroll", on);
      removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, [onChange]);
}

export type NavLink = { label: string; href: string };

/**
 * Monument-style spine: a fixed violet bar down the left on desktop (logo, menu, "scroll for more")
 * that fills as you scroll; a bar across the top on phones. Opens a full-screen menu.
 */
export function Spine({ links, home = "/welcome", cta }: { links: NavLink[]; home?: string; cta?: NavLink }) {
  const fillV = useRef<HTMLDivElement>(null);
  const fillH = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const setFill = useCallback((p: number) => {
    if (fillV.current) fillV.current.style.transform = `scaleY(${p})`;
    if (fillH.current) fillH.current.style.transform = `scaleX(${p})`;
  }, []);
  useScrollProgress(setFill);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Desktop: left spine */}
      <nav aria-label="Site" className="fixed top-4 bottom-4 left-4 z-50 hidden w-[64px] flex-col items-center overflow-hidden rounded-[6px] bg-violet text-paper lg:flex">
        <div ref={fillV} className="absolute inset-x-0 top-0 h-full origin-top bg-violet-deep" style={{ transform: "scaleY(0)" }} aria-hidden />
        <Link href={home} aria-label="IntelQA home" className="relative z-[1] flex h-[72px] w-full items-center justify-center border-b border-white/15">
          <Mark size={30} variant="violet" />
        </Link>
        <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="relative z-[1] mt-auto mb-auto flex h-12 w-12 flex-col items-center justify-center gap-[5px]">
          <span className="h-[3px] w-6 rounded-full bg-paper" />
          <span className="h-[3px] w-6 rounded-full bg-paper" />
        </button>
        <span className="caps relative z-[1] mb-6 text-[12px] [writing-mode:vertical-rl] rotate-180">Scroll for more</span>
      </nav>

      {/* Phone: top bar */}
      <nav aria-label="Site" className="fixed inset-x-3 top-3 z-50 flex h-14 items-center overflow-hidden rounded-[6px] bg-violet pr-1 pl-3.5 text-paper lg:hidden">
        <div ref={fillH} className="absolute inset-y-0 left-0 w-full origin-left bg-violet-deep" style={{ transform: "scaleX(0)" }} aria-hidden />
        <Link href={home} aria-label="IntelQA home" className="relative z-[1] flex items-center gap-2">
          <Mark size={26} variant="violet" />
          <span className="caps text-lg">IntelQA</span>
        </Link>
        {cta && <Link href={cta.href} className="caps relative z-[1] mr-1 ml-auto rounded-[4px] bg-highlighter px-3 py-1.5 text-[13px] text-exam-ink">{cta.label}</Link>}
        <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className={`relative z-[1] flex h-12 w-12 flex-col items-center justify-center gap-[5px] ${cta ? "" : "ml-auto"}`}>
          <span className="h-[3px] w-6 rounded-full bg-paper" />
          <span className="h-[3px] w-6 rounded-full bg-paper" />
        </button>
      </nav>

      {open && <Menu links={links} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Full-screen night menu with giant links (landing spine, and the app's burger on desktop). */
export function Menu({ links, onClose, active }: { links: NavLink[]; onClose: () => void; active?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => ref.current?.classList.add("is-in"));
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", k);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="dialog" aria-modal aria-label="Menu" className="iq-menu grain fixed inset-0 z-[60] flex flex-col bg-night p-5 text-paper md:p-10 lg:pl-28">
      <div className="flex items-center justify-between">
        <span className="caps text-sm opacity-70">Menu</span>
        <button onClick={onClose} aria-label="Close menu" className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25">
          <Icon name="close" size={22} />
        </button>
      </div>
      <ul className="mt-10 flex flex-col gap-1 md:mt-16">
        {links.map((l, i) => (
          <li key={l.href} className="border-b border-white/15">
            <Link href={l.href} onClick={onClose} className="group flex items-baseline justify-between py-2">
              <span className="rv">
                <span className={`rv-in display text-[clamp(56px,13vw,150px)] transition-colors group-hover:text-highlighter ${active === l.href ? "text-highlighter" : "text-paper"}`} style={{ "--i": i } as CSSProperties}>{l.label}</span>
              </span>
              <span className="caps text-sm opacity-60">0{i + 1}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="statement mt-auto max-w-md pt-8 text-2xl italic opacity-80">Sit the exam before the exam.</p>
    </div>
  );
}

/** Vertical Lagos time in the top-right corner (Monument's local clock). */
export function LagosClock() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" });
    const tick = () => {
      if (ref.current) ref.current.textContent = `${fmt.format(new Date()).toUpperCase()} WAT`;
    };
    tick();
    const t = setInterval(tick, 20_000);
    return () => clearInterval(t);
  }, []);
  return <span ref={ref} className="caps pointer-events-none fixed top-4 right-4 z-40 hidden rounded-[4px] bg-night px-1.5 py-3 text-[12px] [writing-mode:vertical-rl] text-paper lg:block" aria-hidden />;
}

/* ───────────── Smooth scroll + scroll effects ───────────── */

/**
 * Lenis smooth scrolling on desktop pointers, driven by GSAP's ticker so ScrollTrigger stays in sync,
 * plus the data-fx effects inside `root`. Everything is skipped for reduced motion.
 *
 *   data-fx="slide"   data-from="10" data-to="-40"   moves horizontally (xPercent) while it crosses the screen
 *   data-fx="wipe"                                    section's slanted top edge flattens as it arrives
 *   data-fx="ink"                                     .ink-w words go from faint to solid as you read down
 *   data-fx="parallax" data-speed="1"                 drifts against the scroll
 *   data-fx="tilt"    data-r="-6"                     sticker card swings in to its resting angle
 *   data-fx="count"   data-to="1200"                  counts up once when visible
 *   data-fx="scale"                                   grows from 86% to full size
 */
export function useLandingFx(root: RefObject<HTMLElement | null>) {
  const ready = useLoaderDone();
  useEffect(() => {
    if (!ready || !root.current || reduced()) return;
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      const [{ gsap }, { ScrollTrigger }, Lenis] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger"), import("lenis").then((m) => m.default)]);
      if (cancelled || !root.current) return;
      gsap.registerPlugin(ScrollTrigger);

      let lenis: InstanceType<typeof Lenis> | null = null;
      const tick = (t: number) => lenis?.raf(t * 1000);
      if (matchMedia("(pointer: fine)").matches) {
        lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
        lenis.on("scroll", ScrollTrigger.update);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);
      }

      const ctx = gsap.context(() => {
        gsap.utils.toArray<HTMLElement>('[data-fx="slide"]').forEach((el) => {
          gsap.fromTo(el, { xPercent: Number(el.dataset.from ?? 8) }, { xPercent: Number(el.dataset.to ?? -30), ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.6 } });
        });
        gsap.utils.toArray<HTMLElement>('[data-fx="wipe"]').forEach((el) => {
          gsap.fromTo(
            el,
            { clipPath: "polygon(0% 16%, 100% 0%, 100% 100%, 0% 100%)" },
            { clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)", ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "top 35%", scrub: true } },
          );
        });
        gsap.utils.toArray<HTMLElement>('[data-fx="ink"]').forEach((el) => {
          gsap.fromTo(el.querySelectorAll(".ink-w"), { opacity: 0.16 }, { opacity: 1, stagger: 0.08, ease: "none", scrollTrigger: { trigger: el, start: "top 82%", end: "bottom 50%", scrub: true } });
        });
        gsap.utils.toArray<HTMLElement>('[data-fx="parallax"]').forEach((el) => {
          gsap.to(el, { yPercent: -18 * Number(el.dataset.speed ?? 1), ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true } });
        });
        gsap.utils.toArray<HTMLElement>('[data-fx="tilt"]').forEach((el) => {
          const r = Number(el.dataset.r ?? -4);
          gsap.fromTo(el, { rotate: r * 3, y: 90, opacity: 0 }, { rotate: r, y: 0, opacity: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 95%", end: "top 55%", scrub: 0.8 } });
        });
        gsap.utils.toArray<HTMLElement>('[data-fx="scale"]').forEach((el) => {
          gsap.fromTo(el, { scale: 0.86 }, { scale: 1, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "top 30%", scrub: true } });
        });
        gsap.utils.toArray<HTMLElement>('[data-fx="count"]').forEach((el) => {
          const to = Number(el.dataset.to ?? 0);
          const o = { v: 0 };
          gsap.to(o, { v: to, duration: 1.6, ease: "power2.out", scrollTrigger: { trigger: el, start: "top 85%", once: true }, onUpdate: () => {
            el.textContent = Math.round(o.v).toLocaleString();
          } });
        });
      }, root);

      cleanup = () => {
        ctx.revert();
        gsap.ticker.remove(tick);
        lenis?.destroy();
      };
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [ready, root]);
}

/** Statement text whose words ink in as you scroll (pair with data-fx="ink" on a parent). */
export function InkText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split(/(\s+)/).map((w, i) => (/^\s+$/.test(w) ? w : <span key={i} className="ink-w">{w}</span>))}
    </span>
  );
}

/** Tilted card that swings in on scroll (Theobroma stickers). */
export function Sticker({ children, r = -4, className = "", style }: { children: ReactNode; r?: number; className?: string; style?: CSSProperties }) {
  return (
    <div data-fx="tilt" data-r={r} className={className} style={{ rotate: `${r}deg`, ...style }}>
      {children}
    </div>
  );
}
