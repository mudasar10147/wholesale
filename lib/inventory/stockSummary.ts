import { collection, getDocs, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProductDoc } from "@/lib/types/firestore";

/** Products at or below this level appear in `lowStockItems`. */
export const LOW_STOCK_THRESHOLD = 5;

export type LowStockItem = {
  id: string;
  name: string;
  stock_quantity: number;
};

export type StockSummaryData = {
  productCount: number;
  totalUnits: number;
  /** Sum of stock_quantity × cost_price per product (current product costs). */
  totalValueAtCost: number;
  lowStockItems: LowStockItem[];
};

/**
 * Aggregate product counts and list low-stock SKUs (sorted by stock ascending).
 */
export async function loadStockSummary(db: Firestore): Promise<StockSummaryData> {
  const snap = await getDocs(collection(db, COLLECTIONS.products));
  let totalUnits = 0;
  let totalValueAtCost = 0;
  const low: LowStockItem[] = [];

  snap.forEach((docSnap) => {
    const d = docSnap.data() as ProductDoc;
    const qty = typeof d.stock_quantity === "number" ? d.stock_quantity : 0;
    const cost = typeof d.cost_price === "number" ? d.cost_price : 0;
    totalUnits += qty;
    totalValueAtCost += qty * cost;
    if (qty <= LOW_STOCK_THRESHOLD) {
      low.push({
        id: docSnap.id,
        name: typeof d.name === "string" ? d.name : "—",
        stock_quantity: qty,
      });
    }
  });

  low.sort((a, b) => a.stock_quantity - b.stock_quantity);

  return {
    productCount: snap.size,
    totalUnits,
    totalValueAtCost,
    lowStockItems: low,
  };
}
