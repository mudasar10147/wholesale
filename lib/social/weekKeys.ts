/**
 * ISO-8601 week helpers. A week key looks like `2026-W29`; weeks start Monday and
 * week 1 is the one containing the first Thursday of the year.
 *
 * All arithmetic runs in UTC so a DST boundary inside the week cannot shift a day.
 * Results are converted back to local calendar dates, because the planner schedules
 * against the user's own calendar.
 */

export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function toLocalDate(utc: Date): Date {
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** Monday = 0 … Sunday = 6. */
function isoDayIndex(utc: Date): number {
  return (utc.getUTCDay() + 6) % 7;
}

/** The Monday that starts ISO week 1 of `isoYear`. */
function week1Monday(isoYear: number): Date {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  return new Date(Date.UTC(isoYear, 0, 4 - isoDayIndex(jan4)));
}

export function isoWeekKey(date: Date): string {
  const thursday = toUtcMidnight(date);
  thursday.setUTCDate(thursday.getUTCDate() - isoDayIndex(thursday) + 3);
  const isoYear = thursday.getUTCFullYear();
  const week = 1 + Math.round((thursday.getTime() - week1Monday(isoYear).getTime()) / MS_PER_WEEK) ;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function currentWeekKey(now = new Date()): string {
  return isoWeekKey(now);
}

export function parseWeekKey(weekKey: string): { isoYear: number; week: number } | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(week) || week < 1 || week > 53) return null;
  return { isoYear, week };
}

/** Local-calendar Monday that starts the given week. */
export function mondayOfWeekKey(weekKey: string): Date {
  const parsed = parseWeekKey(weekKey);
  if (!parsed) {
    throw new Error("Invalid week key.");
  }
  const monday = week1Monday(parsed.isoYear);
  monday.setUTCDate(monday.getUTCDate() + (parsed.week - 1) * 7);
  return toLocalDate(monday);
}

/** The seven local dates of the week, Monday first. */
export function weekDates(weekKey: string): Date[] {
  const monday = mondayOfWeekKey(weekKey);
  return WEEKDAY_KEYS.map((_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return day;
  });
}

/** Move `delta` weeks forward (or back, when negative). */
export function shiftWeekKey(weekKey: string, delta: number): string {
  const monday = mondayOfWeekKey(weekKey);
  monday.setDate(monday.getDate() + delta * 7);
  return isoWeekKey(monday);
}

/** Local calendar day as `YYYY-MM-DD` — never `toISOString()`, which shifts to UTC. */
export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function weekdayKeyOf(date: Date): WeekdayKey {
  return WEEKDAY_KEYS[(date.getDay() + 6) % 7]!;
}

export function formatWeekRange(weekKey: string): string {
  const days = weekDates(weekKey);
  const first = days[0]!;
  const last = days[6]!;
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${first.toLocaleDateString(undefined, opts)} – ${last.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
}
