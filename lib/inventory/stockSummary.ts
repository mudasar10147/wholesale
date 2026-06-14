import { collection, getDocs, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/inventory/lowStock";
import type { ProductDoc, StockLotDoc } from "@/lib/types/firestore";

/** Products at or below this level appear in `lowStockItems`. */
export const LOW_STOCK_THRESHOLD = DEFAULT_LOW_STOCK_THRESHOLD;

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
  /** Sum of lot qty_remaining × unit_cost (FIFO layers). */
  totalValueAtLotCost: number;
  /** Sum of stock_quantity × sale_price per product. */
  totalValueAtRetail: number;
  /** Retail value minus lot cost (potential gross profit on hand). */
  unrealizedGrossProfit: number;
  /** (retail − lotCost) / retail × 100; null when retail is 0. */
  inventoryMarginPct: number | null;
  /** Products with 0 < stock ≤ LOW_STOCK_THRESHOLD. */
  reorderCount: number;
  /** Products with stock_quantity === 0. */
  outOfStockCount: number;
};

/**
 * Aggregate product counts and list low-stock SKUs (sorted by stock ascending).
 */
export async function loadStockSummary(db: Firestore): Promise<StockSummaryData> {
  const [productsSnap, lotsSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.products)),
    getDocs(collection(db, COLLECTIONS.stockLots)),
  ]);

  let totalUnits = 0;
  let totalValueAtCost = 0;
  let totalValueAtRetail = 0;
  let reorderCount = 0;
  let outOfStockCount = 0;
  const low: LowStockItem[] = [];

  productsSnap.forEach((docSnap) => {
    const d = docSnap.data() as ProductDoc;
    const qty = typeof d.stock_quantity === "number" ? d.stock_quantity : 0;
    const cost = typeof d.cost_price === "number" ? d.cost_price : 0;
    const sale = typeof d.sale_price === "number" ? d.sale_price : 0;
    totalUnits += qty;
    totalValueAtCost += qty * cost;
    totalValueAtRetail += qty * sale;

    if (qty === 0) {
      outOfStockCount += 1;
    } else if (qty <= LOW_STOCK_THRESHOLD) {
      reorderCount += 1;
    }

    if (qty <= LOW_STOCK_THRESHOLD) {
      low.push({
        id: docSnap.id,
        name: typeof d.name === "string" ? d.name : "—",
        stock_quantity: qty,
      });
    }
  });

  let totalValueAtLotCost = 0;
  lotsSnap.forEach((docSnap) => {
    const lot = docSnap.data() as StockLotDoc;
    const qty =
      typeof lot.qty_remaining === "number" && Number.isInteger(lot.qty_remaining)
        ? lot.qty_remaining
        : 0;
    const unitCost =
      typeof lot.unit_cost === "number" && Number.isFinite(lot.unit_cost) ? lot.unit_cost : 0;
    if (qty > 0) {
      totalValueAtLotCost += qty * unitCost;
    }
  });

  const unrealizedGrossProfit = totalValueAtRetail - totalValueAtLotCost;
  const inventoryMarginPct =
    totalValueAtRetail > 0 ? (unrealizedGrossProfit / totalValueAtRetail) * 100 : null;

  low.sort((a, b) => a.stock_quantity - b.stock_quantity);

  return {
    productCount: productsSnap.size,
    totalUnits,
    totalValueAtCost,
    lowStockItems: low,
    totalValueAtLotCost,
    totalValueAtRetail,
    unrealizedGrossProfit,
    inventoryMarginPct,
    reorderCount,
    outOfStockCount,
  };
}
