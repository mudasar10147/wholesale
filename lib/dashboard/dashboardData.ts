/**
 * The dashboard's only Firestore read path.
 *
 * Every collection the dashboard needs is fetched exactly once and then shared
 * across all panels. Previously five independent loaders each fetched their own
 * inputs, so a single page load read `invoices` 4×, `products` 3×, and
 * `stock_lots` and `sales` 2× apiece — 6,685 reads against production data where
 * 3,021 documents exist to be read.
 *
 * Keep the fetch here and the maths in the pure `compute*` helpers: that split is
 * what stops per-panel re-querying from creeping back in.
 */
import { collection, getDocs, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { fetchCashSettings, getActualCashBalance, getOpeningBalance } from "@/lib/firestore/cashSettings";
import { computeCashInHandSnapshot, type CashInHandSnapshot } from "@/lib/finance/loadCashInHand";
import { computeStockSummary, type StockSummaryData } from "@/lib/inventory/stockSummary";
import {
  computeWeeklyInventoryVelocity,
  type WeeklyInventoryVelocity,
} from "@/lib/inventory/turnoverMetrics";
import {
  buildCostMap,
  computeCogsForVelocityWeek,
  computeProfitForPeriod,
  computeYtdAverageWeeklySales,
  voidInvoiceIdsFrom,
  type PeriodInputs,
  type YtdWeeklySalesSummary,
} from "@/lib/profit/loadPeriod";
import type { ProfitBreakdown } from "@/lib/profit/metrics";
import type {
  CashEntryDoc,
  CashSettingsDoc,
  CustomerDoc,
  ExpenseDoc,
  InventoryDiscardDoc,
  InvoiceDoc,
  InvoiceReturnDoc,
  ProductDoc,
  SaleDoc,
  StockLotDoc,
} from "@/lib/types/firestore";

export type WithId<T> = { id: string; data: T };

/** Raw documents backing the dashboard — one fetch per collection. */
export type DashboardRaw = {
  products: WithId<ProductDoc>[];
  invoices: WithId<InvoiceDoc>[];
  sales: SaleDoc[];
  expenses: ExpenseDoc[];
  stockLots: StockLotDoc[];
  cashEntries: CashEntryDoc[];
  customers: CustomerDoc[];
  invoiceReturns: InvoiceReturnDoc[];
  inventoryDiscards: InventoryDiscardDoc[];
  cashSettings: CashSettingsDoc | null;
};

export type DashboardData = {
  profit: ProfitBreakdown;
  stock: StockSummaryData;
  activeCustomerCount: number;
  velocity: WeeklyInventoryVelocity;
  ytdWeeklySales: YtdWeeklySalesSummary;
  cash: CashInHandSnapshot;
};

async function fetchWithIds<T>(db: Firestore, name: string): Promise<WithId<T>[]> {
  const snap = await getDocs(collection(db, name));
  const out: WithId<T>[] = [];
  snap.forEach((d) => out.push({ id: d.id, data: d.data() as T }));
  return out;
}

async function fetchDocs<T>(db: Firestore, name: string): Promise<T[]> {
  const snap = await getDocs(collection(db, name));
  const out: T[] = [];
  snap.forEach((d) => out.push(d.data() as T));
  return out;
}

/**
 * Nine collection reads plus one settings document — the dashboard's entire
 * Firestore cost, regardless of how many panels render.
 */
export async function fetchDashboardRaw(db: Firestore): Promise<DashboardRaw> {
  const [
    products,
    invoices,
    sales,
    expenses,
    stockLots,
    cashEntries,
    customers,
    invoiceReturns,
    inventoryDiscards,
    cashSettings,
  ] = await Promise.all([
    fetchWithIds<ProductDoc>(db, COLLECTIONS.products),
    fetchWithIds<InvoiceDoc>(db, COLLECTIONS.invoices),
    fetchDocs<SaleDoc>(db, COLLECTIONS.sales),
    fetchDocs<ExpenseDoc>(db, COLLECTIONS.expenses),
    fetchDocs<StockLotDoc>(db, COLLECTIONS.stockLots),
    fetchDocs<CashEntryDoc>(db, COLLECTIONS.cashEntries),
    fetchDocs<CustomerDoc>(db, COLLECTIONS.customers),
    fetchDocs<InvoiceReturnDoc>(db, COLLECTIONS.invoiceReturns),
    fetchDocs<InventoryDiscardDoc>(db, COLLECTIONS.inventoryDiscards),
    fetchCashSettings(db),
  ]);

  return {
    products,
    invoices,
    sales,
    expenses,
    stockLots,
    cashEntries,
    customers,
    invoiceReturns,
    inventoryDiscards,
    cashSettings,
  };
}

/** Active customers are those not explicitly archived (`is_active === false`). */
export function countActiveCustomers(customers: readonly CustomerDoc[]): number {
  let count = 0;
  for (const c of customers) {
    if ((c as { is_active?: boolean }).is_active !== false) count += 1;
  }
  return count;
}

/**
 * Cash in hand does not depend on the selected KPI period, so it is derivable on
 * its own — the dashboard shows it even when the date range is invalid.
 */
export function computeCashSnapshot(raw: DashboardRaw): CashInHandSnapshot {
  return computeCashInHandSnapshot({
    sales: raw.sales,
    expenses: raw.expenses,
    invoices: raw.invoices.map((i) => i.data),
    stockLots: raw.stockLots,
    cashEntries: raw.cashEntries,
    openingBalance: getOpeningBalance(raw.cashSettings),
    actualCashBalance: getActualCashBalance(raw.cashSettings),
  });
}

/**
 * Every dashboard figure, derived from one set of documents. Pure — no I/O, so
 * it is directly testable and cannot re-query.
 */
export function computeDashboard(
  raw: DashboardRaw,
  range: { start: Date; end: Date },
  now = new Date(),
): DashboardData {
  const costByProductId = buildCostMap(raw.products);
  const voidInvoiceIds = voidInvoiceIdsFrom(raw.invoices);

  const periodInputs: PeriodInputs = {
    sales: raw.sales,
    expenses: raw.expenses,
    costByProductId,
    voidInvoiceIds,
    invoiceReturns: raw.invoiceReturns,
    inventoryDiscards: raw.inventoryDiscards,
  };

  const stock = computeStockSummary(raw.products, raw.stockLots);
  const velocityWeek = computeCogsForVelocityWeek(periodInputs, now);

  return {
    profit: computeProfitForPeriod(periodInputs, range.start, range.end),
    stock,
    activeCustomerCount: countActiveCustomers(raw.customers),
    velocity: computeWeeklyInventoryVelocity(
      stock.totalValueAtLotCost,
      velocityWeek.weeklyCogs,
      velocityWeek.week,
    ),
    ytdWeeklySales: computeYtdAverageWeeklySales(periodInputs, now),
    cash: computeCashSnapshot(raw),
  };
}

/** Fetch once, then derive everything. */
export async function loadDashboardData(
  db: Firestore,
  range: { start: Date; end: Date },
  now = new Date(),
): Promise<DashboardData> {
  return computeDashboard(await fetchDashboardRaw(db), range, now);
}
