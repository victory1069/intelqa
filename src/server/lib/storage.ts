import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";
import { fail } from "./http";

/**
 * File storage with two drivers:
 *  - supabase: Supabase Storage (production). `uploads` is private, `question-images` is public.
 *  - local:    a folder on this machine, served by GET /api/files/:bucket/* (laptop testing).
 * The rest of the app only calls putObject / getObject / signedUrl / publicImageUrl.
 */

let admin: SupabaseClient | null = null;

/** Service-role Supabase client. Server only. */
export function supabaseAdmin(): SupabaseClient {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) fail(503, "Storage is not configured");
  admin ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/* ── Local driver ── */

// turbopackIgnore: this is a runtime data folder, not code; don't trace the project into the bundle.
const ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), env.LOCAL_STORAGE_DIR);

/** Resolves bucket/key under the storage root, refusing anything that escapes it. */
export function localPath(bucket: string, key: string) {
  if (![env.STORAGE_BUCKET_UPLOADS, env.STORAGE_BUCKET_IMAGES].includes(bucket)) fail(404, "Not found");
  const full = path.resolve(ROOT, bucket, key);
  if (!full.startsWith(path.resolve(ROOT, bucket) + path.sep)) fail(400, "Bad path");
  return full;
}

// Signs private file links. CRON_SECRET if set; otherwise a per-process key (links die on restart, which is fine locally).
const SIGNING_KEY = env.CRON_SECRET ?? randomBytes(32).toString("hex");
const sign = (bucket: string, key: string, exp: number) =>
  createHmac("sha256", SIGNING_KEY).update(`${bucket}/${key}:${exp}`).digest("base64url");

export function verifyLocalToken(bucket: string, key: string, token: string | undefined) {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now() / 1000 || !sig) return false;
  const want = Buffer.from(sign(bucket, key, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

const fileUrl = (bucket: string, key: string) => `/api/files/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

/* ── API used by the app ── */

export async function putObject(bucket: string, key: string, body: ArrayBuffer | Buffer, contentType: string) {
  if (env.storage === "local") {
    const full = localPath(bucket, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(body as ArrayBuffer));
    return key;
  }
  const { error } = await supabaseAdmin().storage.from(bucket).upload(key, body, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return key;
}

export async function getObject(bucket: string, key: string): Promise<Buffer> {
  if (env.storage === "local") {
    try {
      return await readFile(localPath(bucket, key));
    } catch {
      throw new Error(`File is missing from local storage: ${key}`);
    }
  }
  const { data, error } = await supabaseAdmin().storage.from(bucket).download(key);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function signedUrl(bucket: string, key: string, expiresInSec = 60 * 60) {
  if (env.storage === "local") {
    const exp = Math.floor(Date.now() / 1000) + expiresInSec;
    return `${fileUrl(bucket, key)}?t=${exp}.${sign(bucket, key, exp)}`;
  }
  const { data, error } = await supabaseAdmin().storage.from(bucket).createSignedUrl(key, expiresInSec);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Question images live in a public bucket so the service worker can cache them. */
export function publicImageUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (env.storage === "local") return fileUrl(env.STORAGE_BUCKET_IMAGES, key);
  if (!env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${env.STORAGE_BUCKET_IMAGES}/${key}`;
}
