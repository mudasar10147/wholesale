/**
 * Display formatting for Business Intelligence.
 *
 * Money uses the same grouping/decimal rules as the rest of TradeBridge
 * (`formatMoney` in the dashboard cards) and adds the "Rs." prefix that the
 * BI screens show explicitly.
 */

/** Bare number, same rules as the dashboard's `formatMoney`. */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** `Rs. 1,234.5` — the canonical BI money format. Null/NaN render as an em dash. */
export function formatPkr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const negative = n < 0;
  const body = formatAmount(Math.abs(n));
  return negative ? `−Rs. ${body}` : `Rs. ${body}`;
}

/** Rounded to whole rupees — for large projected figures where paisa is noise. */
export function formatPkrCompactWhole(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return formatPkr(Math.round(n));
}

/** Signed money, e.g. `+Rs. 65,000` / `−Rs. 4,200`. Zero renders unsigned. */
export function formatPkrDelta(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const rounded = Math.round(n);
  if (rounded === 0) return `Rs. 0`;
  const body = formatAmount(Math.abs(rounded));
  return `${rounded > 0 ? "+" : "−"}Rs. ${body}`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** Signed percent, e.g. `+13.0%`. */
export function formatPercentDelta(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/** Percentage *points* difference, e.g. `+0.5 pp` — never confused with a % change. */
export function formatPercentagePoints(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)} pp`;
}

export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return `${Math.round(value)} days`;
  return `${value.toFixed(1)} days`;
}

export function formatTurns(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 10) return `${value.toFixed(1)}×`;
  return `${value.toFixed(2)}×`;
}

export function formatUnits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** "3 months" / "1 month" / "over 5 years" — for projected timelines. */
export function formatMonthsToTarget(months: number | null | undefined): string {
  if (months === null || months === undefined || !Number.isFinite(months)) return "Not reachable at the current trajectory";
  if (months <= 0) return "Already reached";
  if (months > 60) return "More than 5 years";
  const rounded = Math.ceil(months);
  return `${rounded} month${rounded === 1 ? "" : "s"}`;
}
