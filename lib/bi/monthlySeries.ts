/**
 * Monthly history: the factual backbone every forecast and ratio is derived from.
 *
 * One pass over sales, expenses and stock lots produces a calendar-month series.
 * Revenue and COGS come from the `sales` collection exactly as the existing
 * dashboard reads them (returns are already stored as negative rows, so they net
 * out automatically), with void invoices excluded.
 *
 * Inventory value per month is *reconstructed*, not stored: TradeBridge keeps only
 * the live lot balances, so month-end inventory is rolled backwards from today's
 * known lot value using recorded receipts and recorded COGS. The result is flagged
 * as an estimate everywhere it is used.
 */
import type { ExpenseDoc, SaleDoc, StockLotDoc } from "@/lib/types/firestore";
import { num, timestampToDate, type WithId } from "@/lib/bi/dataset";
import {
  daysInMonthKey,
  monthKey,
  monthKeysBetween,
  formatMonthLabel,
} from "@/lib/bi/periods";
import { cogsRatio, grossMarginPct, roundMoney2 } from "@/lib/bi/finance";

export type MonthlyPoint = {
  key: string;
  label: string;
  /** Days in the calendar month. */
  daysInMonth: number;
  /** Days of the month that have actually happened (equals `daysInMonth` for past months). */
  daysElapsed: number;
  /** True while the month is still running — its totals are not comparable to a full month. */
  isPartial: boolean;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  /** Cost of stock received in the month from supplier receipts (`stock_in` lots only). */
  purchases: number;
  /** Cost of every lot received in the month, including opening balances and adjustments. */
  inventoryAdditions: number;
  /** Damaged stock written off through returns and discards. Informational — not in net profit. */
  writeOffs: number;
  unitsSold: number;
  /** Distinct posted invoices billed in the month. */
  orderCount: number;
  avgOrderValue: number | null;
  grossMarginPct: number | null;
  /** Reconstructed month-end inventory value at lot cost. Null when it cannot be rolled back. */
  endInventoryEstimate: number | null;
};

export type MonthlySeries = {
  points: MonthlyPoint[];
  /** Completed months only, oldest first — the input to every forecast. */
  completed: MonthlyPoint[];
  /** The month currently in progress, when the series reaches today. */
  current: MonthlyPoint | null;
  /** Months with any recorded revenue, expenses or purchases. */
  monthsWithActivity: number;
};

type SaleLike = Pick<SaleDoc, "product_id" | "quantity" | "cogs_amount" | "total_amount" | "invoice_id" | "original_invoice_id" | "customer_id"> & {
  date?: unknown;
};

/** Sale rows belonging to void invoices are excluded, matching `filterSalesForProfitReporting`. */
export function isReportableSale(
  sale: Pick<SaleDoc, "invoice_id" | "original_invoice_id">,
  voidInvoiceIds: ReadonlySet<string>,
): boolean {
  const invoiceId = sale.invoice_id ?? sale.original_invoice_id;
  if (typeof invoiceId === "string" && invoiceId.trim() && voidInvoiceIds.has(invoiceId.trim())) {
    return false;
  }
  return true;
}

/**
 * COGS for one sale row. Prefers the stored signed `cogs_amount` (written at post
 * time from the FIFO lots) and falls back to product cost × quantity only for
 * legacy rows that predate it — the same rule as `computeCogs`.
 */
export function saleCogs(sale: SaleLike, costByProductId: ReadonlyMap<string, number>): number {
  if (typeof sale.cogs_amount === "number" && Number.isFinite(sale.cogs_amount)) {
    return sale.cogs_amount;
  }
  const unit = costByProductId.get(sale.product_id) ?? 0;
  return unit * num(sale.quantity);
}

export function buildCostByProductId(
  products: readonly WithId<{ cost_price?: number }>[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const product of products) {
    map.set(product.id, num(product.data.cost_price));
  }
  return map;
}

type EmptyPointArgs = { key: string; now: Date };

function emptyPoint({ key, now }: EmptyPointArgs): MonthlyPoint {
  const daysInMonth = daysInMonthKey(key);
  const isCurrent = key === monthKey(now);
  const isFuture = key > monthKey(now);
  const daysElapsed = isCurrent ? Math.min(daysInMonth, now.getDate()) : isFuture ? 0 : daysInMonth;
  return {
    key,
    label: formatMonthLabel(key),
    daysInMonth,
    daysElapsed,
    isPartial: isCurrent || isFuture,
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    expenses: 0,
    netProfit: 0,
    purchases: 0,
    inventoryAdditions: 0,
    writeOffs: 0,
    unitsSold: 0,
    orderCount: 0,
    avgOrderValue: null,
    grossMarginPct: null,
    endInventoryEstimate: null,
  };
}

export type MonthlySeriesInput = {
  now: Date;
  /** First month to include. */
  from: Date;
  sales: readonly WithId<SaleDoc>[];
  expenses: readonly WithId<ExpenseDoc>[];
  stockLots: readonly WithId<StockLotDoc>[];
  voidInvoiceIds: ReadonlySet<string>;
  costByProductId: ReadonlyMap<string, number>;
  /** Damaged write-offs already bucketed by month key. */
  writeOffsByMonth?: ReadonlyMap<string, number>;
  /** Current inventory value at FIFO lot cost — the anchor for the roll-back. */
  currentInventoryAtLotCost: number;
};

/**
 * Build the calendar-month series from `from` through the month containing `now`.
 */
export function buildMonthlySeries(input: MonthlySeriesInput): MonthlySeries {
  const keys = monthKeysBetween(input.from, input.now);
  const byKey = new Map<string, MonthlyPoint>();
  for (const key of keys) {
    byKey.set(key, emptyPoint({ key, now: input.now }));
  }

  const invoiceIdsByMonth = new Map<string, Set<string>>();

  for (const row of input.sales) {
    if (!isReportableSale(row.data, input.voidInvoiceIds)) continue;
    const date = timestampToDate(row.data.date);
    if (!date) continue;
    const point = byKey.get(monthKey(date));
    if (!point) continue;

    point.revenue += num(row.data.total_amount);
    point.cogs += saleCogs(row.data, input.costByProductId);
    // Returns are stored as separate negative rows; their quantity stays positive,
    // so subtract returned units rather than adding them to units sold.
    const qty = num(row.data.quantity);
    point.unitsSold += row.data.sale_type === "return" ? -qty : qty;

    const invoiceId = row.data.invoice_id?.trim();
    if (invoiceId && row.data.sale_type !== "return") {
      let set = invoiceIdsByMonth.get(point.key);
      if (!set) {
        set = new Set<string>();
        invoiceIdsByMonth.set(point.key, set);
      }
      set.add(invoiceId);
    }
  }

  for (const row of input.expenses) {
    const date = timestampToDate(row.data.date);
    if (!date) continue;
    const point = byKey.get(monthKey(date));
    if (!point) continue;
    point.expenses += num(row.data.amount);
  }

  for (const row of input.stockLots) {
    const date = timestampToDate(row.data.received_at) ?? timestampToDate(row.data.created_at);
    if (!date) continue;
    const point = byKey.get(monthKey(date));
    if (!point) continue;
    const value = num(row.data.qty_in) * num(row.data.unit_cost);
    point.inventoryAdditions += value;
    if (row.data.source === "stock_in") {
      point.purchases += value;
    }
  }

  if (input.writeOffsByMonth) {
    for (const [key, value] of input.writeOffsByMonth) {
      const point = byKey.get(key);
      if (point) point.writeOffs += num(value);
    }
  }

  const points = keys.map((key) => {
    const point = byKey.get(key)!;
    point.revenue = roundMoney2(point.revenue);
    point.cogs = roundMoney2(point.cogs);
    point.expenses = roundMoney2(point.expenses);
    point.purchases = roundMoney2(point.purchases);
    point.inventoryAdditions = roundMoney2(point.inventoryAdditions);
    point.writeOffs = roundMoney2(point.writeOffs);
    point.grossProfit = roundMoney2(point.revenue - point.cogs);
    point.netProfit = roundMoney2(point.grossProfit - point.expenses);
    point.grossMarginPct = grossMarginPct(point.revenue, point.cogs);
    point.orderCount = invoiceIdsByMonth.get(key)?.size ?? 0;
    point.avgOrderValue = point.orderCount > 0 ? point.revenue / point.orderCount : null;
    return point;
  });

  applyInventoryRollback(points, input.currentInventoryAtLotCost);

  const completed = points.filter((p) => !p.isPartial);
  const current = points.find((p) => p.isPartial) ?? null;
  const monthsWithActivity = points.filter(
    (p) => p.revenue !== 0 || p.expenses !== 0 || p.purchases !== 0,
  ).length;

  return { points, completed, current, monthsWithActivity };
}

/**
 * Roll month-end inventory backwards from today's known lot value:
 *   end(m−1) = end(m) − additions(m) + cogs(m) + writeOffs(m)
 *
 * Physical recounts close lots without a matching negative receipt, so the
 * reconstruction can drift; values are clamped at zero and every consumer labels
 * them as estimates.
 */
function applyInventoryRollback(points: MonthlyPoint[], currentInventoryAtLotCost: number): void {
  if (points.length === 0) return;
  const anchor = Number.isFinite(currentInventoryAtLotCost) ? Math.max(0, currentInventoryAtLotCost) : 0;
  let running = anchor;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i]!;
    point.endInventoryEstimate = roundMoney2(Math.max(0, running));
    running = running - point.inventoryAdditions + point.cogs + point.writeOffs;
  }
}

/** Average inventory across a set of months, using the reconstructed month-end values. */
export function averageInventoryOver(
  points: readonly MonthlyPoint[],
  openingEstimate: number | null,
): number | null {
  const ends = points
    .map((p) => p.endInventoryEstimate)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (ends.length === 0) return null;
  const values = openingEstimate !== null && Number.isFinite(openingEstimate)
    ? [openingEstimate, ...ends]
    : ends;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export type PeriodTotals = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  purchases: number;
  writeOffs: number;
  unitsSold: number;
  orderCount: number;
  avgOrderValue: number | null;
  grossMarginPct: number | null;
  netMarginPct: number | null;
  cogsRatio: number | null;
};

export type RangeTotals = PeriodTotals & {
  /** Revenue billed on invoices — the part that becomes a receivable. */
  creditSales: number;
  /** Revenue taken as cash at the counter (`sales` rows with no invoice). */
  cashSales: number;
  /** Cost of stock received from suppliers inside the range. */
  purchases: number;
  days: number;
};

export type RangeTotalsInput = {
  start: Date;
  end: Date;
  sales: readonly WithId<SaleDoc>[];
  expenses: readonly WithId<ExpenseDoc>[];
  stockLots: readonly WithId<StockLotDoc>[];
  voidInvoiceIds: ReadonlySet<string>;
  costByProductId: ReadonlyMap<string, number>;
  writeOffsInRange?: number;
};

/**
 * Exact totals for an arbitrary date range, filtered at day precision rather than
 * by month bucket — so a custom range or a part-month is never over-counted.
 */
export function computeRangeTotals(input: RangeTotalsInput): RangeTotals {
  const startMs = input.start.getTime();
  const endMs = input.end.getTime();

  let revenue = 0;
  let cogs = 0;
  let creditSales = 0;
  let cashSales = 0;
  let unitsSold = 0;
  const invoiceIds = new Set<string>();

  for (const row of input.sales) {
    if (!isReportableSale(row.data, input.voidInvoiceIds)) continue;
    const date = timestampToDate(row.data.date);
    if (!date) continue;
    const ms = date.getTime();
    if (ms < startMs || ms > endMs) continue;

    const amount = num(row.data.total_amount);
    revenue += amount;
    cogs += saleCogs(row.data, input.costByProductId);
    const qty = num(row.data.quantity);
    unitsSold += row.data.sale_type === "return" ? -qty : qty;

    const invoiceId = row.data.invoice_id?.trim();
    if (invoiceId) {
      creditSales += amount;
      if (row.data.sale_type !== "return") invoiceIds.add(invoiceId);
    } else {
      cashSales += amount;
    }
  }

  let expenses = 0;
  for (const row of input.expenses) {
    const date = timestampToDate(row.data.date);
    if (!date) continue;
    const ms = date.getTime();
    if (ms < startMs || ms > endMs) continue;
    expenses += num(row.data.amount);
  }

  let purchases = 0;
  for (const row of input.stockLots) {
    if (row.data.source !== "stock_in") continue;
    const date = timestampToDate(row.data.received_at) ?? timestampToDate(row.data.created_at);
    if (!date) continue;
    const ms = date.getTime();
    if (ms < startMs || ms > endMs) continue;
    purchases += num(row.data.qty_in) * num(row.data.unit_cost);
  }

  revenue = roundMoney2(revenue);
  cogs = roundMoney2(cogs);
  expenses = roundMoney2(expenses);
  const gross = roundMoney2(revenue - cogs);
  const net = roundMoney2(gross - expenses);
  const orderCount = invoiceIds.size;

  return {
    revenue,
    cogs,
    grossProfit: gross,
    expenses,
    netProfit: net,
    purchases: roundMoney2(purchases),
    writeOffs: roundMoney2(input.writeOffsInRange ?? 0),
    unitsSold,
    orderCount,
    avgOrderValue: orderCount > 0 ? revenue / orderCount : null,
    grossMarginPct: grossMarginPct(revenue, cogs),
    netMarginPct: revenue > 0 ? (net / revenue) * 100 : null,
    cogsRatio: cogsRatio(revenue, cogs),
    creditSales: roundMoney2(creditSales),
    cashSales: roundMoney2(cashSales),
    days: Math.max(1, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1),
  };
}

/** Sum a slice of months into one set of period totals. */
export function totalsForMonths(points: readonly MonthlyPoint[]): PeriodTotals {
  const totals = points.reduce(
    (acc, p) => {
      acc.revenue += p.revenue;
      acc.cogs += p.cogs;
      acc.expenses += p.expenses;
      acc.purchases += p.purchases;
      acc.writeOffs += p.writeOffs;
      acc.unitsSold += p.unitsSold;
      acc.orderCount += p.orderCount;
      return acc;
    },
    { revenue: 0, cogs: 0, expenses: 0, purchases: 0, writeOffs: 0, unitsSold: 0, orderCount: 0 },
  );

  const revenue = roundMoney2(totals.revenue);
  const cogs = roundMoney2(totals.cogs);
  const expenses = roundMoney2(totals.expenses);
  const gross = roundMoney2(revenue - cogs);
  const net = roundMoney2(gross - expenses);

  return {
    revenue,
    cogs,
    grossProfit: gross,
    expenses,
    netProfit: net,
    purchases: roundMoney2(totals.purchases),
    writeOffs: roundMoney2(totals.writeOffs),
    unitsSold: totals.unitsSold,
    orderCount: totals.orderCount,
    avgOrderValue: totals.orderCount > 0 ? revenue / totals.orderCount : null,
    grossMarginPct: grossMarginPct(revenue, cogs),
    netMarginPct: revenue > 0 ? (net / revenue) * 100 : null,
    cogsRatio: cogsRatio(revenue, cogs),
  };
}
