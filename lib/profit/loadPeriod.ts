import {
  collection,
  getDocs,
  query,
  where,
  type Firestore,
  Timestamp,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ExpenseDoc, ProductDoc, SaleDoc } from "@/lib/types/firestore";
import { computeProfitBreakdown, type ProfitBreakdown } from "@/lib/profit/metrics";

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

/**
 * Loads sales + expenses for [start, end] and computes profit using current product cost prices.
 */
export async function loadProfitForPeriod(
  db: Firestore,
  start: Date,
  end: Date,
): Promise<ProfitBreakdown> {
  const [costByProductId, sales, expenses] = await Promise.all([
    fetchAllProducts(db),
    fetchSalesInRange(db, start, end),
    fetchExpensesInRange(db, start, end),
  ]);
  return computeProfitBreakdown(sales, expenses, costByProductId);
}
