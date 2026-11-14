import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { fail } from "../lib/http";
import { shortCode } from "../lib/random";
import type { AppEnv, User } from "../types";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Phones become digits only (2348000000000); emails lowercase. Invites are stored the same way. */
export function normaliseContact(c: string) {
  return c.includes("@") ? c.trim().toLowerCase() : c.replace(/\D/g, "");
}

/** If a super admin invited this phone/email, grant the role on first sign-in. */
async function applyAdminInvite(user: User): Promise<User> {
  const contacts = [user.phone && normaliseContact(user.phone), user.email && normaliseContact(user.email)].filter(Boolean) as string[];
  if (!contacts.length) return user;
  const [invite] = await db.select().from(schema.adminInvites).where(inArray(schema.adminInvites.contact, contacts));
  if (!invite) return user;
  const [updated] = await db.update(schema.users).set({ role: invite.role }).where(eq(schema.users.id, user.id)).returning();
  if (invite.courseIds.length) {
    await db
      .insert(schema.adminCourses)
      .values(invite.courseIds.map((courseId) => ({ userId: user.id, courseId })))
      .onConflictDoNothing();
  }
  await db.delete(schema.adminInvites).where(eq(schema.adminInvites.id, invite.id));
  return updated;
}

async function verifySupabaseToken(token: string): Promise<JWTPayload> {
  if (env.SUPABASE_JWT_SECRET) {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET));
    return payload;
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL) fail(500, "Auth is not configured");
  jwks ??= createRemoteJWKSet(new URL(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, jwks);
  return payload;
}

/**
 * Verifies the Supabase JWT and attaches the user row. First request after sign-up
 * creates the row (onboarded = false). Suspended accounts get 403 with the reason.
 */
export const auth = createMiddleware<AppEnv>(async (c, next) => {
  let userId: string | undefined;
  let phone: string | undefined;
  let email: string | undefined;

  const devUser = c.req.header("x-dev-user");
  if (env.DEV_AUTH && devUser) {
    userId = devUser;
  } else {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) fail(401, "Sign in to continue");
    try {
      const payload = await verifySupabaseToken(header.slice(7));
      userId = payload.sub;
      phone = typeof payload.phone === "string" && payload.phone ? payload.phone : undefined;
      email = typeof payload.email === "string" && payload.email ? payload.email : undefined;
    } catch {
      fail(401, "Your session has expired. Sign in again.");
    }
  }
  if (!userId) fail(401, "Sign in to continue");

  let [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    [user] = await db
      .insert(schema.users)
      .values({ id: userId, phone, email, inviteCode: shortCode(7) })
      .onConflictDoNothing()
      .returning();
    user ??= (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0];
    user = await applyAdminInvite(user);
  }
  if (user.suspended) {
    // The ref lets support find the account without the student sharing their phone or email.
    fail(403, `This account is suspended. ${user.suspendReason ?? ""} [ref:SUS-${user.id.replace(/-/g, "").slice(0, 6).toUpperCase()}]`.replace(/\s+/g, " "));
  }

  c.set("user", user);
  await next();
});
