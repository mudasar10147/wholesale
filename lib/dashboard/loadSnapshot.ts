import type { Firestore } from "firebase/firestore";
import { loadActiveCustomerCount } from "@/lib/firestore/customers";
import { loadStockSummary, type StockSummaryData } from "@/lib/inventory/stockSummary";

export type DashboardSnapshot = {
  stock: StockSummaryData;
  activeCustomerCount: number;
};

export async function loadDashboardSnapshot(db: Firestore): Promise<DashboardSnapshot> {
  const [stock, activeCustomerCount] = await Promise.all([
    loadStockSummary(db),
    loadActiveCustomerCount(db),
  ]);
  return { stock, activeCustomerCount };
}
