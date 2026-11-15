"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

/** Browser Supabase client, or null when Supabase isn't configured (dev mode). */
export function supabase(): SupabaseClient | null {
  if (!url || !anon || url.includes("YOUR-PROJECT")) return null;
  client ??= createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}
