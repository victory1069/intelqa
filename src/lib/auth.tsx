"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, DEV_USER_KEY, devUser } from "./api";
import { supabase, DEV_AUTH } from "./supabase";
import { odb } from "./offline";
import type { Me } from "./types";

type Status = "loading" | "signedOut" | "signedIn";

type AuthCtx = {
  status: Status;
  me: Me | null;
  /** Reload /me, e.g. after onboarding or a profile change. */
  refresh: () => Promise<Me | null>;
  setMe: (me: Me) => void;
  sendCode: (contact: { phone?: string; email?: string }) => Promise<void>;
  verifyCode: (contact: { phone?: string; email?: string }, code: string) => Promise<void>;
  devSignIn: (userId: string) => Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() =>
    typeof window !== "undefined" && !devUser() && !supabase() ? "signedOut" : "loading",
  );
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
    const hasDev = !!devUser();
    if (!hasDev && !sb) return;
    if (hasDev) {
      // refresh() only sets state after awaiting the network, so this doesn't render synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refresh();
      return;
    }
    sb!.auth.getSession().then(({ data }) => {
      if (data.session) refresh();
      else setStatus("signedOut");
    });
    const { data: sub } = sb!.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        if (!leaving.current) setExpired(true);
        leaving.current = false;
        setMe(null);
        setStatus("signedOut");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const sendCode = useCallback(async ({ phone, email }: { phone?: string; email?: string }) => {
    const sb = supabase();
    if (!sb) throw new Error("Sign-in isn't set up yet. Add the Supabase keys to .env.local.");
    const { error } = phone ? await sb.auth.signInWithOtp({ phone }) : await sb.auth.signInWithOtp({ email: email! });
    if (error) throw new Error(error.message);
  }, []);

  const verifyCode = useCallback(
    async ({ phone, email }: { phone?: string; email?: string }, token: string) => {
      const sb = supabase();
      if (!sb) throw new Error("Sign-in isn't set up yet.");
      const { error } = phone
        ? await sb.auth.verifyOtp({ phone, token, type: "sms" })
        : await sb.auth.verifyOtp({ email: email!, token, type: "email" });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const devSignIn = useCallback(
    async (userId: string) => {
      if (!DEV_AUTH) throw new Error("Dev sign-in is off");
      localStorage.setItem(DEV_USER_KEY, userId);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    leaving.current = true;
    setExpired(false);
    try {
      localStorage.removeItem(DEV_USER_KEY);
    } catch {}
    await supabase()?.auth.signOut();
    await odb().cache.clear().catch(() => {});
    setMe(null);
    setStatus("signedOut");
  }, []);

  const value = useMemo(
    () => ({ status, me, refresh, setMe, sendCode, verifyCode, devSignIn, signOut, suspended, expired }),
    [status, me, refresh, sendCode, verifyCode, devSignIn, signOut, suspended, expired],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
