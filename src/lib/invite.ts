"use client";

const KEY = "iq-invite";

export function inviteUrl(code: string) {
  return `${typeof window !== "undefined" ? window.location.origin : ""}/join/${code}`;
}

/** Remember a friend's invite code until the new student has finished setup. */
export function rememberInvite(code: string) {
  try {
    localStorage.setItem(KEY, code);
  } catch {}
}

export function takeInvite(): string | null {
  try {
    const c = localStorage.getItem(KEY);
    if (c) localStorage.removeItem(KEY);
    return c;
  } catch {
    return null;
  }
}
