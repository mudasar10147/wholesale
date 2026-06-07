import {
  collection,
  doc,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { applyAutomaticPricingToPatch } from "@/lib/firestore/pricing";
import { loadPricingSettings } from "@/lib/firestore/pricingSettings";
import { listCostFromProductLots } from "@/lib/inventory/lotPricing";
import type { ProductDoc, StockLotDoc } from "@/lib/types/firestore";

export type InventoryDiscardLineInput = {
  product_id: string;
  quantity: number;
};

export type PostInventoryDiscardInput = {
  lines: InventoryDiscardLineInput[];
  reason?: string;
  notes?: string;
};

type MergedLine = {
  product_id: string;
  quantity: number;
};

type PlannedItem = {
  ref: DocumentReference;
  product_id: string;
  quantity: number;
  cogs_amount: number;
  lotRows: Array<{
    lot_id: string;
    quantity: number;
    unit_cost: number;
    cogs_amount: number;
  }>;
  lotUpdates: Array<{ id: string; qty_remaining: number }>;
  lotsForCost: Array<{ id: string; data: StockLotDoc }>;
};

function generateDiscardNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `DISC-${y}${m}${d}-${rand}`;
}

function mergeDiscardLines(lines: InventoryDiscardLineInput[]): MergedLine[] {
  const byProduct = new Map<string, number>();
  for (const line of lines) {
    const productId = line.product_id.trim();
    if (!productId) {
      throw new Error("Each line must have a product.");
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Each quantity must be a positive whole number.");
    }
    byProduct.set(productId, (byProduct.get(productId) ?? 0) + line.quantity);
  }
  if (byProduct.size === 0) {
    throw new Error("Add at least one product line.");
  }
  return [...byProduct.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
}

async function loadLotCandidateIdsByProduct(
  db: Firestore,
  productIds: Set<string>,
): Promise<Map<string, string[]>> {
  const snap = await getDocs(collection(db, COLLECTIONS.stockLots));
  const byProduct = new Map<string, string[]>();
  for (const productId of productIds) {
    byProduct.set(productId, []);
  }
  snap.forEach((d) => {
    const data = d.data() as Partial<StockLotDoc>;
    const productId = data.product_id;
    if (productId && productIds.has(productId)) {
      byProduct.get(productId)!.push(d.id);
    }
  });
  for (const [productId, ids] of byProduct) {
    byProduct.set(productId, [...ids].sort());
  }
  return byProduct;
}

function computeFifoDiscardForProduct(
  productId: string,
  quantity: number,
  candidateLotIds: string[],
  lotsById: Map<string, { id: string; data: StockLotDoc }>,
): Omit<PlannedItem, "ref" | "product_id" | "quantity"> & {
  lotUpdates: Array<{ id: string; qty_remaining: number }>;
  lotsForCost: Array<{ id: string; data: StockLotDoc }>;
  cogs_amount: number;
  lotRows: PlannedItem["lotRows"];
} {
  const lots = candidateLotIds
    .map((id) => lotsById.get(id))
    .filter((lot): lot is { id: string; data: StockLotDoc } => {
      return lot != null && lot.data.product_id === productId;
    });
  lots.sort((a, b) => a.data.received_at.toMillis() - b.data.received_at.toMillis());

  const lotUpdates: Array<{ id: string; qty_remaining: number }> = [];
  const lotRows: PlannedItem["lotRows"] = [];
  let remaining = quantity;
  let lineCogs = 0;

  for (const lot of lots) {
    if (remaining <= 0) break;
    const available =
      typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    remaining -= take;
    const unitCost =
      typeof lot.data.unit_cost === "number" && Number.isFinite(lot.data.unit_cost)
        ? lot.data.unit_cost
        : 0;
    const cogsChunk = take * unitCost;
    lineCogs += cogsChunk;
    lotUpdates.push({ id: lot.id, qty_remaining: available - take });
    lotRows.push({
      lot_id: lot.id,
      quantity: take,
      unit_cost: unitCost,
      cogs_amount: cogsChunk,
    });
  }

  if (remaining > 0) {
    throw new Error("Stock lots are out of sync. Please restock this product.");
  }

  return {
    cogs_amount: lineCogs,
    lotRows,
    lotUpdates,
    lotsForCost: lots,
  };
}

/**
 * Discard stock without an invoice — FIFO-consumes lots, records COGS write-off audit.
 */
export async function postInventoryDiscard(
  db: Firestore,
  input: PostInventoryDiscardInput,
): Promise<string> {
  const merged = mergeDiscardLines(input.lines);
  const productIds = new Set(merged.map((l) => l.product_id));
  const lotIdsByProduct = await loadLotCandidateIdsByProduct(db, productIds);
  const allLotIds = [
    ...new Set([...lotIdsByProduct.values()].flat()),
  ].sort();

  const discardRef = doc(collection(db, COLLECTIONS.inventoryDiscards));
  const discardId = discardRef.id;
  const reason = input.reason?.trim();
  const notes = input.notes?.trim();
  if (reason && reason.length > 300) {
    throw new Error("Reason must be 300 characters or fewer.");
  }
  if (notes && notes.length > 500) {
    throw new Error("Notes must be 500 characters or fewer.");
  }

  const pricingSettings = await loadPricingSettings(db);

  await runTransaction(db, async (tx) => {
    const productSnaps = new Map<string, ProductDoc>();
    for (const productId of productIds) {
      const productRef = doc(db, COLLECTIONS.products, productId);
      const snap = await tx.get(productRef);
      if (!snap.exists()) {
        throw new Error("Product not found.");
      }
      productSnaps.set(productId, snap.data() as ProductDoc);
    }

    const lotsById = new Map<string, { id: string; data: StockLotDoc }>();
    for (const lotId of allLotIds) {
      const lotRef = doc(db, COLLECTIONS.stockLots, lotId);
      const lotSnap = await tx.get(lotRef);
      if (!lotSnap.exists()) continue;
      lotsById.set(lotId, { id: lotId, data: lotSnap.data() as StockLotDoc });
    }

    const plannedItems: PlannedItem[] = [];
    let totalQuantity = 0;
    let totalCogs = 0;

    for (const line of merged) {
      const product = productSnaps.get(line.product_id)!;
      const current =
        typeof product.stock_quantity === "number" ? product.stock_quantity : 0;
      if (current < line.quantity) {
        const label = product.name?.trim() || line.product_id;
        throw new Error(`Not enough stock for ${label}. Available: ${current}.`);
      }

      const itemRef = doc(collection(db, COLLECTIONS.inventoryDiscardItems));
      const fifo = computeFifoDiscardForProduct(
        line.product_id,
        line.quantity,
        lotIdsByProduct.get(line.product_id) ?? [],
        lotsById,
      );

      plannedItems.push({
        ref: itemRef,
        product_id: line.product_id,
        quantity: line.quantity,
        ...fifo,
      });
      totalQuantity += line.quantity;
      totalCogs += fifo.cogs_amount;
    }

    const itemIds = plannedItems.map((p) => p.ref.id);

    tx.set(discardRef, {
      discard_number: generateDiscardNumber(),
      ...(reason ? { reason } : {}),
      ...(notes ? { notes } : {}),
      total_quantity: totalQuantity,
      total_cogs_amount: totalCogs,
      item_ids: itemIds,
      created_at: serverTimestamp(),
    });

    for (const item of plannedItems) {
      tx.set(item.ref, {
        discard_id: discardId,
        product_id: item.product_id,
        quantity: item.quantity,
        cogs_amount: item.cogs_amount,
        created_at: serverTimestamp(),
      });

      for (const lotRow of item.lotRows) {
        tx.set(doc(collection(db, COLLECTIONS.inventoryDiscardLots)), {
          discard_id: discardId,
          discard_item_id: item.ref.id,
          lot_id: lotRow.lot_id,
          product_id: item.product_id,
          quantity: lotRow.quantity,
          unit_cost: lotRow.unit_cost,
          cogs_amount: lotRow.cogs_amount,
          created_at: serverTimestamp(),
        });
      }

      const productRef = doc(db, COLLECTIONS.products, item.product_id);
      const product = productSnaps.get(item.product_id)!;
      const nextCostPrice = listCostFromProductLots(
        item.lotsForCost,
        item.lotUpdates.map((u) => ({ id: u.id, qty_remaining: u.qty_remaining })),
      );
      const productPatch: Record<string, unknown> = {
        stock_quantity: increment(-item.quantity),
        cost_price: nextCostPrice,
      };
      applyAutomaticPricingToPatch(
        product,
        productPatch,
        pricingSettings.categoryTemplates,
        pricingSettings.globalDefaultTargetMarginPercent,
      );
      tx.update(productRef, productPatch);

      for (const lotUpdate of item.lotUpdates) {
        tx.update(doc(db, COLLECTIONS.stockLots, lotUpdate.id), {
          qty_remaining: lotUpdate.qty_remaining,
          updated_at: serverTimestamp(),
        });
      }
    }
  });

  return discardId;
}
