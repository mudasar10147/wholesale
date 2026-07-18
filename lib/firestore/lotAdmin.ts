/**
 * Admin inventory corrections. Lot updates must satisfy `validStockLotBase` and immutables in
 * firestore.rules (`product_id`, `qty_in`, `source`, `received_at`, `created_at` unchanged on update).
 */
import {
  collection,
  doc,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { normalizePurchaseSource } from "@/lib/firestore/inventory";
import { listCostFromProductLots } from "@/lib/inventory/lotPricing";
import { assertLegacyInventoryApiAllowed, inventoryEngineConfig } from "@/lib/inventory/config";
import { postStockAdjustment } from "@/lib/inventory/stockAdjustment";
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
 * Update editable lot fields (unit_cost, qty_remaining) and set product cost_price to the
 * newest lot with stock (last purchase price). Firestore rules lock qty_in, source, etc.
 */
export async function updateLotAndSyncProduct(
  db: Firestore,
  productId: string,
  lotId: string,
  input: { unit_cost?: number; qty_remaining?: number },
): Promise<void> {
  if (input.qty_remaining !== undefined) {
    if (inventoryEngineConfig.directLotEditsDisabled) {
      throw new Error(
        "Direct lot quantity edits are disabled. Create a stock adjustment with a reason instead.",
      );
    }
    assertLegacyInventoryApiAllowed("updateLotAndSyncProduct (qty_remaining)");
  }
  if (input.unit_cost === undefined && input.qty_remaining === undefined) {
    throw new Error("Nothing to update.");
  }
  if (input.unit_cost !== undefined) {
    if (typeof input.unit_cost !== "number" || !Number.isFinite(input.unit_cost) || input.unit_cost < 0) {
      throw new Error("Unit cost must be zero or greater.");
    }
  }
  if (input.qty_remaining !== undefined) {
    if (!Number.isInteger(input.qty_remaining) || input.qty_remaining < 0) {
      throw new Error("Quantity remaining must be a non-negative whole number.");
    }
  }

  const sortedLotIds = await prefetchSortedLotIdsForProduct(db, productId);
  if (!sortedLotIds.includes(lotId)) {
    throw new Error("Lot not found for this product.");
  }

  const productRef = doc(db, COLLECTIONS.products, productId);

  await runTransaction(db, async (tx) => {
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists()) {
      throw new Error("Product not found.");
    }

    const lots: Array<{ id: string; data: StockLotDoc }> = [];
    for (const id of sortedLotIds) {
      const lotRef = doc(db, COLLECTIONS.stockLots, id);
      const lotSnap = await tx.get(lotRef);
      if (!lotSnap.exists()) continue;
      const lotData = lotSnap.data() as StockLotDoc;
      if (lotData.product_id === productId) {
        lots.push({ id, data: lotData });
      }
    }

    const target = lots.find((l) => l.id === lotId);
    if (!target) {
      throw new Error("Lot not found.");
    }

    const qtyIn = typeof target.data.qty_in === "number" ? target.data.qty_in : 0;
    const nextQty =
      input.qty_remaining !== undefined
        ? input.qty_remaining
        : typeof target.data.qty_remaining === "number"
          ? target.data.qty_remaining
          : 0;
    if (!Number.isInteger(nextQty) || nextQty < 0 || nextQty > qtyIn) {
      throw new Error(`Quantity remaining must be an integer from 0 through ${qtyIn} (qty in).`);
    }

    const nextUnitCost =
      input.unit_cost !== undefined
        ? input.unit_cost
        : typeof target.data.unit_cost === "number"
          ? target.data.unit_cost
          : 0;

    const nextCostPrice = listCostFromProductLots(lots, [
      { id: lotId, qty_remaining: nextQty, unit_cost: nextUnitCost },
    ]);

    tx.update(doc(db, COLLECTIONS.stockLots, lotId), {
      unit_cost: nextUnitCost,
      qty_remaining: nextQty,
      updated_at: serverTimestamp(),
    });

    tx.update(productRef, { cost_price: nextCostPrice });
  });
}

/**
 * Set product stock_quantity to the sum of lot qty_remaining and cost_price to the newest
 * lot with stock (0 when no stock on lots).
 */
export async function syncProductStockFromLots(db: Firestore, productId: string): Promise<void> {
  assertLegacyInventoryApiAllowed("syncProductStockFromLots");
  const sortedLotIds = await prefetchSortedLotIdsForProduct(db, productId);
  const productRef = doc(db, COLLECTIONS.products, productId);

  await runTransaction(db, async (tx) => {
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists()) {
      throw new Error("Product not found.");
    }

    const lots: Array<{ id: string; data: StockLotDoc }> = [];
    for (const id of sortedLotIds) {
      const lotRef = doc(db, COLLECTIONS.stockLots, id);
      const lotSnap = await tx.get(lotRef);
      if (!lotSnap.exists()) continue;
      const lotData = lotSnap.data() as StockLotDoc;
      if (lotData.product_id === productId) {
        lots.push({ id, data: lotData });
      }
    }

    let sum = 0;
    for (const l of lots) {
      const q = l.data.qty_remaining;
      sum += typeof q === "number" && Number.isInteger(q) ? q : 0;
    }

    const nextCost = listCostFromProductLots(lots);

    tx.update(productRef, { stock_quantity: sum, cost_price: nextCost });
  });
}

/**
 * Append an adjustment lot and increase product stock; cost_price becomes that lot's unit cost
 * (newest receipt with stock).
 */
export async function createAdjustmentLot(
  db: Firestore,
  productId: string,
  quantity: number,
  unitCost: number,
  referenceNote?: string,
): Promise<void> {
  const reason = referenceNote?.trim();
  if (!reason) {
    throw new Error("Reason is required for stock adjustments.");
  }
  await postStockAdjustment(db, {
    productId,
    quantityDelta: quantity,
    unitCost,
    reason,
  });
}

/**
 * Remove a lot and set product stock to the sum of remaining lots and cost to the newest lot
 * with stock. Temporary admin escape hatch; breaks links to this lot_id in historical data if any.
 */
export async function deleteLotAndSyncProduct(
  db: Firestore,
  productId: string,
  lotId: string,
): Promise<void> {
  assertLegacyInventoryApiAllowed("deleteLotAndSyncProduct");
  const sortedLotIds = await prefetchSortedLotIdsForProduct(db, productId);
  if (!sortedLotIds.includes(lotId)) {
    throw new Error("Lot not found for this product.");
  }

  const productRef = doc(db, COLLECTIONS.products, productId);
  const lotRef = doc(db, COLLECTIONS.stockLots, lotId);

  await runTransaction(db, async (tx) => {
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists()) {
      throw new Error("Product not found.");
    }

    const lots: Array<{ id: string; data: StockLotDoc }> = [];
    for (const id of sortedLotIds) {
      const ref = doc(db, COLLECTIONS.stockLots, id);
      const lotSnap = await tx.get(ref);
      if (!lotSnap.exists()) continue;
      const lotData = lotSnap.data() as StockLotDoc;
      if (lotData.product_id === productId) {
        lots.push({ id, data: lotData });
      }
    }

    const target = lots.find((l) => l.id === lotId);
    if (!target) {
      throw new Error("Lot not found.");
    }

    const remaining = lots.filter((l) => l.id !== lotId);
    let sum = 0;
    for (const l of remaining) {
      const q = l.data.qty_remaining;
      sum += typeof q === "number" && Number.isInteger(q) ? q : 0;
    }
    const nextCost = listCostFromProductLots(remaining);

    tx.delete(lotRef);
    tx.update(productRef, { stock_quantity: sum, cost_price: nextCost });
  });
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
