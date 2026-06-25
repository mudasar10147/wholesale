import {
  collection,
  doc,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { applyAutomaticPricingToPatch } from "@/lib/firestore/pricing";
import { loadPricingSettings } from "@/lib/firestore/pricingSettings";
import { listCostFromProductLots } from "@/lib/inventory/lotPricing";
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

function assertNonNegativeMoney(label: string, value: number | undefined): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
}

export function normalizePurchaseSource(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Purchase source (shop) is required.");
  }
  if (trimmed.length > 120) {
    throw new Error("Purchase source must be 120 characters or fewer.");
  }
  return trimmed;
}

/**
 * Apply a stock-in receipt inside an existing transaction (product must already exist).
 */
export function applyStockInInTransaction(
  tx: Transaction,
  db: Firestore,
  productId: string,
  productRef: DocumentReference,
  product: ProductDoc | undefined,
  quantity: number,
  unitCost: number | undefined,
  salePrice: number | undefined,
  pricingContext: {
    categoryTemplates: Record<string, import("@/lib/types/firestore").CategoryMarginTemplate>;
    globalDefault: number;
  } | undefined,
  purchaseSource: string,
): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  assertNonNegativeMoney("Sale price", salePrice);
  const resolvedPurchaseSource = normalizePurchaseSource(purchaseSource);
  const resolvedUnitCost = resolveStockInUnitCost(product, unitCost);

  const patch: {
    stock_quantity: ReturnType<typeof increment>;
    cost_price: number;
    sale_price?: number;
  } = {
    stock_quantity: increment(quantity),
    cost_price: resolvedUnitCost,
  };
  if (salePrice !== undefined) {
    patch.sale_price = salePrice;
  }
  if (pricingContext && salePrice === undefined) {
    applyAutomaticPricingToPatch(
      product,
      patch,
      pricingContext.categoryTemplates,
      pricingContext.globalDefault,
    );
  }
  tx.update(productRef, patch);
  const lotRef = doc(collection(db, COLLECTIONS.stockLots));
  tx.set(lotRef, {
    product_id: productId,
    unit_cost: resolvedUnitCost,
    qty_in: quantity,
    qty_remaining: quantity,
    source: "stock_in",
    purchase_source: resolvedPurchaseSource,
    received_at: serverTimestamp(),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  } satisfies Omit<StockLotDoc, "received_at" | "created_at" | "updated_at"> & {
    received_at: unknown;
    created_at: unknown;
    updated_at: unknown;
  });
}

/**
 * Increase stock atomically (stock in).
 * @param unitCost - Cost per unit for this receipt; omitted or undefined uses the product's current cost_price.
 * @param salePrice - When set, updates the product's `sale_price` immediately (not tied to FIFO lots).
 */
export async function stockIn(
  db: Firestore,
  productId: string,
  quantity: number,
  unitCost: number | undefined,
  salePrice: number | undefined,
  purchaseSource: string,
): Promise<void> {
  const settings = await loadPricingSettings(db);
  const ref = doc(db, COLLECTIONS.products, productId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error("Product not found.");
    }
    const product = snap.data() as ProductDoc | undefined;
    applyStockInInTransaction(
      tx,
      db,
      productId,
      ref,
      product,
      quantity,
      unitCost,
      salePrice,
      {
        categoryTemplates: settings.categoryTemplates,
        globalDefault: settings.globalDefaultTargetMarginPercent,
      },
      purchaseSource,
    );
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

  /** Stable order so transaction reads are deterministic across retries. */
  const sortedLotCandidateIds = [...lotCandidateIds].sort();
  const settings = await loadPricingSettings(db);

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

    // All reads before any writes (Firestore transaction requirement).
    const lots: Array<{ id: string; data: StockLotDoc }> = [];
    for (const lotId of sortedLotCandidateIds) {
      const lotRef = doc(db, COLLECTIONS.stockLots, lotId);
      const lotSnap = await transaction.get(lotRef);
      if (!lotSnap.exists()) continue;
      const lotData = lotSnap.data() as StockLotDoc;
      if (lotData.product_id === productId) {
        lots.push({ id: lotId, data: lotData });
      }
    }
    lots.sort((a, b) => a.data.received_at.toMillis() - b.data.received_at.toMillis());

    const lotUpdates: Array<{ id: string; qty_remaining: number }> = [];
    let remaining = quantity;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const available = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      remaining -= take;
      lotUpdates.push({ id: lot.id, qty_remaining: available - take });
    }
    if (remaining > 0) {
      throw new Error("Stock lots are out of sync. Please restock this product.");
    }

    const nextCostPrice = listCostFromProductLots(
      lots,
      lotUpdates.map((u) => ({ id: u.id, qty_remaining: u.qty_remaining })),
    );

    const stockPatch: Record<string, unknown> = {
      stock_quantity: increment(-quantity),
      cost_price: nextCostPrice,
    };
    applyAutomaticPricingToPatch(
      data as ProductDoc,
      stockPatch,
      settings.categoryTemplates,
      settings.globalDefaultTargetMarginPercent,
    );
    transaction.update(ref, stockPatch);
    for (const u of lotUpdates) {
      transaction.update(doc(db, COLLECTIONS.stockLots, u.id), {
        qty_remaining: u.qty_remaining,
        updated_at: serverTimestamp(),
      });
    }
  });
}
