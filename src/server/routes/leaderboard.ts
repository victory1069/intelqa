import { Hono } from "hono";
import { z } from "zod";
import { parse, fail } from "../lib/http";
import { lagosDate, lagosWeekStart, nextLagosMidnight } from "../lib/time";
import { courseBoard, dailyBoard, friendsBoard, xpBoard } from "../services/leaderboard";
import type { AppEnv } from "../types";

export const leaderboardRoutes = new Hono<AppEnv>();

const Query = z.object({
  board: z.enum(["course", "department", "institution", "friends", "daily"]),
  course: z.string().uuid().optional(),
  period: z.enum(["week", "all"]).default("week"),
  metric: z.enum(["xp", "course"]).default("xp"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** GET /leaderboard?board=&course=&period=&metric= — top 10 plus 5 above and below the student. */
leaderboardRoutes.get("/", async (c) => {
  const user = c.get("user");
  const q = parse(Query, c.req.query());
  const nextWeek = new Date(lagosWeekStart().getTime() + 7 * 864e5);

  switch (q.board) {
    case "course": {
      if (!q.course) fail(422, "course is required");
      return c.json({ ...(await courseBoard(q.course, user.id)), rankedBy: "course_score", resets: "semester" });
    }
    case "department": {
      if (!user.departmentId) fail(409, "Pick your department first");
      return c.json({ ...(await xpBoard({ departmentId: user.departmentId }, q.period, user.id)), rankedBy: "xp", resetsAt: q.period === "week" ? nextWeek : null });
    }
    case "institution": {
      if (!user.institutionId) fail(409, "Pick your school first");
      return c.json({ ...(await xpBoard({ institutionId: user.institutionId }, q.period, user.id)), rankedBy: "xp", resetsAt: q.period === "week" ? nextWeek : null });
    }
    case "friends": {
      return c.json({ ...(await friendsBoard(user.id, q.metric, q.course)), rankedBy: q.metric === "course" ? "course_score" : "xp", resetsAt: nextWeek });
    }
    case "daily": {
      if (!q.course) fail(422, "course is required");
      const date = q.date ?? lagosDate();
      return c.json({ ...(await dailyBoard(q.course, date, user.id)), rankedBy: "score_then_time", date, resetsAt: nextLagosMidnight() });
    }
  }
});
