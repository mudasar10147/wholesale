/**
 * Analysis periods and calendar-month bucketing for Business Intelligence.
 *
 * Builds on `lib/profit/periods` (the app's existing local-time bounds helpers)
 * rather than re-deriving day boundaries.
 */
import { getCurrentMonthBounds, parseLocalDateInput } from "@/lib/profit/periods";

export type AnalysisPeriodId =
  | "current_month"
  | "last_month"
  | "last_3_months"
  | "last_6_months"
  | "last_12_months"
  | "custom";

export type ForecastHorizonId = "1" | "3" | "6" | "12";

export type DateRange = {
  start: Date;
  end: Date;
};

export type AnalysisPeriod = DateRange & {
  id: AnalysisPeriodId;
  label: string;
  description: string;
  /** Inclusive local-calendar days in the range. */
  days: number;
  /** True while the range's end is in the future (i.e. the period is still running). */
  isPartial: boolean;
  /** Same-length range immediately before `start`, for period-over-period comparison. */
  previous: DateRange;
};

export const ANALYSIS_PERIOD_OPTIONS: readonly { id: AnalysisPeriodId; label: string }[] = [
  { id: "current_month", label: "Current month" },
  { id: "last_month", label: "Last month" },
  { id: "last_3_months", label: "Last 3 months" },
  { id: "last_6_months", label: "Last 6 months" },
  { id: "last_12_months", label: "Last 12 months" },
  { id: "custom", label: "Custom range" },
];

export const FORECAST_HORIZON_OPTIONS: readonly { id: ForecastHorizonId; label: string; months: number }[] = [
  { id: "1", label: "Next month", months: 1 },
  { id: "3", label: "3 months", months: 3 },
  { id: "6", label: "6 months", months: 6 },
  { id: "12", label: "12 months", months: 12 },
];

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Inclusive local-calendar day count; never below 1 so it is always a safe divisor. */
export function dayCount(start: Date, end: Date): number {
  const ms = startOfLocalDay(end).getTime() - startOfLocalDay(start).getTime();
  return Math.max(1, Math.floor(ms / MS_PER_DAY) + 1);
}

/** `YYYY-MM` for the local calendar month containing `d`. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyFromParts(year: number, monthIndex: number): string {
  const normalized = new Date(year, monthIndex, 1);
  return monthKey(normalized);
}

/** Human month label, e.g. `Aug 2026`. */
export function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function monthBounds(key: string): DateRange | null {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return {
    start: new Date(y, m - 1, 1, 0, 0, 0, 0),
    end: new Date(y, m, 0, 23, 59, 59, 999),
  };
}

/** Number of days in the local calendar month of `key`. */
export function daysInMonthKey(key: string): number {
  const bounds = monthBounds(key);
  if (!bounds) return 30;
  return bounds.end.getDate();
}

/** Ordered `YYYY-MM` keys from `start`'s month through `end`'s month, inclusive. */
export function monthKeysBetween(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  let guard = 0;
  while (cursor.getTime() <= last.getTime() && guard < 600) {
    keys.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
    guard += 1;
  }
  return keys;
}

/** `key` advanced by `offset` calendar months (offset may be negative). */
export function shiftMonthKey(key: string, offset: number): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return monthKeyFromParts(y, m - 1 + offset);
}

function rangeOfWholeMonths(now: Date, monthsBack: number, includeCurrent: boolean): DateRange {
  const endMonth = includeCurrent
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startMonth = new Date(endMonth.getFullYear(), endMonth.getMonth() - (monthsBack - 1), 1);
  const end = includeCurrent
    ? endOfLocalDay(now)
    : new Date(endMonth.getFullYear(), endMonth.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start: startMonth, end };
}

function previousRangeOfSameLength(range: DateRange): DateRange {
  const days = dayCount(range.start, range.end);
  const prevEnd = new Date(range.start.getTime() - 1);
  const prevStartDay = startOfLocalDay(new Date(prevEnd.getTime() - (days - 1) * MS_PER_DAY));
  return { start: prevStartDay, end: prevEnd };
}

function describeRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export type CustomRangeInput = { startInput: string; endInput: string };

/**
 * Resolve an analysis period selection into concrete local bounds plus the
 * matching prior period. Returns null only for an unparseable custom range.
 */
export function resolveAnalysisPeriod(
  id: AnalysisPeriodId,
  now = new Date(),
  custom?: CustomRangeInput,
): AnalysisPeriod | null {
  let range: DateRange;
  let label: string;

  if (id === "current_month") {
    range = getCurrentMonthBounds(now);
    range = { start: range.start, end: endOfLocalDay(now) };
    label = "Current month";
  } else if (id === "last_month") {
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    range = {
      start: prevMonthStart,
      end: new Date(prevMonthStart.getFullYear(), prevMonthStart.getMonth() + 1, 0, 23, 59, 59, 999),
    };
    label = "Last month";
  } else if (id === "last_3_months") {
    range = rangeOfWholeMonths(now, 3, true);
    label = "Last 3 months";
  } else if (id === "last_6_months") {
    range = rangeOfWholeMonths(now, 6, true);
    label = "Last 6 months";
  } else if (id === "last_12_months") {
    range = rangeOfWholeMonths(now, 12, true);
    label = "Last 12 months";
  } else {
    const start = custom ? parseLocalDateInput(custom.startInput) : null;
    const end = custom ? parseLocalDateInput(custom.endInput) : null;
    if (!start || !end || start.getTime() > end.getTime()) return null;
    range = { start: startOfLocalDay(start), end: endOfLocalDay(end) };
    label = "Custom range";
  }

  return {
    id,
    label,
    description: describeRange(range.start, range.end),
    start: range.start,
    end: range.end,
    days: dayCount(range.start, range.end),
    // The period is still running when its last day is today or later.
    isPartial: startOfLocalDay(range.end).getTime() >= startOfLocalDay(now).getTime(),
    previous: previousRangeOfSameLength(range),
  };
}

/** Elapsed / total days of the local calendar month containing `now`. */
export function currentMonthProgress(now = new Date()): {
  key: string;
  daysElapsed: number;
  daysInMonth: number;
  fractionElapsed: number;
} {
  const key = monthKey(now);
  const daysInMonth = daysInMonthKey(key);
  const daysElapsed = Math.min(daysInMonth, now.getDate());
  return {
    key,
    daysElapsed,
    daysInMonth,
    fractionElapsed: daysElapsed / daysInMonth,
  };
}
