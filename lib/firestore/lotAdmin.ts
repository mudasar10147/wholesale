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
import { weightedAverageUnitCostFromLotCostRows } from "@/lib/inventory/lotPricing";
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

function lotRowsForWac(lots: Array<{ id: string; data: StockLotDoc }>) {
  return lots.map((l) => ({
    qty_remaining: typeof l.data.qty_remaining === "number" ? l.data.qty_remaining : 0,
    unit_cost:
      typeof l.data.unit_cost === "number" && Number.isFinite(l.data.unit_cost) ? l.data.unit_cost : 0,
  }));
}

/**
 * Update editable lot fields (unit_cost, qty_remaining) and set product cost_price to the
 * weighted average of all lots for this product. Firestore rules lock qty_in, source, etc.
 */
export async function updateLotAndSyncProduct(
  db: Firestore,
  productId: string,
  lotId: string,
  input: { unit_cost?: number; qty_remaining?: number },
): Promise<void> {
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

    const rows = lots.map((l) => {
      if (l.id === lotId) {
        return { qty_remaining: nextQty, unit_cost: nextUnitCost };
      }
      const qr = typeof l.data.qty_remaining === "number" ? l.data.qty_remaining : 0;
      const uc =
        typeof l.data.unit_cost === "number" && Number.isFinite(l.data.unit_cost) ? l.data.unit_cost : 0;
      return { qty_remaining: qr, unit_cost: uc };
    });

    const nextCostPrice = weightedAverageUnitCostFromLotCostRows(rows);

    tx.update(doc(db, COLLECTIONS.stockLots, lotId), {
      unit_cost: nextUnitCost,
      qty_remaining: nextQty,
      updated_at: serverTimestamp(),
    });

    tx.update(productRef, { cost_price: nextCostPrice });
  });
}

/**
 * Set product stock_quantity to the sum of lot qty_remaining and cost_price to the weighted
 * average of remaining units (0 when no stock on lots).
 */
export async function syncProductStockFromLots(db: Firestore, productId: string): Promise<void> {
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

    const nextCost = weightedAverageUnitCostFromLotCostRows(lotRowsForWac(lots));

    tx.update(productRef, {
      stock_quantity: sum,
      cost_price: nextCost,
    });
  });
}

/**
 * Append an adjustment lot and increase product stock; cost_price becomes WAC including the new lot.
 */
export async function createAdjustmentLot(
  db: Firestore,
  productId: string,
  quantity: number,
  unitCost: number,
  referenceNote?: string,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  if (typeof unitCost !== "number" || !Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error("Unit cost must be zero or greater.");
  }
  const note = referenceNote?.trim();
  if (note && note.length > 400) {
    throw new Error("Note must be at most 400 characters.");
  }

  const sortedLotIds = await prefetchSortedLotIdsForProduct(db, productId);
  const productRef = doc(db, COLLECTIONS.products, productId);
  const newLotRef = doc(collection(db, COLLECTIONS.stockLots));

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

    const baseRows = lotRowsForWac(lots);
    baseRows.push({ qty_remaining: quantity, unit_cost: unitCost });
    const nextCost = weightedAverageUnitCostFromLotCostRows(baseRows);

    const payload: Record<string, unknown> = {
      product_id: productId,
      unit_cost: unitCost,
      qty_in: quantity,
      qty_remaining: quantity,
      source: "adjustment",
      received_at: serverTimestamp(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    };
    if (note) {
      payload.reference_id = note;
    }

    tx.set(newLotRef, payload);
    tx.update(productRef, {
      stock_quantity: increment(quantity),
      cost_price: nextCost,
    });
  });
}

/**
 * Remove a lot and set product stock to the sum of remaining lots and cost to WAC.
 * Temporary admin escape hatch; breaks links to this lot_id in historical data if any.
 */
export async function deleteLotAndSyncProduct(
  db: Firestore,
  productId: string,
  lotId: string,
): Promise<void> {
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
    const nextCost = weightedAverageUnitCostFromLotCostRows(lotRowsForWac(remaining));

    tx.delete(lotRef);
    tx.update(productRef, {
      stock_quantity: sum,
      cost_price: nextCost,
    });
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
): Promise<void> {
  const sortedLotIds = await prefetchSortedLotIdsForProduct(db, productId);
  if (!sortedLotIds.includes(lotId)) {
    throw new Error("Lot not found for this product.");
  }

  const lotRef = doc(db, COLLECTIONS.stockLots, lotId);
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
      updated_at: serverTimestamp(),
    });
  });
}
