/** Local calendar bounds for Firestore range queries on `date` fields. */

export function getTodayBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

export function getCurrentMonthBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/** Jan 1 through Dec 31 (local time) for the same calendar year as `now`. */
export function getCurrentYearBounds(now = new Date()): { start: Date; end: Date } {
  const y = now.getFullYear();
  const start = new Date(y, 0, 1, 0, 0, 0, 0);
  const end = new Date(y, 11, 31, 23, 59, 59, 999);
  return { start, end };
}

/** Parses yyyy-mm-dd date input into a local Date at start of day. */
export function parseLocalDateInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Inclusive local day range for start/end date input strings. */
export function getBoundsFromDateInputs(
  startInput: string,
  endInput: string,
): { start: Date; end: Date } | null {
  const startDate = parseLocalDateInput(startInput);
  const endDate = parseLocalDateInput(endInput);
  if (!startDate || !endDate) return null;
  if (startDate.getTime() > endDate.getTime()) return null;
  const start = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
    0,
    0,
    0,
    0,
  );
  const end = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
    23,
    59,
    59,
    999,
  );
  return { start, end };
}

/** Monday 00:00 through Sunday 23:59:59 for the week containing `date` (local). */
export function getCalendarWeekBounds(date = new Date()): { start: Date; end: Date } {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = day.getDay(); // 0 Sun … 6 Sat
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(day);
  monday.setDate(day.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human-readable Mon–Sun range, e.g. "Jun 2 – Jun 8, 2026". */
export function formatCalendarWeekLabel(start: Date, end: Date): string {
  const y = end.getFullYear();
  const startPart = formatShortDate(start);
  const endPart = formatShortDate(end);
  if (start.getFullYear() === y) {
    return `${startPart} – ${endPart}, ${y}`;
  }
  return `${startPart}, ${start.getFullYear()} – ${endPart}, ${y}`;
}

/**
 * Reference Mon–Sun week for inventory velocity.
 * Mon–Sat: last completed route week (previous Mon–Sun).
 * Sunday: current Mon–Sun (full weekly cycle including today).
 */
export function getInventoryVelocityWeekBounds(now = new Date()): {
  start: Date;
  end: Date;
  label: string;
} {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = today.getDay();
  const { start: thisMonday, end: thisSunday } = getCalendarWeekBounds(today);

  if (dow === 0) {
    return {
      start: thisMonday,
      end: thisSunday,
      label: formatCalendarWeekLabel(thisMonday, thisSunday),
    };
  }

  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const prevSunday = new Date(thisSunday);
  prevSunday.setDate(prevSunday.getDate() - 7);
  return {
    start: prevMonday,
    end: prevSunday,
    label: formatCalendarWeekLabel(prevMonday, prevSunday),
  };
}
