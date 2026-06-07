import {
  collection,
  getDocs,
  query,
  where,
  type Firestore,
  Timestamp,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ExpenseDoc, InventoryDiscardDoc, InvoiceDoc, InvoiceReturnDoc, ProductDoc, SaleDoc } from "@/lib/types/firestore";
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

function buildCostMap(products: { id: string; data: ProductDoc }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of products) {
    const c = p.data.cost_price;
    m.set(p.id, typeof c === "number" ? c : 0);
  }
  return m;
}

async function fetchSalesInRange(
  db: Firestore,
  start: Date,
  end: Date,
): Promise<SaleDoc[]> {
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);
  const q = query(
    collection(db, COLLECTIONS.sales),
    where("date", ">=", startTs),
    where("date", "<=", endTs),
  );
  const snap = await getDocs(q);
  const out: SaleDoc[] = [];
  snap.forEach((d) => out.push(d.data() as SaleDoc));
  return out;
}

async function fetchExpensesInRange(
  db: Firestore,
  start: Date,
  end: Date,
): Promise<ExpenseDoc[]> {
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);
  const q = query(
    collection(db, COLLECTIONS.expenses),
    where("date", ">=", startTs),
    where("date", "<=", endTs),
  );
  const snap = await getDocs(q);
  const out: ExpenseDoc[] = [];
  snap.forEach((d) => out.push(d.data() as ExpenseDoc));
  return out;
}

async function fetchAllProducts(db: Firestore): Promise<Map<string, number>> {
  const snap = await getDocs(collection(db, COLLECTIONS.products));
  const list: { id: string; data: ProductDoc }[] = [];
  snap.forEach((d) => list.push({ id: d.id, data: d.data() as ProductDoc }));
  return buildCostMap(list);
}

async function fetchVoidInvoiceIds(db: Firestore): Promise<Set<string>> {
  const snap = await getDocs(collection(db, COLLECTIONS.invoices));
  const ids = new Set<string>();
  snap.forEach((d) => {
    const inv = d.data() as InvoiceDoc;
    if (inv.status === "void") ids.add(d.id);
  });
  return ids;
}

async function fetchDamagedWriteOffsInRange(
  db: Firestore,
  start: Date,
  end: Date,
): Promise<number> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  let total = 0;

  const returnsSnap = await getDocs(collection(db, COLLECTIONS.invoiceReturns));
  returnsSnap.forEach((d) => {
    const row = d.data() as InvoiceReturnDoc;
    if (row.status !== "posted") return;
    const ms = row.posted_at?.toMillis?.() ?? 0;
    if (ms < startMs || ms > endMs) return;
    const writeOff =
      typeof row.write_off_cogs_amount === "number" ? row.write_off_cogs_amount : 0;
    if (Number.isFinite(writeOff)) total += writeOff;
  });

  const discardsSnap = await getDocs(collection(db, COLLECTIONS.inventoryDiscards));
  discardsSnap.forEach((d) => {
    const row = d.data() as InventoryDiscardDoc;
    const ms = row.created_at?.toMillis?.() ?? 0;
    if (ms < startMs || ms > endMs) return;
    const writeOff =
      typeof row.total_cogs_amount === "number" ? row.total_cogs_amount : 0;
    if (Number.isFinite(writeOff)) total += writeOff;
  });

  return total;
}

/**
 * Loads sales + expenses for [start, end] and computes profit using sale COGS when available.
 */
export async function loadProfitForPeriod(
  db: Firestore,
  start: Date,
  end: Date,
): Promise<ProfitBreakdown> {
  const [costByProductId, sales, expenses, voidInvoiceIds, damagedWriteOffs] = await Promise.all([
    fetchAllProducts(db),
    fetchSalesInRange(db, start, end),
    fetchExpensesInRange(db, start, end),
    fetchVoidInvoiceIds(db),
    fetchDamagedWriteOffsInRange(db, start, end),
  ]);
  const filteredSales = filterSalesForProfitReporting(sales, voidInvoiceIds);
  return computeProfitBreakdown(filteredSales, expenses, costByProductId, damagedWriteOffs);
}

/**
 * Sum sale COGS for a calendar Mon–Sun week used for inventory velocity, excluding void invoices.
 */
export async function loadCogsForVelocityWeek(
  db: Firestore,
  now = new Date(),
): Promise<{ weeklyCogs: number; week: { start: Date; end: Date; label: string } }> {
  const week = getInventoryVelocityWeekBounds(now);
  const [costByProductId, sales, voidInvoiceIds] = await Promise.all([
    fetchAllProducts(db),
    fetchSalesInRange(db, week.start, week.end),
    fetchVoidInvoiceIds(db),
  ]);
  const filteredSales = filterSalesForProfitReporting(sales, voidInvoiceIds);
  const weeklyCogs = computeCogs(filteredSales, costByProductId);
  return { weeklyCogs, week };
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
export async function loadYtdAverageWeeklySales(
  db: Firestore,
  now = new Date(),
): Promise<YtdWeeklySalesSummary> {
  const year = now.getFullYear();
  const yearStart = getCurrentYearBounds(now).start;
  const end = getTodayBounds(now).end;

  const [sales, voidInvoiceIds] = await Promise.all([
    fetchSalesInRange(db, yearStart, end),
    fetchVoidInvoiceIds(db),
  ]);
  const filteredSales = filterSalesForProfitReporting(sales, voidInvoiceIds);
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

  const avgFrom = new Date(
    Math.max(yearStart.getTime(), firstSaleDay.getTime()),
  );
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
