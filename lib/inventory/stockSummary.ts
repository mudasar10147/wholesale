import { collection, getDocs, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/inventory/lowStock";
import { archivedProductIds } from "@/lib/products/archive";
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
  /** Archived products excluded from every figure above. */
  archivedProductCount: number;
  /** Units still on hand under archived products, excluded from `totalUnits`. */
  archivedUnits: number;
  /**
   * Lot value excluded from `totalValueAtLotCost` because its product is archived.
   * Reported rather than dropped: the stock physically exists and the inventory
   * validator still counts it, so the dashboard must be able to explain the gap.
   */
  archivedValueAtLotCost: number;
};

/**
 * Aggregate product counts and list low-stock SKUs (sorted by stock ascending).
 *
 * Pure — takes documents the caller already holds. Keeping the fetch out of here
 * is what lets the dashboard read `products` and `stock_lots` once and share them
 * across every panel instead of re-querying per panel.
 *
 * Archived products are excluded from every headline figure, including the lots
 * they still hold. That stock has not gone anywhere — the validator and invariant
 * P1 still count it — so the excluded amount comes back as `archivedUnits` and
 * `archivedValueAtLotCost` for the dashboard to show as a reconciling footnote.
 */
export function computeStockSummary(
  products: readonly { id: string; data: ProductDoc }[],
  stockLots: readonly StockLotDoc[],
): StockSummaryData {
  let totalUnits = 0;
  let totalValueAtCost = 0;
  let totalValueAtRetail = 0;
  let reorderCount = 0;
  let outOfStockCount = 0;
  let activeProductCount = 0;
  let archivedProductCount = 0;
  let archivedUnits = 0;
  const archivedIds = archivedProductIds(products);
  const low: LowStockItem[] = [];

  for (const { id, data: d } of products) {
    const qty = typeof d.stock_quantity === "number" ? d.stock_quantity : 0;

    if (archivedIds.has(id)) {
      archivedProductCount += 1;
      archivedUnits += qty;
      continue;
    }
    activeProductCount += 1;
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
        id,
        name: typeof d.name === "string" ? d.name : "—",
        stock_quantity: qty,
      });
    }
  }

  let totalValueAtLotCost = 0;
  let archivedValueAtLotCost = 0;
  for (const lot of stockLots) {
    const qty =
      typeof lot.qty_remaining === "number" && Number.isInteger(lot.qty_remaining)
        ? lot.qty_remaining
        : 0;
    const unitCost =
      typeof lot.unit_cost === "number" && Number.isFinite(lot.unit_cost) ? lot.unit_cost : 0;
    if (qty > 0) {
      if (archivedIds.has(lot.product_id)) {
        archivedValueAtLotCost += qty * unitCost;
      } else {
        totalValueAtLotCost += qty * unitCost;
      }
    }
  }

  const unrealizedGrossProfit = totalValueAtRetail - totalValueAtLotCost;
  const inventoryMarginPct =
    totalValueAtRetail > 0 ? (unrealizedGrossProfit / totalValueAtRetail) * 100 : null;

  low.sort((a, b) => a.stock_quantity - b.stock_quantity);

  return {
    productCount: activeProductCount,
    totalUnits,
    totalValueAtCost,
    lowStockItems: low,
    totalValueAtLotCost,
    totalValueAtRetail,
    unrealizedGrossProfit,
    inventoryMarginPct,
    reorderCount,
    outOfStockCount,
    archivedProductCount,
    archivedUnits,
    archivedValueAtLotCost,
  };
}

/** Fetches products + lots and summarises them. Prefer {@link computeStockSummary} when the caller already holds the documents. */
export async function loadStockSummary(db: Firestore): Promise<StockSummaryData> {
  const [productsSnap, lotsSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.products)),
    getDocs(collection(db, COLLECTIONS.stockLots)),
  ]);

  const products: { id: string; data: ProductDoc }[] = [];
  productsSnap.forEach((d) => products.push({ id: d.id, data: d.data() as ProductDoc }));
  const lots: StockLotDoc[] = [];
  lotsSnap.forEach((d) => lots.push(d.data() as StockLotDoc));

  return computeStockSummary(products, lots);
}
