/**
 * Period metrics for the dashboard — pure functions over documents the caller
 * already holds.
 *
 * These used to fetch their own inputs, which meant the dashboard read `invoices`
 * four times and `products` three times per page load. They now take the data,
 * so `loadDashboardData` can read each collection exactly once and share it.
 */
import type { Timestamp } from "firebase/firestore";
import type {
  ExpenseDoc,
  InventoryDiscardDoc,
  InvoiceDoc,
  InvoiceReturnDoc,
  ProductDoc,
  SaleDoc,
} from "@/lib/types/firestore";
import { computeProfitBreakdown, computeCogs, sumSaleAmounts, type ProfitBreakdown } from "@/lib/profit/metrics";
import { getCurrentYearBounds, getInventoryVelocityWeekBounds, getTodayBounds } from "@/lib/profit/periods";
import { periodDayCount } from "@/lib/inventory/turnoverMetrics";

export function filterSalesForProfitReporting(
  sales: SaleDoc[],
  voidInvoiceIds: Set<string>,
): SaleDoc[] {
  return sales.filter((s) => {
    const invId = s.invoice_id ?? s.original_invoice_id;
    if (typeof invId === "string" && invId.trim() && voidInvoiceIds.has(invId.trim())) {
      return false;
    }
    return true;
  });
}

/** Map of product id → current cost price, for COGS fallback on legacy walk-in rows. */
export function buildCostMap(
  products: readonly { id: string; data: ProductDoc }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of products) {
    const c = p.data.cost_price;
    m.set(p.id, typeof c === "number" ? c : 0);
  }
  return m;
}

/** Ids of void invoices — sale rows belonging to these are excluded from reporting. */
export function voidInvoiceIdsFrom(
  invoices: readonly { id: string; data: Pick<InvoiceDoc, "status"> }[],
): Set<string> {
  const ids = new Set<string>();
  for (const inv of invoices) {
    if (inv.data.status === "void") ids.add(inv.id);
  }
  return ids;
}

/**
 * In-memory equivalent of `where(field, ">=", start) && where(field, "<=", end)`.
 * Rows without a usable timestamp are excluded, matching Firestore's behaviour
 * of skipping documents that are missing the ordered field.
 */
function withinRange(ts: Timestamp | undefined, startMs: number, endMs: number): boolean {
  const ms = ts?.toMillis?.();
  return typeof ms === "number" && Number.isFinite(ms) && ms >= startMs && ms <= endMs;
}

export function salesInRange(sales: readonly SaleDoc[], start: Date, end: Date): SaleDoc[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return sales.filter((s) => withinRange(s.date, startMs, endMs));
}

export function expensesInRange(
  expenses: readonly ExpenseDoc[],
  start: Date,
  end: Date,
): ExpenseDoc[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return expenses.filter((e) => withinRange(e.date, startMs, endMs));
}

/**
 * FIFO discard write-offs in a window: posted returns plus stock discards.
 * Rows with no timestamp fall back to 0, which lands outside any real window.
 */
export function damagedWriteOffsInRange(
  invoiceReturns: readonly InvoiceReturnDoc[],
  inventoryDiscards: readonly InventoryDiscardDoc[],
  start: Date,
  end: Date,
): number {
  const startMs = start.getTime();
  const endMs = end.getTime();
  let total = 0;

  for (const row of invoiceReturns) {
    if (row.status !== "posted") continue;
    const ms = row.posted_at?.toMillis?.() ?? 0;
    if (ms < startMs || ms > endMs) continue;
    const writeOff =
      typeof row.write_off_cogs_amount === "number" ? row.write_off_cogs_amount : 0;
    if (Number.isFinite(writeOff)) total += writeOff;
  }

  for (const row of inventoryDiscards) {
    const ms = row.created_at?.toMillis?.() ?? 0;
    if (ms < startMs || ms > endMs) continue;
    const writeOff = typeof row.total_cogs_amount === "number" ? row.total_cogs_amount : 0;
    if (Number.isFinite(writeOff)) total += writeOff;
  }

  return total;
}

/** Everything the period computations read, loaded once by the caller. */
export type PeriodInputs = {
  sales: readonly SaleDoc[];
  expenses: readonly ExpenseDoc[];
  costByProductId: Map<string, number>;
  voidInvoiceIds: Set<string>;
  invoiceReturns: readonly InvoiceReturnDoc[];
  inventoryDiscards: readonly InventoryDiscardDoc[];
};

/** Profit for [start, end], using sale COGS when available. */
export function computeProfitForPeriod(
  input: PeriodInputs,
  start: Date,
  end: Date,
): ProfitBreakdown {
  const sales = filterSalesForProfitReporting(
    salesInRange(input.sales, start, end),
    input.voidInvoiceIds,
  );
  const expenses = expensesInRange(input.expenses, start, end);
  const damaged = damagedWriteOffsInRange(
    input.invoiceReturns,
    input.inventoryDiscards,
    start,
    end,
  );
  return computeProfitBreakdown(sales, expenses, input.costByProductId, damaged);
}

/** Sale COGS for the Mon–Sun route week used by inventory velocity. */
export function computeCogsForVelocityWeek(
  input: Pick<PeriodInputs, "sales" | "costByProductId" | "voidInvoiceIds">,
  now = new Date(),
): { weeklyCogs: number; week: { start: Date; end: Date; label: string } } {
  const week = getInventoryVelocityWeekBounds(now);
  const sales = filterSalesForProfitReporting(
    salesInRange(input.sales, week.start, week.end),
    input.voidInvoiceIds,
  );
  return { weeklyCogs: computeCogs(sales, input.costByProductId), week };
}

export type YtdWeeklySalesSummary = {
  year: number;
  totalSales: number;
  avgWeeklySales: number | null;
  /** Fractional weeks from first sale (or Jan 1) through today. */
  weeksElapsed: number;
  rangeLabel: string;
};

function formatYtdRangeLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Average weekly sales from the start of the calendar year through today.
 * Weeks are counted from the first posted sale in the year (e.g. April) when later than Jan 1.
 */
export function computeYtdAverageWeeklySales(
  input: Pick<PeriodInputs, "sales" | "voidInvoiceIds">,
  now = new Date(),
): YtdWeeklySalesSummary {
  const year = now.getFullYear();
  const yearStart = getCurrentYearBounds(now).start;
  const end = getTodayBounds(now).end;

  const filteredSales = filterSalesForProfitReporting(
    salesInRange(input.sales, yearStart, end),
    input.voidInvoiceIds,
  );
  const totalSales = sumSaleAmounts(filteredSales);

  if (filteredSales.length === 0) {
    return {
      year,
      totalSales: 0,
      avgWeeklySales: null,
      weeksElapsed: 0,
      rangeLabel: formatYtdRangeLabel(yearStart, end),
    };
  }

  let firstSaleMs = Infinity;
  for (const row of filteredSales) {
    const ms = row.date?.toMillis?.();
    if (typeof ms === "number" && ms < firstSaleMs) firstSaleMs = ms;
  }
  const firstSaleDay = new Date(firstSaleMs);

  const avgFrom = new Date(Math.max(yearStart.getTime(), firstSaleDay.getTime()));
  avgFrom.setHours(0, 0, 0, 0);

  const daysElapsed = periodDayCount(avgFrom, end);
  const weeksElapsed = daysElapsed / 7;
  const avgWeeklySales = weeksElapsed > 0 ? totalSales / weeksElapsed : null;

  return {
    year,
    totalSales,
    avgWeeklySales,
    weeksElapsed,
    rangeLabel: formatYtdRangeLabel(avgFrom, end),
  };
}
