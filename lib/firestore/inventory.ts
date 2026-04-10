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
import type { ProductDoc, StockLotDoc } from "@/lib/types/firestore";

function resolveStockInUnitCost(
  product: ProductDoc | undefined,
  unitCost?: number,
): number {
  if (unitCost !== undefined) {
    if (typeof unitCost !== "number" || !Number.isFinite(unitCost) || unitCost < 0) {
      throw new Error("Unit cost must be zero or greater.");
    }
    return unitCost;
  }
  return typeof product?.cost_price === "number" ? product.cost_price : 0;
}

/**
 * Increase stock atomically (stock in).
 * @param unitCost - Cost per unit for this receipt; omitted or undefined uses the product's current cost_price.
 */
export async function stockIn(
  db: Firestore,
  productId: string,
  quantity: number,
  unitCost?: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  const ref = doc(db, COLLECTIONS.products, productId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error("Product not found.");
    }
    const product = snap.data() as ProductDoc | undefined;
    const resolvedUnitCost = resolveStockInUnitCost(product, unitCost);

    tx.update(ref, {
      stock_quantity: increment(quantity),
      cost_price: resolvedUnitCost,
    });
    const lotRef = doc(collection(db, COLLECTIONS.stockLots));
    tx.set(lotRef, {
      product_id: productId,
      unit_cost: resolvedUnitCost,
      qty_in: quantity,
      qty_remaining: quantity,
      source: "stock_in",
      received_at: serverTimestamp(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    } satisfies Omit<StockLotDoc, "received_at" | "created_at" | "updated_at"> & {
      received_at: unknown;
      created_at: unknown;
      updated_at: unknown;
    });
  });
}

/**
 * Decrease stock atomically (stock out). Fails if stock would go negative.
 */
export async function stockOut(
  db: Firestore,
  productId: string,
  quantity: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  const ref = doc(db, COLLECTIONS.products, productId);
  const lotCandidatesSnap = await getDocs(collection(db, COLLECTIONS.stockLots));
  const lotCandidateIds: string[] = [];
  lotCandidatesSnap.forEach((d) => {
    const data = d.data() as Partial<StockLotDoc>;
    if (data.product_id === productId) {
      lotCandidateIds.push(d.id);
    }
  });

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new Error("Product not found.");
    }
    const data = snap.data();
    if (!data) {
      throw new Error("Product not found.");
    }
    const current =
      typeof data.stock_quantity === "number" ? data.stock_quantity : 0;
    if (current < quantity) {
      throw new Error("Not enough stock.");
    }
    transaction.update(ref, { stock_quantity: increment(-quantity) });

    // Consume FIFO lots for manual stock-out to keep lot balances aligned.
    const lots: Array<{ id: string; data: StockLotDoc }> = [];
    for (const lotId of lotCandidateIds) {
      const lotRef = doc(db, COLLECTIONS.stockLots, lotId);
      const lotSnap = await transaction.get(lotRef);
      if (!lotSnap.exists()) continue;
      const lotData = lotSnap.data() as StockLotDoc;
      if (lotData.product_id === productId) {
        lots.push({ id: lotId, data: lotData });
      }
    }
    lots.sort((a, b) => a.data.received_at.toMillis() - b.data.received_at.toMillis());

    let remaining = quantity;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const available = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      remaining -= take;
      transaction.update(doc(db, COLLECTIONS.stockLots, lot.id), {
        qty_remaining: available - take,
        updated_at: serverTimestamp(),
      });
    }
    if (remaining > 0) {
      throw new Error("Stock lots are out of sync. Please restock this product.");
    }
  });
}
