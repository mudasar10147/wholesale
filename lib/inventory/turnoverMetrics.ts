/**
 * Inventory velocity metrics — how fast stock converts to sales (COGS).
 */

/** Days in a Mon–Sun route week. */
export const CALENDAR_WEEK_DAYS = 7;

/** Inclusive calendar days between start and end (local dates). */
export function periodDayCount(start: Date, end: Date): number {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const ms = endDay.getTime() - startDay.getTime();
  return Math.max(1, Math.floor(ms / (24 * 60 * 60 * 1000)) + 1);
}

export type WeeklyInventoryVelocity = {
  weekLabel: string;
  weekStart: Date;
  weekEnd: Date;
  weeklyCogs: number;
  /** weeklyCogs ÷ 7 — average daily pace across the full route week. */
  avgDailyCogs: number | null;
  daysToSellInventory: number | null;
  weeksToSellInventory: number | null;
  annualizedTurnover: number | null;
};

/**
 * Days / weeks to sell using one Mon–Sun week's COGS (all routes in that week).
 *
 * avgDailyCogs = weeklyCogs / 7
 * daysToSell = inventoryAtLotCost / avgDailyCogs
 */
export function computeWeeklyInventoryVelocity(
  inventoryAtLotCost: number,
  weeklyCogs: number,
  week: { start: Date; end: Date; label: string },
): WeeklyInventoryVelocity {
  if (
    !Number.isFinite(inventoryAtLotCost) ||
    inventoryAtLotCost <= 0 ||
    !Number.isFinite(weeklyCogs) ||
    weeklyCogs <= 0
  ) {
    return {
      weekLabel: week.label,
      weekStart: week.start,
      weekEnd: week.end,
      weeklyCogs: Number.isFinite(weeklyCogs) ? weeklyCogs : 0,
      avgDailyCogs: null,
      daysToSellInventory: null,
      weeksToSellInventory: null,
      annualizedTurnover: null,
    };
  }

  const avgDailyCogs = weeklyCogs / CALENDAR_WEEK_DAYS;
  const daysToSellInventory = inventoryAtLotCost / avgDailyCogs;
  const weeksToSellInventory = daysToSellInventory / CALENDAR_WEEK_DAYS;
  const annualizedTurnover = (weeklyCogs / inventoryAtLotCost) * (365 / CALENDAR_WEEK_DAYS);

  return {
    weekLabel: week.label,
    weekStart: week.start,
    weekEnd: week.end,
    weeklyCogs,
    avgDailyCogs,
    daysToSellInventory,
    weeksToSellInventory,
    annualizedTurnover,
  };
}

/** @deprecated Use {@link WeeklyInventoryVelocity}. */
export type RollingInventoryVelocity = WeeklyInventoryVelocity;

/** @deprecated Use {@link computeWeeklyInventoryVelocity}. */
export function computeRollingInventoryVelocity(
  inventoryAtLotCost: number,
  cogsInWindow: number,
  windowDays: number,
): WeeklyInventoryVelocity {
  const window = Math.max(1, Math.floor(windowDays));
  const start = new Date();
  const end = new Date();
  return computeWeeklyInventoryVelocity(inventoryAtLotCost, cogsInWindow, {
    start,
    end,
    label: `Last ${window} days`,
  });
}

export function formatInventoryDays(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "—";
  if (days >= 100) return `${Math.round(days)} days`;
  if (days >= 10) return `${Math.round(days)} days`;
  return `${days.toFixed(1)} days`;
}

export function formatInventoryWeeks(weeks: number | null): string {
  if (weeks === null || !Number.isFinite(weeks)) return "—";
  if (weeks >= 10) return `${Math.round(weeks)} weeks`;
  return `${weeks.toFixed(1)} weeks`;
}

export function formatTurnoverRatio(turns: number | null): string {
  if (turns === null || !Number.isFinite(turns)) return "—";
  if (turns >= 10) return `${turns.toFixed(1)}×`;
  return `${turns.toFixed(2)}×`;
}

/** Short hint for days-to-sell (wholesale rule of thumb). */
export function inventoryDaysHealthHint(days: number | null): string | undefined {
  if (days === null || !Number.isFinite(days)) return undefined;
  if (days <= 14) return "Fast turnover — stock is moving quickly.";
  if (days <= 45) return "Healthy range for most wholesale SKUs.";
  if (days <= 90) return "Slow — consider reducing buys or pushing sales.";
  return "Very slow — capital tied up in stock for a long time.";
}
