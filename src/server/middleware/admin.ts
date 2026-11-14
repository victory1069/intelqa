import { createMiddleware } from "hono/factory";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { fail } from "../lib/http";
import type { AppEnv, User } from "../types";

/** Blocks anyone who isn't a content admin or super admin. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const role = c.get("user").role;
  if (role !== "content_admin" && role !== "super_admin") fail(403, "Admins only");
  await next();
});

/** Blocks anyone who isn't a super admin. */
export const requireSuper = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("user").role !== "super_admin") {
    fail(403, "Only super admins can see this. Ask a super admin if you need it.");
  }
  await next();
});

/** Content admins may only touch the courses they were assigned. */
export async function assertCourseAccess(user: User, courseId: string) {
  if (user.role === "super_admin") return;
  const [row] = await db
    .select()
    .from(schema.adminCourses)
    .where(and(eq(schema.adminCourses.userId, user.id), eq(schema.adminCourses.courseId, courseId)));
  if (!row) fail(403, "You don't manage this course");
}

export async function adminCourseIds(user: User): Promise<string[] | "all"> {
  if (user.role === "super_admin") return "all";
  const rows = await db.select().from(schema.adminCourses).where(eq(schema.adminCourses.userId, user.id));
  return rows.map((r) => r.courseId);
}
