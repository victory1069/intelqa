"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { supabase } from "./supabase";
import { odb } from "./offline";
import type { Me } from "./types";

type Status = "loading" | "signedOut" | "signedIn";

/** Email, or a phone in +234… form. */
export type Contact = { email: string } | { phone: string };

type AuthCtx = {
  status: Status;
  me: Me | null;
  /** Reload /me, e.g. after onboarding or a profile change. */
  refresh: () => Promise<Me | null>;
  setMe: (me: Me) => void;
  /** Which step follows the email: a password, or a one-time code (new accounts). */
  lookup: (contact: Contact) => Promise<"password" | "code">;
  /** Emails (or texts) a one-time code. Also carries a link that signs in the same way. */
  sendCode: (contact: Contact) => Promise<void>;
  /** Checks the code. With `reset`, the account is then asked for a new password. */
  verifyCode: (contact: Contact, code: string, opts?: { reset?: boolean }) => Promise<void>;
  signInWithPassword: (contact: Contact, password: string) => Promise<void>;
  /** Sets the signed-in account's password and records it. */
  setPassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Set when /me failed with "suspended". */
  suspended: string | null;
  /** E12: the student was signed in, but the session ran out (not a sign-out they chose). */
  expired: boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

const ME_CACHE = "/me";

/** Supabase's wording, in ours. */
export function authMessage(raw: string) {
  if (/rate|too many|security purposes|over_email_send/i.test(raw)) return "Too many tries. Wait a few minutes, then try again.";
  if (/invalid login credentials/i.test(raw)) return "That password isn't right. Try again, or reset it.";
  if (/token.*(expired|invalid)|otp.*(expired|invalid)/i.test(raw)) return "That code is wrong or has expired. Check the latest email, or send a new code.";
  if (/phone provider|sms/i.test(raw)) return "Phone sign-in isn't available yet. Use your email instead.";
  if (/should be different/i.test(raw)) return "Pick a password you haven't used for this account before.";
  if (/weak|at least|characters/i.test(raw)) return "That password is too weak. Use at least 8 characters, mixing letters and numbers.";
  if (/fetch|network/i.test(raw)) return "No connection. Check your data and try again.";
  return raw;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() => (typeof window !== "undefined" && !supabase() ? "signedOut" : "loading"));
  const [me, setMe] = useState<Me | null>(null);
  const [suspended, setSuspended] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const leaving = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>("/me");
      setMe(m);
      setExpired(false);
      setStatus("signedIn");
      odb().cache.put({ path: ME_CACHE, data: m, at: Date.now() }).catch(() => {});
      return m;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        // Signed in before on this phone → the session expired. Offline results stay in IndexedDB.
        const had = await odb().cache.get(ME_CACHE).catch(() => undefined);
        if (had) {
          setExpired(true);
          await odb().cache.delete(ME_CACHE).catch(() => {});
        }
        setMe(null);
        setStatus("signedOut");
        return null;
      }
      if (err.status === 403 && /suspended/i.test(err.message)) {
        setSuspended(err.message);
        setStatus("signedIn");
        return null;
      }
      // Offline or server down: keep the student signed in with their saved profile.
      const saved = await odb().cache.get(ME_CACHE).catch(() => undefined);
      if (saved) {
        setMe(saved.data as Me);
        setStatus("signedIn");
        return saved.data as Me;
      }
      setStatus("signedOut");
      return null;
    }
  }, []);

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    // getSession also picks up a session from an email link (the tokens in the URL).
    sb.auth.getSession().then(({ data }) => {
      if (data.session) refresh();
      else setStatus("signedOut");
    });
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        // A session that arrived later (an email link opened in this tab). Supabase asks for no
        // awaited auth calls inside this callback, so the profile loads on the next tick.
        setTimeout(() => refresh(), 0);
      } else if (event === "SIGNED_OUT") {
        if (!leaving.current) setExpired(true);
        leaving.current = false;
        setMe(null);
        setStatus("signedOut");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const client = () => {
    const sb = supabase();
    if (!sb) throw new Error("Sign-in isn't set up yet. Add the Supabase keys to .env.local.");
    return sb;
  };

  const lookup = useCallback(async (contact: Contact) => {
    const r = await api<{ method: "password" | "code" }>("/auth/lookup", { method: "POST", body: contact });
    return r.method;
  }, []);

  const sendCode = useCallback(async (contact: Contact) => {
    const sb = client();
    const { error } =
      "phone" in contact
        ? await sb.auth.signInWithOtp({ phone: contact.phone })
        : await sb.auth.signInWithOtp({ email: contact.email, options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/sign-in` } });
    if (error) throw new Error(authMessage(error.message));
  }, []);

  const verifyCode = useCallback(
    async (contact: Contact, token: string, opts: { reset?: boolean } = {}) => {
      const sb = client();
      const { error } =
        "phone" in contact
          ? await sb.auth.verifyOtp({ phone: contact.phone, token, type: "sms" })
          : await sb.auth.verifyOtp({ email: contact.email, token, type: "email" });
      if (error) throw new Error(authMessage(error.message));
      if (opts.reset) {
        // Signed in by the code: clear the flag so the app asks for the new password next.
        const m = await api<Me>("/me/password", { method: "POST", body: { set: false } }).catch(() => null);
        if (m) {
          setMe(m);
          setStatus("signedIn");
          return;
        }
      }
      await refresh();
    },
    [refresh],
  );

  const signInWithPassword = useCallback(
    async (contact: Contact, password: string) => {
      const { error } = await client().auth.signInWithPassword({ ...contact, password } as { email: string; password: string });
      if (error) throw new Error(authMessage(error.message));
      await refresh();
    },
    [refresh],
  );

  const setPassword = useCallback(async (password: string) => {
    const { error } = await client().auth.updateUser({ password });
    if (error) throw new Error(authMessage(error.message));
    const m = await api<Me>("/me/password", { method: "POST", body: { set: true } });
    setMe(m);
    odb().cache.put({ path: ME_CACHE, data: m, at: Date.now() }).catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    leaving.current = true;
    setExpired(false);
    await supabase()?.auth.signOut();
    await odb().cache.clear().catch(() => {});
    setMe(null);
    setStatus("signedOut");
  }, []);

  const value = useMemo(
    () => ({ status, me, refresh, setMe, lookup, sendCode, verifyCode, signInWithPassword, setPassword, signOut, suspended, expired }),
    [status, me, refresh, lookup, sendCode, verifyCode, signInWithPassword, setPassword, signOut, suspended, expired],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
