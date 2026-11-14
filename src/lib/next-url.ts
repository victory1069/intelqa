"use client";

const KEY = "iq-next";

/** Where to send the student after sign-in and setup (e.g. back to a friend's challenge). */
export function setNext(path: string) {
  try {
    localStorage.setItem(KEY, path);
  } catch {}
}

export function takeNext(fallback: string) {
  try {
    const p = localStorage.getItem(KEY);
    if (p && p.startsWith("/")) {
      localStorage.removeItem(KEY);
      return p;
    }
  } catch {}
  return fallback;
}
