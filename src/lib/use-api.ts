"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { odb } from "./offline";

type State<T> = {
  /** The path this state belongs to, so a changed path never shows the old data. */
  path: string | null;
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Set when showing a saved copy because the live request failed. */
  staleAt: number | null;
};

async function fetchWithFallback<T>(path: string): Promise<Omit<State<T>, "path" | "loading">> {
  try {
    const data = await api<T>(path);
    odb().cache.put({ path, data, at: Date.now() }).catch(() => {});
    return { data, error: null, staleAt: null };
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, String(e));
    if (err.offline || err.status >= 500) {
      const saved = await odb().cache.get(path).catch(() => undefined);
      if (saved) return { data: saved.data as T, error: err, staleAt: saved.at };
    }
    return { data: null, error: err, staleAt: null };
  }
}

/**
 * GET with an offline fallback: every good response is saved, and when the network or
 * server fails the last saved copy is shown with `staleAt` set.
 */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ path, data: null, error: null, loading: !!path, staleAt: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    (async () => {
      // Show a saved copy straight away while the live request runs.
      const saved = await odb().cache.get(path).catch(() => undefined);
      if (cancelled) return;
      setState((s) => ({ path, data: s.path === path && s.data ? s.data : ((saved?.data as T) ?? null), error: null, loading: true, staleAt: null }));
      const r = await fetchWithFallback<T>(path);
      if (cancelled) return;
      setState((s) => ({ path, loading: false, ...r, data: r.data ?? (s.path === path ? s.data : null) }));
    })();
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const mutate = useCallback((fn: (d: T | null) => T | null) => setState((s) => ({ ...s, data: fn(s.data) })), []);

  // While a new path loads, never show the previous path's data.
  const fresh = state.path === path;
  return {
    data: fresh ? state.data : null,
    error: fresh ? state.error : null,
    loading: !!path && (!fresh || state.loading),
    staleAt: fresh ? state.staleAt : null,
    reload,
    mutate,
  };
}
