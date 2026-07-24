/**
 * Admin inventory corrections. Lot updates must satisfy `validStockLotBase` and immutables in
 * firestore.rules (`product_id`, `qty_in`, `source`, `received_at`, `created_at` unchanged on update).
 *
 * The non-lot-aware / lot-forcing admin escape hatches that used to live here
 * (`updateLotAndSyncProduct`, `syncProductStockFromLots`, `createAdjustmentLot`,
 * `deleteLotAndSyncProduct`) were removed in Milestone 0 (Phase 1 inventory integrity):
 * they had no callers and each could set `stock_quantity` from a lot total with no ledger,
 * reason, or uid — exactly what MIGRATION_RUNBOOK.md forbids. See docs/inventory/WRITER_INVENTORY.md.
 */
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { normalizePurchaseSource } from "@/lib/firestore/inventory";
import type { StockLotDoc } from "@/lib/types/firestore";

async function prefetchSortedLotIdsForProduct(db: Firestore, productId: string): Promise<string[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.stockLots));
  const ids: string[] = [];
  snap.forEach((d) => {
    const data = d.data() as Partial<StockLotDoc>;
    if (data.product_id === productId) ids.push(d.id);
  });
  return [...ids].sort();
}

/**
 * Convert a legacy opening-balance lot into stock_in so it is counted in stock purchase cash outflow.
 * This does not change quantities or unit cost.
 */
export async function convertOpeningBalanceLotToStockIn(
  db: Firestore,
  productId: string,
  lotId: string,
  traderId: string,
  traderName: string,
): Promise<void> {
  const sortedLotIds = await prefetchSortedLotIdsForProduct(db, productId);
  if (!sortedLotIds.includes(lotId)) {
    throw new Error("Lot not found for this product.");
  }

  const lotRef = doc(db, COLLECTIONS.stockLots, lotId);
  const resolvedPurchaseSource = normalizePurchaseSource(traderName);
  const resolvedTraderId = traderId.trim();
  if (!resolvedTraderId) {
    throw new Error("Trader is required.");
  }
  await runTransaction(db, async (tx) => {
    const lotSnap = await tx.get(lotRef);
    if (!lotSnap.exists()) {
      throw new Error("Lot not found.");
    }
    const lot = lotSnap.data() as StockLotDoc;
    if (lot.product_id !== productId) {
      throw new Error("Lot does not belong to this product.");
    }
    if (lot.source !== "opening_balance") {
      throw new Error("Only opening_balance lots can be converted to stock_in.");
    }
    tx.update(lotRef, {
      source: "stock_in",
      purchase_source: resolvedPurchaseSource,
      trader_id: resolvedTraderId,
      updated_at: serverTimestamp(),
    });
  });
}
