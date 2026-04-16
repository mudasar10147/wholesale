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
