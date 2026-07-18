import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { getAuthClient } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  fetchStockLotIdsForProduct,
  isFirestoreContentionError,
} from "@/lib/firestore/stockLotsQuery";
import { listCostFromProductLots } from "@/lib/inventory/lotPricing";
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory/constants";
import { inventoryEngineConfig } from "@/lib/inventory/config";
import { assertStockLotInvariant } from "@/lib/inventory/invariantCheck";
import {
  notifyInventoryPosted,
  recordInventoryTransactionInTx,
} from "@/lib/inventory/inventoryTransactionService";
import type { ProductDoc, StockLotDoc } from "@/lib/types/firestore";

export type PostStockAdjustmentInput = {
  productId: string;
  /** Positive = add stock, negative = remove stock. */
  quantityDelta: number;
  unitCost: number;
  reason: string;
  notes?: string;
};

/**
 * ERP stock adjustment — only supported correction path when direct lot edits are disabled.
 * Updates product stock and FIFO lots atomically and records inventory_transactions.
 */
export async function postStockAdjustment(
  db: Firestore,
  input: PostStockAdjustmentInput,
): Promise<void> {
  const productId = input.productId.trim();
  const reason = input.reason.trim();
  if (!productId) throw new Error("Product is required.");
  if (!reason) throw new Error("Reason is required for stock adjustments.");
  if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) {
    throw new Error("Adjustment quantity must be a non-zero whole number (positive to add, negative to remove).");
  }
  if (typeof input.unitCost !== "number" || !Number.isFinite(input.unitCost) || input.unitCost < 0) {
    throw new Error("Unit cost must be zero or greater.");
  }

  const productRef = doc(db, COLLECTIONS.products, productId);
  const uid = getAuthClient().currentUser?.uid;

  let txnResult: ReturnType<typeof recordInventoryTransactionInTx> = null;

  const runAdjustmentTx = async () => {
    const sortedLotIds = await fetchStockLotIdsForProduct(db, productId);
    await runTransaction(db, async (tx) => {
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists()) throw new Error("Product not found.");
    const product = productSnap.data() as ProductDoc;
    const beforeStock = typeof product.stock_quantity === "number" ? product.stock_quantity : 0;

    const lots: Array<{ id: string; data: StockLotDoc }> = [];
    for (const id of sortedLotIds) {
      const lotSnap = await tx.get(doc(db, COLLECTIONS.stockLots, id));
      if (!lotSnap.exists()) continue;
      const lotData = lotSnap.data() as StockLotDoc;
      if (lotData.product_id === productId) lots.push({ id, data: lotData });
    }
    lots.sort((a, b) => a.data.received_at.toMillis() - b.data.received_at.toMillis());

    if (input.quantityDelta > 0) {
      const qty = input.quantityDelta;
      const newLotRef = doc(collection(db, COLLECTIONS.stockLots));
      tx.set(newLotRef, {
        product_id: productId,
        unit_cost: input.unitCost,
        qty_in: qty,
        qty_remaining: qty,
        source: "adjustment",
        warehouse_id: DEFAULT_WAREHOUSE_ID,
        reference_id: reason.slice(0, 400),
        received_at: serverTimestamp(),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      tx.update(productRef, { stock_quantity: increment(qty), cost_price: input.unitCost });
      lots.push({
        id: newLotRef.id,
        data: {
          product_id: productId,
          unit_cost: input.unitCost,
          qty_in: qty,
          qty_remaining: qty,
          source: "adjustment",
          warehouse_id: DEFAULT_WAREHOUSE_ID,
          received_at: product.created_at,
          created_at: product.created_at,
          updated_at: product.created_at,
        },
      });

      txnResult = recordInventoryTransactionInTx(tx, db, {
        type: "ADJUSTMENT",
        warehouse_id: DEFAULT_WAREHOUSE_ID,
        reason,
        notes: input.notes,
        posted_by_uid: uid,
        lines: [
          {
            product_id: productId,
            warehouse_id: DEFAULT_WAREHOUSE_ID,
            direction: "in",
            quantity: qty,
            unit_cost: input.unitCost,
            lot_id: newLotRef.id,
            before_on_hand: beforeStock,
            after_on_hand: beforeStock + qty,
          },
        ],
      });

      const afterProduct: ProductDoc = {
        ...product,
        stock_quantity: beforeStock + qty,
        cost_price: input.unitCost,
      };
      assertStockLotInvariant(productId, afterProduct, lots);
    } else {
      const qty = -input.quantityDelta;
      const currentStock = beforeStock;
      if (currentStock < qty) {
        throw new Error(`Cannot remove ${qty} units; only ${currentStock} in stock.`);
      }

      let need = qty;
      for (const lot of lots) {
        if (need <= 0) break;
        const available = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
        if (available <= 0) continue;
        const take = Math.min(available, need);
        need -= take;
        const nextRemaining = available - take;
        lot.data.qty_remaining = nextRemaining;
        tx.update(doc(db, COLLECTIONS.stockLots, lot.id), {
          qty_remaining: nextRemaining,
          updated_at: serverTimestamp(),
        });
      }
      if (need > 0) {
        throw new Error("Stock lots are out of sync. Cannot complete negative adjustment.");
      }

      const nextCost = listCostFromProductLots(lots);
      tx.update(productRef, { stock_quantity: increment(-qty), cost_price: nextCost });

      txnResult = recordInventoryTransactionInTx(tx, db, {
        type: "ADJUSTMENT",
        warehouse_id: DEFAULT_WAREHOUSE_ID,
        reason,
        notes: input.notes,
        posted_by_uid: uid,
        lines: [
          {
            product_id: productId,
            warehouse_id: DEFAULT_WAREHOUSE_ID,
            direction: "out",
            quantity: qty,
            unit_cost: input.unitCost,
            before_on_hand: beforeStock,
            after_on_hand: beforeStock - qty,
          },
        ],
      });

      const afterProduct: ProductDoc = {
        ...product,
        stock_quantity: beforeStock - qty,
        cost_price: nextCost,
      };
      assertStockLotInvariant(productId, afterProduct, lots);
    }
    });
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await runAdjustmentTx();
      break;
    } catch (e) {
      if (!isFirestoreContentionError(e) || attempt === 2) throw e;
    }
  }

  if (txnResult) {
    await notifyInventoryPosted(txnResult, {
      type: "ADJUSTMENT",
      warehouse_id: DEFAULT_WAREHOUSE_ID,
      reason,
      notes: input.notes,
      posted_by_uid: uid,
      lines: [
        {
          product_id: productId,
          warehouse_id: DEFAULT_WAREHOUSE_ID,
          direction: input.quantityDelta > 0 ? "in" : "out",
          quantity: Math.abs(input.quantityDelta),
          unit_cost: input.unitCost,
        },
      ],
    });
  }
}
