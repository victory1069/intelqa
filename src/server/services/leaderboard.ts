import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/client";
import { lagosWeekStart } from "../lib/time";
import { MIN_RANKED_ATTEMPTS } from "@/shared/game";

export type BoardRow = {
  rank: number;
  userId: string;
  name: string;
  value: number;
  /** Secondary value: time in seconds on the daily board. */
  extra?: number | null;
  me: boolean;
};

export type Board = {
  total: number;
  me: BoardRow | null;
  top: BoardRow[];
  /** Up to 5 above and 5 below the student. Empty when the student is in the top 10 or unranked. */
  around: BoardRow[];
};

type RawRow = { rn: number; rank: number; user_id: string; name: string | null; value: number; extra: number | null; total: number };

/**
 * Wraps a "ranked" subquery (must select user_id, name, value, extra, rank, rn)
 * and returns the top 10 plus a window of 5 above and below the user.
 */
async function windowed(ranked: SQL, userId: string): Promise<Board> {
  const rows = await db.execute<RawRow>(sql`
    with ranked as (${ranked}),
         counted as (select *, count(*) over ()::int as total from ranked),
         mine as (select rn from counted where user_id = ${userId})
    select * from counted
    where rn <= 10
       or rn between coalesce((select rn from mine), -100) - 5 and coalesce((select rn from mine), -100) + 5
    order by rn
  `);
  const mapped = Array.from(rows).map((r) => ({
    rn: Number(r.rn),
    total: Number(r.total),
    row: {
      rank: Number(r.rank),
      userId: r.user_id,
      name: r.name ?? "Student",
      value: Number(r.value),
      extra: r.extra == null ? null : Number(r.extra),
      me: r.user_id === userId,
    } satisfies BoardRow,
  }));
  const me = mapped.find((m) => m.row.me) ?? null;
  return {
    total: mapped[0]?.total ?? 0,
    me: me?.row ?? null,
    top: mapped.filter((m) => m.rn <= 10).map((m) => m.row),
    around: me && me.rn > 10 ? mapped.filter((m) => m.rn > 10).map((m) => m.row) : [],
  };
}

/** Course board: course score, min 3 ranked attempts, resets each semester (stats are per course). */
export function courseBoard(courseId: string, userId: string) {
  return windowed(
    sql`
      select s.user_id, u.display_name as name, s.course_score as value, null::int as extra,
             rank() over (order by s.course_score desc)::int as rank,
             row_number() over (order by s.course_score desc, s.updated_at asc)::int as rn
      from user_course_stats s join users u on u.id = s.user_id
      where s.course_id = ${courseId} and s.ranked_attempts >= ${MIN_RANKED_ATTEMPTS}
        and not u.hidden_from_boards and not u.suspended
    `,
    userId,
  );
}

/** Department or institution board: total XP, this week or all time. */
export function xpBoard(scope: { departmentId?: string; institutionId?: string }, period: "week" | "all", userId: string) {
  const since = period === "week" ? lagosWeekStart() : new Date(0);
  const scopeFilter = scope.departmentId
    ? sql`u.department_id = ${scope.departmentId}`
    : sql`u.institution_id = ${scope.institutionId}`;
  return windowed(
    sql`
      select u.id as user_id, u.display_name as name, sum(x.amount)::int as value, null::int as extra,
             rank() over (order by sum(x.amount) desc)::int as rank,
             row_number() over (order by sum(x.amount) desc, u.id)::int as rn
      from xp_events x join users u on u.id = x.user_id
      where ${scopeFilter} and x.created_at >= ${since.toISOString()}::timestamptz
        and not u.hidden_from_boards and not u.suspended
      group by u.id, u.display_name
    `,
    userId,
  );
}

/** Friends board: weekly XP or a course score, the student's choice. Includes the student. */
export function friendsBoard(userId: string, metric: "xp" | "course", courseId?: string) {
  const circle = sql`(select friend_id from friendships where user_id = ${userId} union select ${userId}::uuid)`;
  if (metric === "course" && courseId) {
    return windowed(
      sql`
        select u.id as user_id, u.display_name as name, coalesce(s.course_score, 0) as value, null::int as extra,
               rank() over (order by coalesce(s.course_score, 0) desc)::int as rank,
               row_number() over (order by coalesce(s.course_score, 0) desc, u.id)::int as rn
        from users u left join user_course_stats s on s.user_id = u.id and s.course_id = ${courseId}
        where u.id in ${circle}
      `,
      userId,
    );
  }
  const since = lagosWeekStart();
  return windowed(
    sql`
      select u.id as user_id, u.display_name as name, coalesce(sum(x.amount), 0)::int as value, null::int as extra,
             rank() over (order by coalesce(sum(x.amount), 0) desc)::int as rank,
             row_number() over (order by coalesce(sum(x.amount), 0) desc, u.id)::int as rn
      from users u left join xp_events x on x.user_id = u.id and x.created_at >= ${since.toISOString()}::timestamptz
      where u.id in ${circle}
      group by u.id, u.display_name
    `,
    userId,
  );
}

/** Daily challenge board: score, then time taken as the tie-break. */
export function dailyBoard(courseId: string, date: string, userId: string) {
  return windowed(
    sql`
      select a.user_id, u.display_name as name, a.score as value, a.time_taken_sec as extra,
             rank() over (order by a.score desc, a.time_taken_sec asc)::int as rank,
             row_number() over (order by a.score desc, a.time_taken_sec asc, a.submitted_at asc)::int as rn
      from attempts a join users u on u.id = a.user_id
      where a.mode = 'daily' and a.course_id = ${courseId} and a.daily_date = ${date}
        and a.submitted_at is not null and a.counts_for_board
        and not u.hidden_from_boards and not u.suspended
    `,
    userId,
  );
}

/** The student's current rank on a course board, or null if unranked. */
export async function courseRank(courseId: string, userId: string): Promise<{ rank: number; total: number } | null> {
  const rows = await db.execute<{ rank: number; total: number }>(sql`
    with ranked as (
      select s.user_id, rank() over (order by s.course_score desc)::int as rank, count(*) over ()::int as total
      from user_course_stats s join users u on u.id = s.user_id
      where s.course_id = ${courseId} and s.ranked_attempts >= ${MIN_RANKED_ATTEMPTS} and not u.hidden_from_boards
    )
    select rank, total from ranked where user_id = ${userId}
  `);
  const r = Array.from(rows)[0];
  return r ? { rank: Number(r.rank), total: Number(r.total) } : null;
}
