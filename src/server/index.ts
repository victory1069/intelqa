import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { env } from "./env";
import { auth } from "./middleware/auth";
import { requireAdmin, requireSuper } from "./middleware/admin";
import { catalogRoutes } from "./routes/catalog";
import { paperRoutes } from "./routes/papers";
import { attemptRoutes } from "./routes/attempts";
import { leaderboardRoutes } from "./routes/leaderboard";
import { meRoutes } from "./routes/me";
import { questionRoutes } from "./routes/questions";
import { challengeRoutes, publicChallengeRoutes } from "./routes/challenges";
import { quizRoutes } from "./routes/quizzes";
import { adminQuizRoutes } from "./routes/admin/quizzes";
import { adminUploadRoutes } from "./routes/admin/uploads";
import { adminPaperRoutes } from "./routes/admin/papers";
import { adminQuestionRoutes } from "./routes/admin/questions";
import { adminInsightRoutes } from "./routes/admin/insights";
import { superRoutes } from "./routes/admin/super";
import { runDaily, runEvening, runMorning } from "./jobs/daily";
import { fileRoutes } from "./routes/files";
import type { AppEnv } from "./types";

/**
 * The whole API. Routes stay thin (validate, call a service, return JSON);
 * the logic lives in services/. Mounted by Next.js at /api.
 */
export const app = new Hono<AppEnv>().basePath("/api");

if (env.NODE_ENV !== "production") app.use(logger());

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error("[api]", c.req.method, c.req.path, err);
  return c.json({ error: "Something went wrong on our side. Try again." }, 500);
});
app.notFound((c) => c.json({ error: "Not found" }, 404));

/* Public */
app.get("/health", (c) => c.json({ ok: true, time: new Date() }));
app.route("/public/challenges", publicChallengeRoutes);
// Local storage driver only: question images are public, upload scans need a signed link.
app.route("/files", fileRoutes);

/** Daily cron: called by pg_cron, a GitHub Action, or Vercel Cron with the shared secret. */
app.post("/jobs/daily", async (c) => {
  const secret = c.req.header("authorization")?.replace(/^Bearer /, "");
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) return c.json({ error: "Forbidden" }, 403);
  return c.json(await runDaily());
});

/** Morning cron (8 am Lagos): the daily pop quiz push. GET too, since Vercel Cron calls with GET. */
const morning = async (c: Context<AppEnv>) => {
  const secret = c.req.header("authorization")?.replace(/^Bearer /, "");
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) return c.json({ error: "Forbidden" }, 403);
  return c.json(await runMorning());
};
app.post("/jobs/morning", morning);
app.get("/jobs/morning", morning);

/** Evening cron (8 pm Lagos): streak reminders. Same secret as the daily job. */
app.post("/jobs/evening", async (c) => {
  const secret = c.req.header("authorization")?.replace(/^Bearer /, "");
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) return c.json({ error: "Forbidden" }, 403);
  return c.json(await runEvening());
});

/* Signed in */
app.use("/catalog/*", auth);
app.use("/papers/*", auth);
app.use("/papers", auth);
app.use("/attempts/*", auth);
app.use("/attempts", auth);
app.use("/leaderboard", auth);
app.use("/me/*", auth);
app.use("/me", auth);
app.use("/questions/*", auth);
app.use("/challenges/*", auth);
app.use("/challenges", auth);
app.use("/quizzes/*", auth);
app.use("/quizzes", auth);
app.use("/admin/*", auth, requireAdmin);

app.route("/catalog", catalogRoutes);
app.route("/papers", paperRoutes);
app.route("/attempts", attemptRoutes);
app.route("/leaderboard", leaderboardRoutes);
app.route("/me", meRoutes);
app.route("/questions", questionRoutes);
app.route("/challenges", challengeRoutes);
app.route("/quizzes", quizRoutes);

/* Admin */
app.route("/admin/uploads", adminUploadRoutes);
app.route("/admin/papers", adminPaperRoutes);
app.route("/admin/questions", adminQuestionRoutes);
app.route("/admin/quizzes", adminQuizRoutes);
app.route("/admin", adminInsightRoutes);

/* Super admin */
for (const p of ["/admin/catalogue", "/admin/institutions/*", "/admin/institutions", "/admin/faculties", "/admin/departments", "/admin/courses/*", "/admin/courses", "/admin/topics/*", "/admin/admins/*", "/admin/admins", "/admin/invites/*", "/admin/moderation/*", "/admin/students/*"]) {
  app.use(p, requireSuper);
}
app.route("/admin", superRoutes);

export type AppType = typeof app;
