import {
  collection,
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  fetchStockLotIdsForProduct,
  isFirestoreContentionError,
} from "@/lib/firestore/stockLotsQuery";
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory/constants";
import { assertStockLotInvariant } from "@/lib/inventory/invariantCheck";
import {
  notifyInventoryPosted,
  recordInventoryTransactionInTx,
} from "@/lib/inventory/inventoryTransactionService";
import { listCostFromProductLots } from "@/lib/inventory/lotPricing";
import { getAuthClient } from "@/lib/firebase";
import type { ProductDoc, StockLotDoc, TraderDoc } from "@/lib/types/firestore";

function resolveTraderId(traderId: string | undefined): string {
  const id = traderId?.trim();
  if (!id) {
    throw new Error("Trader is required.");
  }
  return id;
}

function resolveTraderName(traderName: string): string {
  return normalizePurchaseSource(traderName);
}

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
    throw new Error("Trader name is required.");
  }
  if (trimmed.length > 120) {
    throw new Error("Trader name must be 120 characters or fewer.");
  }
  return trimmed;
}

/** Load a trader's display name for denormalizing onto stock-in receipts. */
export async function loadTraderNameForStockIn(db: Firestore, traderId: string): Promise<string> {
  const resolvedId = resolveTraderId(traderId);
  const snap = await getDoc(doc(db, COLLECTIONS.traders, resolvedId));
  if (!snap.exists()) {
    throw new Error("Trader not found.");
  }
  const trader = snap.data() as TraderDoc;
  return resolveTraderName(trader.name);
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
  traderId: string,
  traderName: string,
): string {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  assertNonNegativeMoney("Sale price", salePrice);
  const resolvedTraderId = resolveTraderId(traderId);
  const resolvedPurchaseSource = resolveTraderName(traderName);
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
  tx.update(productRef, patch);
  const lotRef = doc(collection(db, COLLECTIONS.stockLots));
  tx.set(lotRef, {
    product_id: productId,
    unit_cost: resolvedUnitCost,
    qty_in: quantity,
    qty_remaining: quantity,
    source: "stock_in",
    purchase_source: resolvedPurchaseSource,
    trader_id: resolvedTraderId,
    warehouse_id: DEFAULT_WAREHOUSE_ID,
    received_at: serverTimestamp(),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  } satisfies Omit<StockLotDoc, "received_at" | "created_at" | "updated_at"> & {
    received_at: unknown;
    created_at: unknown;
    updated_at: unknown;
  });
  return lotRef.id;
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
  traderId: string,
  traderName: string,
): Promise<void> {
  const ref = doc(db, COLLECTIONS.products, productId);
  const uid = getAuthClient().currentUser?.uid;
  let txnResult: ReturnType<typeof recordInventoryTransactionInTx> = null;

  const runStockInTx = async () => {
    const sortedLotIds = await fetchStockLotIdsForProduct(db, productId);
    await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error("Product not found.");
    }
    const product = snap.data() as ProductDoc | undefined;
    const beforeStock = typeof product?.stock_quantity === "number" ? product.stock_quantity : 0;

    const lotsForCheck: Array<{ id: string; data: StockLotDoc }> = [];
    for (const id of sortedLotIds) {
      const lotSnap = await tx.get(doc(db, COLLECTIONS.stockLots, id));
      if (lotSnap.exists()) {
        lotsForCheck.push({ id, data: lotSnap.data() as StockLotDoc });
      }
    }

    const lotId = applyStockInInTransaction(
      tx,
      db,
      productId,
      ref,
      product,
      quantity,
      unitCost,
      salePrice,
      traderId,
      traderName,
    );

    const unitCostUsed = unitCost ?? (typeof product?.cost_price === "number" ? product.cost_price : 0);
    lotsForCheck.push({
      id: lotId,
      data: {
        product_id: productId,
        unit_cost: unitCostUsed,
        qty_in: quantity,
        qty_remaining: quantity,
        source: "stock_in",
        warehouse_id: DEFAULT_WAREHOUSE_ID,
        received_at: product?.created_at ?? ({} as StockLotDoc["received_at"]),
        created_at: product?.created_at ?? ({} as StockLotDoc["created_at"]),
        updated_at: product?.created_at ?? ({} as StockLotDoc["updated_at"]),
      },
    });

    txnResult = recordInventoryTransactionInTx(tx, db, {
      type: "PURCHASE_RECEIPT",
      warehouse_id: DEFAULT_WAREHOUSE_ID,
      source_document_type: "stock_in",
      source_document_id: productId,
      posted_by_uid: uid,
      lines: [
        {
          product_id: productId,
          warehouse_id: DEFAULT_WAREHOUSE_ID,
          direction: "in",
          quantity,
          unit_cost: unitCostUsed,
          lot_id: lotId,
          before_on_hand: beforeStock,
          after_on_hand: beforeStock + quantity,
        },
      ],
    });

    const afterProduct: ProductDoc = {
      ...(product as ProductDoc),
      stock_quantity: beforeStock + quantity,
      cost_price: unitCostUsed,
    };
    assertStockLotInvariant(productId, afterProduct, lotsForCheck);
    });
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await runStockInTx();
      break;
    } catch (e) {
      if (!isFirestoreContentionError(e) || attempt === 2) throw e;
    }
  }

  if (txnResult) {
    const unitCostUsed =
      unitCost ??
      (await (async () => {
        const s = await getDoc(ref);
        const p = s.data() as ProductDoc | undefined;
        return typeof p?.cost_price === "number" ? p.cost_price : 0;
      })());
    await notifyInventoryPosted(txnResult, {
      type: "PURCHASE_RECEIPT",
      warehouse_id: DEFAULT_WAREHOUSE_ID,
      source_document_type: "stock_in",
      source_document_id: productId,
      posted_by_uid: uid,
      lines: [
        {
          product_id: productId,
          warehouse_id: DEFAULT_WAREHOUSE_ID,
          direction: "in",
          quantity,
          unit_cost: unitCostUsed,
        },
      ],
    });
  }
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
  const uid = getAuthClient().currentUser?.uid;
  let txnResult: ReturnType<typeof recordInventoryTransactionInTx> = null;

  const runStockOutTx = async () => {
    const sortedLotCandidateIds = await fetchStockLotIdsForProduct(db, productId);
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

    transaction.update(ref, {
      stock_quantity: increment(-quantity),
      cost_price: nextCostPrice,
    });
    for (const u of lotUpdates) {
      transaction.update(doc(db, COLLECTIONS.stockLots, u.id), {
        qty_remaining: u.qty_remaining,
        updated_at: serverTimestamp(),
      });
      const row = lots.find((l) => l.id === u.id);
      if (row) row.data.qty_remaining = u.qty_remaining;
    }

    txnResult = recordInventoryTransactionInTx(transaction, db, {
      type: "STOCK_ISSUE",
      warehouse_id: DEFAULT_WAREHOUSE_ID,
      source_document_type: "stock_out",
      source_document_id: productId,
      posted_by_uid: uid,
      lines: [
        {
          product_id: productId,
          warehouse_id: DEFAULT_WAREHOUSE_ID,
          direction: "out",
          quantity,
          unit_cost: nextCostPrice,
          before_on_hand: current,
          after_on_hand: current - quantity,
        },
      ],
    });

    const afterProduct: ProductDoc = {
      ...(data as ProductDoc),
      stock_quantity: current - quantity,
      cost_price: nextCostPrice,
    };
    assertStockLotInvariant(productId, afterProduct, lots);
    });
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await runStockOutTx();
      break;
    } catch (e) {
      if (!isFirestoreContentionError(e) || attempt === 2) throw e;
    }
  }

  if (txnResult) {
    await notifyInventoryPosted(txnResult, {
      type: "STOCK_ISSUE",
      warehouse_id: DEFAULT_WAREHOUSE_ID,
      source_document_type: "stock_out",
      source_document_id: productId,
      posted_by_uid: uid,
      lines: [
        {
          product_id: productId,
          warehouse_id: DEFAULT_WAREHOUSE_ID,
          direction: "out",
          quantity,
          unit_cost: 0,
        },
      ],
    });
  }
}
