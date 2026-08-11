/**
 * Inventory efficiency and the inventory-growth forecast.
 *
 * Four quantities that are easy to conflate are kept strictly separate:
 *   • inventory on hand      — stock sitting in the warehouse right now, at lot cost
 *   • monthly purchases      — stock bought during a month (`stock_in` lot receipts)
 *   • purchasing capacity    — what cash and collections allow us to buy next month
 *   • working capital        — the total capital tied up in the trading cycle
 */
import { inventoryTurnover, roundMoney2, safeDivide } from "@/lib/bi/finance";

export type InventoryEfficiency = {
  /** COGS ÷ average inventory over the period. */
  turnoverForPeriod: number | null;
  /** The same, expressed per 30-day month. */
  turnoverPerMonth: number | null;
  /** Average days a rupee of stock waits before it sells. */
  holdingDays: number | null;
  /** Monthly sales generated per Rs. 100,000 of inventory capital. */
  salesPerHundredThousand: number | null;
  averageInventory: number | null;
  currentInventoryAtCost: number;
  periodDays: number;
  rotationSentence: string;
};

export function buildInventoryEfficiency(params: {
  cogs: number;
  revenue: number;
  averageInventory: number | null;
  currentInventoryAtCost: number;
  periodDays: number;
}): InventoryEfficiency {
  const { cogs, revenue, averageInventory, currentInventoryAtCost, periodDays } = params;
  const turnoverForPeriod =
    averageInventory === null ? null : inventoryTurnover(cogs, averageInventory);
  const turnoverPerMonth =
    turnoverForPeriod === null || periodDays <= 0
      ? null
      : turnoverForPeriod * (30 / periodDays);
  const holdingDays =
    turnoverForPeriod === null || turnoverForPeriod <= 0 ? null : periodDays / turnoverForPeriod;

  const monthlyRevenue = periodDays > 0 ? (revenue / periodDays) * 30 : 0;
  const perRupee = averageInventory === null ? null : safeDivide(monthlyRevenue, averageInventory);
  const salesPerHundredThousand = perRupee === null ? null : perRupee * 100_000;

  const rotationSentence =
    salesPerHundredThousand === null
      ? "Capital rotation needs recorded stock cost and sales in this period before it can be measured."
      : `Every Rs. 100,000 held in inventory is currently generating about ${formatRupees(salesPerHundredThousand)} of sales per month.`;

  return {
    turnoverForPeriod,
    turnoverPerMonth,
    holdingDays,
    salesPerHundredThousand,
    averageInventory,
    currentInventoryAtCost,
    periodDays,
    rotationSentence,
  };
}

function formatRupees(value: number): string {
  return `Rs. ${Math.round(value).toLocaleString()}`;
}

export type InventoryGrowthPoint = {
  monthOffset: number;
  label: string;
  /** Stock on hand at the end of the month, at cost. */
  inventoryOnHand: number;
  /** Stock bought during the month. */
  purchases: number;
  /** What cash allows us to buy that month. */
  purchasingCapacity: number;
  /** Change in the inventory capital base vs the month before. */
  capitalIncrease: number;
  growthPct: number | null;
};

export type InventoryGrowthForecast = {
  currentInventoryAtCost: number;
  nextMonthPurchasingCapacity: number;
  nextMonthCapitalIncrease: number;
  nextMonthGrowthPct: number | null;
  points: InventoryGrowthPoint[];
};

/**
 * Turn a compounding projection into the inventory view. Inventory only grows by
 * the profit that is put back in; the rest of each month's buying simply replaces
 * what was sold, which is why replenishment and growth are shown separately.
 */
export function buildInventoryGrowthForecast(params: {
  currentInventoryAtCost: number;
  months: readonly {
    monthOffset: number;
    label: string;
    cogs: number;
    reinvestedProfit: number;
    purchasingCapacity: number;
  }[];
}): InventoryGrowthForecast {
  const points: InventoryGrowthPoint[] = [];
  let inventory = Math.max(0, params.currentInventoryAtCost);

  for (const month of params.months) {
    const previousInventory = inventory;
    // Replenishment replaces what was sold; only reinvested profit grows the base.
    const capitalIncrease = Math.max(0, month.reinvestedProfit);
    const purchases = roundMoney2(Math.max(0, month.cogs) + capitalIncrease);
    inventory = roundMoney2(previousInventory + capitalIncrease);
    points.push({
      monthOffset: month.monthOffset,
      label: month.label,
      inventoryOnHand: inventory,
      purchases,
      purchasingCapacity: roundMoney2(month.purchasingCapacity),
      capitalIncrease: roundMoney2(capitalIncrease),
      growthPct:
        previousInventory > 0 ? ((inventory - previousInventory) / previousInventory) * 100 : null,
    });
  }

  const first = points[0];
  return {
    currentInventoryAtCost: roundMoney2(params.currentInventoryAtCost),
    nextMonthPurchasingCapacity: first?.purchasingCapacity ?? 0,
    nextMonthCapitalIncrease: first?.capitalIncrease ?? 0,
    nextMonthGrowthPct: first?.growthPct ?? null,
    points,
  };
}
