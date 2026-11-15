import { z } from "zod";

/**
 * Reads and validates server env vars once. Import `env` anywhere on the server.
 * Never import this file from client components.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  /** Set to 1 when DATABASE_URL points at the local PGlite server (npm run db:local). */
  DATABASE_LOCAL: z.string().optional().transform((v) => v === "1" || v === "true"),

  // Supabase: OTP auth + storage
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /** Legacy HS256 JWT secret. If unset, tokens are verified against the project's JWKS. */
  SUPABASE_JWT_SECRET: z.string().optional(),
  STORAGE_BUCKET_UPLOADS: z.string().default("uploads"),
  STORAGE_BUCKET_IMAGES: z.string().default("question-images"),
  /**
   * Where uploaded files live. "auto" uses Supabase Storage when SUPABASE_SERVICE_ROLE_KEY is set,
   * otherwise a folder on this machine (LOCAL_STORAGE_DIR), served by /api/files. Local is for laptops only.
   */
  STORAGE_DRIVER: z.enum(["auto", "supabase", "local"]).default("auto"),
  LOCAL_STORAGE_DIR: z.string().default(".local-storage"),

  // Claude: document extraction + "Ask" follow-up
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  /**
   * How uploads are read. "auto" uses Claude when ANTHROPIC_API_KEY is set, else the built-in parser,
   * which handles typed DOCX/TXT/PDF papers (numbered questions, lettered options) but not photos.
   */
  EXTRACTOR: z.enum(["auto", "claude", "local"]).default("auto"),

  // Web push
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@intelqa.app"),

  /** Shared secret for the daily cron endpoint. */
  CRON_SECRET: z.string().optional(),

  /** Local dev only: accept `x-dev-user: <user id>` instead of a Supabase JWT. Ignored in production. */
  DEV_AUTH: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),

  ASK_DAILY_LIMIT: z.coerce.number().int().positive().default(5),
});

// `next build` loads the API route to collect page config, before any request runs. The host may
// not expose runtime secrets then, so a placeholder lets the build finish; real requests still need
// DATABASE_URL (postgres connects lazily, so nothing is opened during the build).
const building = process.env.NEXT_PHASE === "phase-production-build";
const parsed = schema.safeParse(building && !process.env.DATABASE_URL ? { ...process.env, DATABASE_URL: "postgres://build-placeholder" } : process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables. See .env.example.");
}

const d = parsed.data;
// The .env.example placeholder counts as "not set".
const supabaseUrl = d.NEXT_PUBLIC_SUPABASE_URL && !/YOUR-PROJECT/i.test(d.NEXT_PUBLIC_SUPABASE_URL) ? d.NEXT_PUBLIC_SUPABASE_URL : undefined;
const supabaseStorage = !!(supabaseUrl && d.SUPABASE_SERVICE_ROLE_KEY);

export const env = {
  ...d,
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  DEV_AUTH: d.DEV_AUTH && d.NODE_ENV !== "production",
  /** Resolved storage driver. */
  storage: (d.STORAGE_DRIVER === "auto" ? (supabaseStorage ? "supabase" : "local") : d.STORAGE_DRIVER) as "supabase" | "local",
  /** Resolved extractor. */
  extractor: (d.EXTRACTOR === "auto" ? (d.ANTHROPIC_API_KEY ? "claude" : "local") : d.EXTRACTOR) as "claude" | "local",
};

if (env.storage === "local" && env.NODE_ENV === "production" && !process.env.ALLOW_LOCAL_STORAGE) {
  console.warn("[env] Uploads are being stored on local disk in production. Set the Supabase keys, or ALLOW_LOCAL_STORAGE=1 if this is intended.");
}
