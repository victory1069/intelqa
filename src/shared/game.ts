/** Game rules shared by the API and the app. Change them here only. */

export const XP = {
  perAnswered: 1,
  perCorrectBonus: 2,
  examCompletionBonus: 20,
} as const;

/** Streak multiplier applied to a session's XP. */
export function streakMultiplier(streakDays: number): number {
  if (streakDays >= 30) return 1.5;
  if (streakDays >= 7) return 1.25;
  if (streakDays >= 3) return 1.1;
  return 1;
}

export const STREAK_LADDER = [
  { days: 3, multiplier: 1.1 },
  { days: 7, multiplier: 1.25 },
  { days: 30, multiplier: 1.5 },
] as const;

/** Earn one freeze per completed 7-day block. */
export const FREEZE_EVERY_DAYS = 7;
export const MAX_FREEZES = 2;

/** Minimum ranked attempts before a student appears on a course board. */
export const MIN_RANKED_ATTEMPTS = 3;
/** Course score = weighted average of the best N recent ranked attempts. */
export const COURSE_SCORE_BEST_N = 5;
export const COURSE_SCORE_WINDOW = 10;

/** Fair play: under this many seconds per question with high accuracy is held for review. */
export const FAST_SECONDS_PER_QUESTION = 3;
export const FAST_MIN_ACCURACY = 0.9;

export const LEVELS = [
  { n: 1, name: "JJC", xp: 0 },
  { n: 2, name: "Jambite", xp: 150 },
  { n: 3, name: "Fresher", xp: 500 },
  { n: 4, name: "Library Rat", xp: 1200 },
  { n: 5, name: "Night Reader", xp: 2500 },
  { n: 6, name: "Carryover Dodger", xp: 4000 },
  { n: 7, name: "Course Rep Material", xp: 6000 },
  { n: 8, name: "First Class Loading", xp: 9000 },
  { n: 9, name: "Departmental Oracle", xp: 13000 },
  { n: 10, name: "Past Question Plug", xp: 18000 },
] as const;

export function levelFor(totalXp: number) {
  let current: (typeof LEVELS)[number] = LEVELS[0];
  for (const l of LEVELS) if (totalXp >= l.xp) current = l;
  const next = LEVELS.find((l) => l.xp > totalXp) ?? null;
  return { ...current, next, toNext: next ? next.xp - totalXp : 0 };
}

export const BADGES = [
  { key: "clean_sheet", name: "Clean Sheet", sub: "First perfect score", glyph: "star" },
  { key: "week_one", name: "Week One", sub: "7-day streak", glyph: "flame" },
  { key: "first_blood", name: "First Blood", sub: "First exam finished", glyph: "timer" },
  { key: "early_bird", name: "Early Bird", sub: "10 drills before 8 am", glyph: "sun" },
  { key: "thousand_club", name: "Thousand Club", sub: "1,000 answered", glyph: "bolt" },
  { key: "paper_chaser", name: "Paper Chaser", sub: "Every paper in a course", glyph: "file" },
  { key: "month_mode", name: "Month Mode", sub: "30-day streak", glyph: "calendar" },
  { key: "giant_slayer", name: "Giant Slayer", sub: "Win a friend challenge", glyph: "trophy" },
  { key: "night_crawler", name: "Night Crawler", sub: "50 sessions after 11 pm", glyph: "moon" },
  { key: "plug", name: "Plug", sub: "5 friends joined via you", glyph: "users" },
] as const;
export type BadgeKey = (typeof BADGES)[number]["key"];

export const MODES = {
  exam: { label: "Exam simulation", ranked: true },
  drill: { label: "Quick drill", ranked: true },
  topic: { label: "Topic practice", ranked: false },
  retry: { label: "Retry mistakes", ranked: false },
  daily: { label: "Daily challenge", ranked: false },
  challenge: { label: "Friend challenge", ranked: false },
  quiz: { label: "Practice test", ranked: false },
} as const;
export type Mode = keyof typeof MODES;

/** Drill sizes and their timers (seconds). */
export const DRILL_SIZES = { 10: 8 * 60, 20: 16 * 60 } as const;
export const DAILY_SIZE = 10;
export const DAILY_TIME_SEC = 8 * 60;

/** Admin-set practice tests: questions per test, and the time limit range in minutes. */
export const QUIZ_MAX_QUESTIONS = 25;
export const QUIZ_MIN_QUESTIONS = 5;
export const QUIZ_MAX_MINUTES = 120;

export const LETTERS = ["A", "B", "C", "D", "E"] as const;
