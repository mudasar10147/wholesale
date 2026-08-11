/**
 * Core financial formulas for Business Intelligence.
 *
 * Every function here is pure, divide-by-zero safe, and returns `null` rather
 * than a misleading number when the inputs cannot support the calculation.
 *
 * Definitions (kept deliberately explicit — margin and markup are NOT the same):
 *   Gross profit    = Revenue − COGS
 *   Gross margin %  = Gross profit / Revenue × 100      (selling-price basis)
 *   Markup %        = Gross profit / COGS × 100         (cost basis)
 *   Net profit      = Gross profit − Operating expenses
 *   Turnover        = COGS / Average inventory
 *   Inventory days  = Average inventory / COGS × days
 *   Receivable days = Average receivables / Credit sales × days
 *   Payable days    = Average payables / Purchases × days
 *   CCC             = Inventory days + Receivable days − Payable days
 *
 * Net profit follows the accounting model TradeBridge already uses on the
 * dashboard (`computeProfitBreakdown`): sales − COGS − expenses. Inventory
 * bought is a cash outflow, not an expense, so purchases never appear here.
 */

export function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Safe division: null when the denominator is zero, negative-zero, or not finite. */
export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

export function grossProfit(revenue: number, cogs: number): number {
  return roundMoney2((Number.isFinite(revenue) ? revenue : 0) - (Number.isFinite(cogs) ? cogs : 0));
}

/** Gross profit as a % of revenue. Null when revenue is zero or negative. */
export function grossMarginPct(revenue: number, cogs: number): number | null {
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  return ((revenue - cogs) / revenue) * 100;
}

/** Gross profit as a % of cost. Null when COGS is zero or negative. */
export function markupPct(revenue: number, cogs: number): number | null {
  if (!Number.isFinite(cogs) || cogs <= 0) return null;
  return ((revenue - cogs) / cogs) * 100;
}

/** Net profit = gross profit − operating expenses. */
export function netProfit(revenue: number, cogs: number, expenses: number): number {
  return roundMoney2(grossProfit(revenue, cogs) - (Number.isFinite(expenses) ? expenses : 0));
}

export function netMarginPct(revenue: number, cogs: number, expenses: number): number | null {
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  return (netProfit(revenue, cogs, expenses) / revenue) * 100;
}

/** COGS as a fraction of revenue (1 − gross margin). Null when revenue ≤ 0. */
export function cogsRatio(revenue: number, cogs: number): number | null {
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  const ratio = cogs / revenue;
  return Number.isFinite(ratio) ? ratio : null;
}

/** Operating expenses as a % of revenue. Null when revenue ≤ 0. */
export function expenseRatioPct(revenue: number, expenses: number): number | null {
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  return (expenses / revenue) * 100;
}

/**
 * Percentage change from `from` to `to`.
 * Null when the base is zero or negative — a % change off a zero base is meaningless.
 */
export function percentChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from <= 0) return null;
  return ((to - from) / from) * 100;
}

/** Inventory turnover = COGS ÷ average inventory, for whatever period the COGS covers. */
export function inventoryTurnover(cogs: number, averageInventory: number): number | null {
  if (!Number.isFinite(averageInventory) || averageInventory <= 0) return null;
  if (!Number.isFinite(cogs) || cogs <= 0) return null;
  return cogs / averageInventory;
}

/** Days of stock on hand = average inventory ÷ COGS × days in period. */
export function inventoryDays(
  cogs: number,
  averageInventory: number,
  periodDays: number,
): number | null {
  if (!Number.isFinite(cogs) || cogs <= 0) return null;
  if (!Number.isFinite(averageInventory) || averageInventory < 0) return null;
  if (!Number.isFinite(periodDays) || periodDays <= 0) return null;
  return (averageInventory / cogs) * periodDays;
}

/** Days customers take to pay = average receivables ÷ credit sales × days in period. */
export function receivableDays(
  creditSales: number,
  averageReceivables: number,
  periodDays: number,
): number | null {
  if (!Number.isFinite(creditSales) || creditSales <= 0) return null;
  if (!Number.isFinite(averageReceivables) || averageReceivables < 0) return null;
  if (!Number.isFinite(periodDays) || periodDays <= 0) return null;
  return (averageReceivables / creditSales) * periodDays;
}

/** Days we take to pay suppliers = average payables ÷ purchases × days in period. */
export function payableDays(
  purchases: number,
  averagePayables: number,
  periodDays: number,
): number | null {
  if (!Number.isFinite(purchases) || purchases <= 0) return null;
  if (!Number.isFinite(averagePayables) || averagePayables < 0) return null;
  if (!Number.isFinite(periodDays) || periodDays <= 0) return null;
  return (averagePayables / purchases) * periodDays;
}

/**
 * Cash conversion cycle. Any null input makes the cycle null — a partial cycle
 * would silently understate how long cash is tied up.
 */
export function cashConversionCycle(
  invDays: number | null,
  recDays: number | null,
  payDays: number | null,
): number | null {
  if (invDays === null || recDays === null || payDays === null) return null;
  return invDays + recDays - payDays;
}

/**
 * Break-even revenue = fixed costs ÷ contribution margin ratio.
 * Contribution margin ratio = gross margin − variable-expense ratio, both as fractions
 * of revenue. Null when contribution is zero or negative (no revenue level breaks even).
 */
export function breakEvenRevenue(
  fixedCosts: number,
  grossMarginFraction: number,
  variableExpenseFraction: number,
): number | null {
  if (!Number.isFinite(fixedCosts) || fixedCosts < 0) return null;
  const contribution = grossMarginFraction - variableExpenseFraction;
  if (!Number.isFinite(contribution) || contribution <= 0) return null;
  return fixedCosts / contribution;
}

/** How far current revenue sits above break-even, as a % of current revenue. */
export function marginOfSafetyPct(currentRevenue: number, breakEven: number | null): number | null {
  if (breakEven === null || !Number.isFinite(currentRevenue) || currentRevenue <= 0) return null;
  return ((currentRevenue - breakEven) / currentRevenue) * 100;
}

/**
 * Revenue needed to hit a target net profit.
 * revenue × (grossMargin − variableRate) − fixed = target
 * Null when contribution is non-positive (no revenue level reaches the target).
 */
export function revenueForTargetNetProfit(
  targetNetProfit: number,
  grossMarginFraction: number,
  variableExpenseFraction: number,
  fixedExpenses: number,
): number | null {
  if (!Number.isFinite(targetNetProfit)) return null;
  const contribution = grossMarginFraction - variableExpenseFraction;
  if (!Number.isFinite(contribution) || contribution <= 0) return null;
  const required = (targetNetProfit + fixedExpenses) / contribution;
  return Number.isFinite(required) && required >= 0 ? required : null;
}

/**
 * Working capital needed to sustain a given monthly cost of goods sold over a
 * cash conversion cycle: the cash is locked up for `cycleDays` before it returns.
 */
export function workingCapitalRequired(
  monthlyCogs: number,
  cycleDays: number | null,
  daysPerMonth = 30,
): number | null {
  if (cycleDays === null || !Number.isFinite(cycleDays)) return null;
  if (!Number.isFinite(monthlyCogs) || monthlyCogs < 0) return null;
  if (cycleDays <= 0) return 0;
  return (monthlyCogs * cycleDays) / daysPerMonth;
}

/**
 * The inverse: how much monthly COGS a pot of working capital can sustain.
 * Null when the cycle is unknown; `Infinity` is never returned — a cycle of zero
 * or less means capital is not the binding constraint, reported as null.
 */
export function cogsCapacityFromWorkingCapital(
  workingCapital: number,
  cycleDays: number | null,
  daysPerMonth = 30,
): number | null {
  if (cycleDays === null || !Number.isFinite(cycleDays) || cycleDays <= 0) return null;
  if (!Number.isFinite(workingCapital) || workingCapital <= 0) return 0;
  return (workingCapital * daysPerMonth) / cycleDays;
}

/** Revenue implied by a COGS capacity at a given COGS-to-revenue ratio. */
export function revenueFromCogs(cogs: number, ratio: number | null): number | null {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return null;
  if (!Number.isFinite(cogs) || cogs < 0) return null;
  return cogs / ratio;
}

/** Arithmetic mean, null for an empty list. */
export function mean(values: readonly number[]): number | null {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

/** Median, null for an empty list. Resistant to a single unusual month. */
export function median(values: readonly number[]): number | null {
  const usable = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (usable.length === 0) return null;
  const mid = Math.floor(usable.length / 2);
  return usable.length % 2 === 0 ? (usable[mid - 1]! + usable[mid]!) / 2 : usable[mid]!;
}

/** Population standard deviation. Null for fewer than two points. */
export function stdDev(values: readonly number[]): number | null {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length < 2) return null;
  const avg = usable.reduce((a, b) => a + b, 0) / usable.length;
  const variance = usable.reduce((acc, v) => acc + (v - avg) ** 2, 0) / usable.length;
  return Math.sqrt(variance);
}

/** Clamp helper used to keep growth rates and ratios inside believable bounds. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
