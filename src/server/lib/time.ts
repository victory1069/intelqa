/** All streaks, daily challenges and weekly boards run on Lagos time (UTC+1, no DST). */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** YYYY-MM-DD in Lagos for the given instant. */
export function lagosDate(at: Date = new Date()): string {
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Start of the current week (Monday 00:00 Lagos) as a UTC instant. */
export function lagosWeekStart(at: Date = new Date()): Date {
  const local = new Date(at.getTime() + LAGOS_OFFSET_MS);
  const dow = (local.getUTCDay() + 6) % 7; // Mon = 0
  local.setUTCDate(local.getUTCDate() - dow);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - LAGOS_OFFSET_MS);
}

/** Next Lagos midnight as a UTC instant. */
export function nextLagosMidnight(at: Date = new Date()): Date {
  const local = new Date(at.getTime() + LAGOS_OFFSET_MS);
  local.setUTCHours(24, 0, 0, 0);
  return new Date(local.getTime() - LAGOS_OFFSET_MS);
}
