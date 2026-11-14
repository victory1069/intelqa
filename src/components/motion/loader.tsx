"use client";
import { useEffect, useRef } from "react";
import { Logo } from "@/components/ui/logo";
import { markLoaderDone } from "./reveal";

const W = 1000;
const LINES = 46;
const STEPS: [number, string][] = [
  [0, "Sharpening pencils"],
  [22, "Shuffling the options"],
  [48, "Starting the clock"],
  [74, "Marking the answer key"],
  [95, "Good luck"],
];

let pendingStop: ReturnType<typeof setTimeout> | undefined;

/** Seeded random so the server and client draw the same pleats. */
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Vertical zig-zag fold lines that bunch up toward a crease, like folded paper. */
function foldLines() {
  const r = rng(11);
  const crease = 0.6;
  const out: string[] = [];
  for (let k = 0; k <= LINES; k++) {
    const u = k / LINES;
    // Squeeze the spacing around the crease.
    const d = u - crease;
    const x = (crease + Math.sign(d) * Math.pow(Math.abs(d) / Math.max(crease, 1 - crease), 1.6) * Math.max(crease, 1 - crease)) * W;
    const amp = 14 + 26 * Math.abs(d) + r() * 6;
    const pts: string[] = [];
    for (let y = -40, s = 0; y <= W + 280; y += 160, s++) pts.push(`${(x + (s % 2 ? amp : -amp) * (d < 0 ? -1 : 1)).toFixed(1)},${y}`);
    out.push(pts.join(" "));
  }
  return out;
}

/** Ridge profile for the wave's top edge: a few peaks, the same every time. */
const RIDGE = (() => {
  const r = rng(29);
  return Array.from({ length: 13 }, (_, i) => (i % 3 === 1 ? -1 : 0.2) * (60 + r() * 90));
})();

function edge(level: number, t: number) {
  // level 0 = bottom of screen, 1 = top. Ridges sway a little over time.
  const base = W + 170 - level * (W + 420);
  const pts = RIDGE.map((h, i) => {
    const x = (i / (RIDGE.length - 1)) * W;
    const y = base + h * (1 - level * 0.6) + Math.sin(t / 420 + i) * 8;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `${pts.join(" ")} ${W},${W + 600} 0,${W + 600}`;
}

/** Eased display progress with a couple of natural-looking stalls. */
function progressAt(u: number) {
  const k: [number, number][] = [[0, 0], [0.18, 0.21], [0.3, 0.27], [0.52, 0.58], [0.62, 0.63], [0.86, 0.94], [1, 1]];
  for (let i = 1; i < k.length; i++) {
    if (u <= k[i][0]) {
      const [x0, y0] = k[i - 1];
      const [x1, y1] = k[i];
      const s = (u - x0) / (x1 - x0);
      return y0 + (y1 - y0) * (s * s * (3 - 2 * s));
    }
  }
  return 1;
}

/**
 * The 5-second landing loader. Plays on every full page load (first visit and every reload),
 * never for people who ask for reduced motion. A tiny script decides before first paint; it
 * doesn't run on in-app navigation, so moving around the app never replays it.
 * Reveals on the page wait for it (see useLoaderDone).
 */
export function Loader({ id, duration = 5000 }: { id: string; duration?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const pct = useRef<HTMLSpanElement>(null);
  const step = useRef<HTMLSpanElement>(null);
  const violet = useRef<SVGPolygonElement>(null);
  const yellow = useRef<SVGPolygonElement>(null);

  useEffect(() => {
    const el = root.current!;
    const html = document.documentElement;
    // React may unmount and remount straight away (Strict Mode): cancel the pending cleanup and resume.
    clearTimeout(pendingStop);
    if (!html.hasAttribute("data-iq-loading")) {
      el.style.display = "none";
      markLoaderDone();
      return;
    }
    const overflow = el.dataset.overflow ?? document.body.style.overflow;
    el.dataset.overflow = overflow;
    document.body.style.overflow = "hidden";
    const start = Number(el.dataset.start || 0) || performance.now();
    el.dataset.start = String(start);
    let raf = 0;
    let lifted = false;
    let lastStep = -1;
    const fillEnd = duration * 0.8;
    const yellowEnd = duration * 0.9;

    const frame = (now: number) => {
      const t = now - start;
      const p = progressAt(Math.min(1, t / fillEnd));
      const shown = Math.round(p * 100);
      if (pct.current) pct.current.textContent = `${shown}%`;
      const s = STEPS.reduce((acc, [at], i) => (shown >= at ? i : acc), 0);
      if (s !== lastStep && step.current) {
        lastStep = s;
        step.current.textContent = STEPS[s][1];
      }
      violet.current?.setAttribute("points", edge(p, t));
      const y = t < fillEnd ? 0 : Math.min(1, (t - fillEnd) / (yellowEnd - fillEnd));
      if (y > 0) el.classList.add("iq-loader-y");
      yellow.current?.setAttribute("points", edge(y * y * (3 - 2 * y), t));
      if (t >= yellowEnd && !lifted) {
        lifted = true;
        el.classList.add("iq-loader-out");
        markLoaderDone();
        document.body.style.overflow = overflow;
        setTimeout(() => (el.style.display = "none"), duration - yellowEnd + 400);
      }
      if (t < duration + 200) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      // Left the page mid-load: give the page back unless this is just a remount.
      pendingStop = setTimeout(() => {
        document.body.style.overflow = overflow;
        markLoaderDone();
      }, 60);
    };
  }, [duration]);

  // Decides before paint: play (sets data-iq-loading) or hide (sets data-iq-skip-loader).
  const decide = `(function(){var h=document.documentElement;try{var r=matchMedia("(prefers-reduced-motion: reduce)").matches;if(r){h.setAttribute("data-iq-skip-loader","")}else{h.setAttribute("data-iq-loading","");h.removeAttribute("data-iq-skip-loader")}}catch(e){h.setAttribute("data-iq-skip-loader","")}})()`;
  const lines = foldLines();

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: decide }} />
      <div ref={root} data-loader={id} className="iq-loader grain fixed inset-0 z-[200] overflow-hidden bg-night text-paper" role="status" aria-label="Loading IntelQA">
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${W}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            <clipPath id="iq-clip-v"><polygon ref={violet} points={edge(0, 0)} /></clipPath>
            <clipPath id="iq-clip-y"><polygon ref={yellow} points={edge(0, 0)} /></clipPath>
          </defs>
          <g clipPath="url(#iq-clip-v)">
            <rect width={W} height={W + 640} y={-40} fill="#5B3DF5" />
            {lines.map((p, i) => <polyline key={i} points={p} fill="none" stroke="#3A22C4" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          </g>
          <g clipPath="url(#iq-clip-y)">
            <rect width={W} height={W + 640} y={-40} fill="#FFD43B" />
            {lines.map((p, i) => <polyline key={i} points={p} fill="none" stroke="#E0B300" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          </g>
        </svg>

        <div className="iq-loader-fg absolute inset-0 z-[2] flex flex-col items-center justify-center gap-5">
          <div className="iq-loader-logo origin-center scale-[1.35] md:scale-[2.2]">
            <Logo size={32} variant="violet" />
          </div>
          <span ref={step} className="statement mt-6 text-lg italic opacity-80 md:mt-12 md:text-2xl">Sharpening pencils</span>
        </div>
        <span className="iq-loader-fg caps absolute bottom-6 left-5 z-[2] text-sm md:top-1/2 md:bottom-auto md:left-9 md:-translate-y-1/2">Loading</span>
        <span ref={pct} className="iq-loader-fg caps tabular absolute right-5 bottom-6 z-[2] text-sm md:top-1/2 md:right-9 md:bottom-auto md:-translate-y-1/2">0%</span>
      </div>
    </>
  );
}
