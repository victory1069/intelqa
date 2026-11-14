"use client";
import { supabase, DEV_AUTH } from "./supabase";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** True when the request never reached the server. */
    public offline = false,
  ) {
    super(message);
  }
}

export const DEV_USER_KEY = "iq-dev-user";

export function devUser(): string | null {
  if (!DEV_AUTH || typeof window === "undefined") return null;
  try {
    return localStorage.getItem(DEV_USER_KEY);
  } catch {
    return null;
  }
}

export async function authHeaders(): Promise<Record<string, string>> {
  const dev = devUser();
  if (dev) return { "x-dev-user": dev };
  const sb = supabase();
  if (!sb) return {};
  const { data } = await sb.auth.getSession();
  return data.session ? { authorization: `Bearer ${data.session.access_token}` } : {};
}

type Init = { method?: string; body?: unknown; signal?: AbortSignal };

/** Calls the API under /api. JSON in, JSON out; errors become ApiError with the server's message. */
export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = await authHeaders();
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: init.method ?? "GET", headers, body, signal: init.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "No connection. Check your data and try again.", true);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = (data && typeof data === "object" && "error" in data && String((data as { error: unknown }).error)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}
