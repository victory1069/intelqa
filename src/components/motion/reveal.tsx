"use client";
import { createElement, useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

/* ── Loader handshake ── */

/*
 * <Loader>'s pre-paint script sets data-iq-loading on <html> only when it is going to play,
 * so pages without a loader (or a returning visit) count as "done" from the start.
 */
const LOADING_ATTR = "data-iq-loading";
const listeners = new Set<() => void>();
const isDone = () => !document.documentElement.hasAttribute(LOADING_ATTR);

/** Called by <Loader> when its curtain lifts (or right away when it's skipped). */
export function markLoaderDone() {
  document.documentElement.removeAttribute(LOADING_ATTR);
  listeners.forEach((l) => l());
}

/** True once the page loader is out of the way. */
export function useLoaderDone() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isDone,
    () => false,
  );
}

/* ── In-view trigger ── */

/**
 * Adds `.is-in` to the element when it scrolls into view (once), or right away for "mount".
 * Works through classList so it never re-renders. Waits for the loader if one is showing.
 */
export function useReveal<T extends HTMLElement>(trigger: "mount" | "view" = "view", threshold = 0.2) {
  const ref = useRef<T>(null);
  const ready = useLoaderDone();
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    if (trigger === "mount" || !("IntersectionObserver" in window)) {
      const raf = requestAnimationFrame(() => el.classList.add("is-in"));
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("is-in");
            io.disconnect();
          }
        }
      },
      { threshold, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready, trigger, threshold]);
  return ref;
}

/**
 * Text that rises word by word from behind a mask (Monument/Bulletproof headlines).
 * Use "\n" in `text` for a hard line break. `accent` words (exact match) get `accentClass`.
 */
export function RevealText({
  text,
  as = "span",
  className = "",
  trigger = "view",
  delay = 0,
  accent = [],
  accentClass = "",
  style,
}: {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  className?: string;
  trigger?: "mount" | "view";
  delay?: number;
  accent?: string[];
  accentClass?: string;
  style?: CSSProperties;
}) {
  const ref = useReveal<HTMLElement>(trigger);
  let i = 0;
  const lines = text.split("\n");
  const children: ReactNode[] = lines.map((line, li) => (
    <span key={li} className="block">
      {line.split(/(\s+)/).map((w, wi) =>
        /^\s+$/.test(w) || !w ? (
          w
        ) : (
          <span key={wi} className="rv">
            <span className={`rv-in ${accent.includes(w.replace(/[.,!?]/g, "")) ? accentClass : ""}`} style={{ "--i": i++, "--d": `${delay}ms` } as CSSProperties}>
              {w}
            </span>
          </span>
        ),
      )}
    </span>
  ));
  return createElement(as, { ref, className, style, "aria-label": text.replace(/\n/g, " ") }, <span aria-hidden>{children}</span>);
}

/** Any block that fades up into view. */
export function Rise({ children, className = "", delay = 0, trigger = "view", as = "div" }: { children: ReactNode; className?: string; delay?: number; trigger?: "mount" | "view"; as?: "div" | "section" | "li" | "span" }) {
  const ref = useReveal<HTMLElement>(trigger);
  return createElement(as, { ref, className: `rise ${className}`, style: { "--d": `${delay}ms` } as CSSProperties }, children);
}

/** Endless horizontal strip. Content is duplicated so the loop is seamless. */
export function Marquee({ children, speed = 28, className = "", reverse = false }: { children: ReactNode; speed?: number; className?: string; reverse?: boolean }) {
  return (
    <div className={`marquee ${className}`} aria-hidden>
      <div className="marquee-track" style={{ "--speed": `${speed}s`, animationDirection: reverse ? "reverse" : "normal" } as CSSProperties}>
        <div className="flex flex-none items-center">{children}</div>
        <div className="flex flex-none items-center">{children}</div>
      </div>
    </div>
  );
}
