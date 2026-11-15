import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail, parse } from "../lib/http";
import type { AppEnv } from "../types";

const { users } = schema;

export const authRoutes = new Hono<AppEnv>();

/** Small in-memory limit so the lookup can't be used to sweep through emails. Per server instance. */
const hits = new Map<string, { n: number; since: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 30;

function limited(key: string) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.since > WINDOW_MS) {
    hits.set(key, { n: 1, since: now });
    return false;
  }
  h.n++;
  return h.n > MAX_PER_WINDOW;
}

const Body = z.union([z.object({ email: z.string().trim().email() }), z.object({ phone: z.string().trim().min(8).max(20) })]);

/**
 * POST /auth/lookup — which step comes after the email: "password" for accounts that have
 * set one, "code" for new accounts (and older ones that never set a password).
 * Never says whether an email exists beyond that.
 */
authRoutes.post("/lookup", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "local";
  if (limited(ip)) fail(429, "Too many tries. Wait a few minutes and try again.");
  const b = parse(Body, await c.req.json());
  const [u] =
    "email" in b
      ? await db.select({ set: users.passwordSet }).from(users).where(sql`lower(${users.email}) = ${b.email.toLowerCase()}`).limit(1)
      : await db.select({ set: users.passwordSet }).from(users).where(sql`regexp_replace(${users.phone}, '\\D', '', 'g') = ${b.phone.replace(/\D/g, "")}`).limit(1);
  return c.json({ method: u?.set ? "password" : "code" });
});
