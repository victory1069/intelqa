"use client";
import { api } from "./api";
import { isIOS, isStandalone } from "./install";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const ASKED = "iq-push-asked";

function b64ToBytes(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Push works here: browser support, a key configured, and on iPhone only once installed. */
export function pushSupported() {
  if (typeof window === "undefined" || !VAPID) return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return false;
  if (isIOS() && !isStandalone()) return false;
  return true;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}

async function registration() {
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  return reg;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

/** Asks the browser (only after the student tapped "Turn on"), then saves the subscription. */
export async function enablePush(): Promise<"on" | "denied" | "unsupported"> {
  markAsked();
  if (!pushSupported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID!) }));
  await api("/me/push", { method: "POST", body: sub.toJSON() });
  return "on";
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("/me/push", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

export function markAsked() {
  try {
    localStorage.setItem(ASKED, "1");
  } catch {}
}

/** A21 is shown once, and only where the browser could actually say yes. */
export function shouldAskForPush() {
  try {
    return pushSupported() && Notification.permission === "default" && localStorage.getItem(ASKED) !== "1";
  } catch {
    return false;
  }
}
