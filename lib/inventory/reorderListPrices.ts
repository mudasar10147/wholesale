import { collection, getDocs, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { StockLotDoc } from "@/lib/types/firestore";

export type StockLotRow = { id: string; data: StockLotDoc };

export type PurchasePriceHistory = {
  lastPurchasePrice: number | null;
  previousPurchasePrice: number | null;
};

export async function fetchAllStockLots(db: Firestore): Promise<StockLotRow[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.stockLots));
  const out: StockLotRow[] = [];
  snap.forEach((docSnap) => {
    out.push({ id: docSnap.id, data: docSnap.data() as StockLotDoc });
  });
  return out;
}

function lotReceivedAtMs(lot: StockLotDoc): number {
  return lot.received_at?.toMillis?.() ?? 0;
}

function lotUnitCost(lot: StockLotDoc): number {
  return typeof lot.unit_cost === "number" && Number.isFinite(lot.unit_cost) && lot.unit_cost >= 0
    ? lot.unit_cost
    : 0;
}

/**
 * Most recent and second-most-recent lot unit costs per product (by received_at).
 */
export function purchasePriceHistoryByProduct(
  lots: StockLotRow[],
): Map<string, PurchasePriceHistory> {
  const byProduct = new Map<string, Array<{ receivedAtMs: number; unitCost: number }>>();

  for (const lot of lots) {
    const productId = lot.data.product_id;
    if (!productId) continue;
    const entries = byProduct.get(productId) ?? [];
    entries.push({
      receivedAtMs: lotReceivedAtMs(lot.data),
      unitCost: lotUnitCost(lot.data),
    });
    byProduct.set(productId, entries);
  }

  const result = new Map<string, PurchasePriceHistory>();
  for (const [productId, entries] of byProduct) {
    entries.sort((a, b) => b.receivedAtMs - a.receivedAtMs);
    result.set(productId, {
      lastPurchasePrice: entries[0]?.unitCost ?? null,
      previousPurchasePrice: entries[1]?.unitCost ?? null,
    });
  }
  return result;
}

export function resolvePurchasePrices(
  productId: string,
  costPrice: number,
  history: Map<string, PurchasePriceHistory>,
): PurchasePriceHistory {
  const fromLots = history.get(productId);
  if (!fromLots) {
    return {
      lastPurchasePrice: costPrice > 0 ? costPrice : null,
      previousPurchasePrice: null,
    };
  }
  return {
    lastPurchasePrice: fromLots.lastPurchasePrice ?? (costPrice > 0 ? costPrice : null),
    previousPurchasePrice: fromLots.previousPurchasePrice,
  };
}
