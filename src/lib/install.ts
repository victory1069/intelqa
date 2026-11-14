"use client";
import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();
const KEY = "iq-install-asked";

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own sheet after the first finished session
    deferred = e as BIPEvent;
    listeners.forEach((l) => l());
  });
}

export function isStandalone() {
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
}

export function isIOS() {
  return typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** Whether to offer install now: never asked, not installed, and the browser can install. */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  let asked = true;
  try {
    asked = localStorage.getItem(KEY) === "1";
  } catch {}
  const canPrompt = !!deferred;
  const ios = isIOS();
  return {
    offer: !asked && !isStandalone() && (canPrompt || ios),
    ios: ios && !canPrompt,
    async install() {
      try {
        localStorage.setItem(KEY, "1");
      } catch {}
      if (deferred) {
        await deferred.prompt();
        deferred = null;
      }
    },
    later() {
      try {
        localStorage.setItem(KEY, "1");
      } catch {}
      force((n) => n + 1);
    },
  };
}
