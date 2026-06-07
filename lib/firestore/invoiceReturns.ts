import { FirebaseError } from "firebase/app";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { derivePaymentStatus, getInvoicePaidAmount, getInvoicePostedTotal, getInvoiceReturnedAmount } from "@/lib/invoices/invoiceEffective";
import {
  calculateReturnSummary,
  normalizeReturnLineSplit,
  type ReturnLineInput,
} from "@/lib/invoices/returnCalculations";
import type {
  InvoiceDoc,
  InvoiceItemDoc,
  InvoiceReturnDoc,
  InvoiceReturnItemDoc,
  LotConsumptionDoc,
  ProductDoc,
  ReturnLotRestorationDoc,
  ReturnLotWriteOffDoc,
  StockLotDoc,
} from "@/lib/types/firestore";
import { normalizeOrderId } from "@/lib/validation/contracts";
import { getAuthClient } from "@/lib/firebase";
import { logFirestoreAuthForDebug, logFirestoreError } from "@/lib/firebase/firestoreDebug";

const FIRESTORE_TXN_DOC_CAP = 500;

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export type ReturnableLine = {
  original_invoice_item_id: string;
  product_id: string;
  sold_quantity: number;
  already_returned: number;
  returnable_quantity: number;
  unit_price: number;
  line_discount: number;
  line_delivery_charge: number;
  line_total: number;
};

export type ReturnableContext = {
  invoice: InvoiceDoc & { id: string };
  lines: ReturnableLine[];
};

export type CreateReturnInput = {
  original_invoice_id: string;
  lines: ReturnLineInput[];
  settlement_type: InvoiceReturnDoc["settlement_type"];
  return_reason?: string;
  notes?: string;
};

export type UpdateReturnDraftInput = CreateReturnInput;

function generateReturnNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `RET-${y}${m}${d}-${rand}`;
}

async function loadPostedReturnIds(db: Firestore, invoiceId: string): Promise<Set<string>> {
  const returnsQ = query(
    collection(db, COLLECTIONS.invoiceReturns),
    where("original_invoice_id", "==", invoiceId),
  );
  const snap = await getDocs(returnsQ);
  const ids = new Set<string>();
  snap.forEach((d) => {
    const data = d.data() as InvoiceReturnDoc;
    if (data.status === "posted") ids.add(d.id);
  });
  return ids;
}

export type InvoiceReturnBlockers = {
  postedCount: number;
  draftCount: number;
};

/** Returns linked to an invoice that prevent voiding the whole sale. */
export async function loadInvoiceReturnBlockers(
  db: Firestore,
  invoiceId: string,
): Promise<InvoiceReturnBlockers> {
  const trimmedId = invoiceId.trim();
  if (!trimmedId) return { postedCount: 0, draftCount: 0 };

  const returnsQ = query(
    collection(db, COLLECTIONS.invoiceReturns),
    where("original_invoice_id", "==", trimmedId),
  );
  const snap = await getDocs(returnsQ);
  let postedCount = 0;
  let draftCount = 0;
  snap.forEach((d) => {
    const status = (d.data() as InvoiceReturnDoc).status;
    if (status === "posted") postedCount += 1;
    else if (status === "draft") draftCount += 1;
  });
  return { postedCount, draftCount };
}

export function formatInvoiceVoidBlockedMessage(blockers: InvoiceReturnBlockers): string {
  if (blockers.postedCount > 0) {
    const noun = blockers.postedCount === 1 ? "return is" : "returns are";
    return `Cannot void this invoice: ${blockers.postedCount} posted ${noun} linked. Credit remaining items with returns instead of voiding the whole sale.`;
  }
  if (blockers.draftCount > 0) {
    const noun = blockers.draftCount === 1 ? "return draft is" : "return drafts are";
    return `Cannot void this invoice: ${blockers.draftCount} ${noun} open. Delete or post those returns first.`;
  }
  return "";
}

export async function loadReturnedQtyByItemId(
  db: Firestore,
  invoiceId: string,
): Promise<Map<string, number>> {
  const postedReturnIds = await loadPostedReturnIds(db, invoiceId);
  if (postedReturnIds.size === 0) return new Map();

  const itemsQ = query(
    collection(db, COLLECTIONS.invoiceReturnItems),
    where("original_invoice_id", "==", invoiceId),
  );
  const snap = await getDocs(itemsQ);
  const byItem = new Map<string, number>();
  snap.forEach((d) => {
    const item = d.data() as InvoiceReturnItemDoc;
    if (!postedReturnIds.has(item.return_id)) return;
    const prev = byItem.get(item.original_invoice_item_id) ?? 0;
    byItem.set(item.original_invoice_item_id, prev + item.quantity_returned);
  });
  return byItem;
}

export async function loadReturnableContext(
  db: Firestore,
  rawInvoiceId: string,
): Promise<ReturnableContext> {
  const invoiceId = normalizeOrderId(rawInvoiceId);
  const invoiceRef = doc(db, COLLECTIONS.invoices, invoiceId);
  const invoiceSnap = await getDoc(invoiceRef);
  if (!invoiceSnap.exists()) throw new Error("Invoice not found.");
  const invoice = { id: invoiceSnap.id, ...(invoiceSnap.data() as InvoiceDoc) };
  if (invoice.status !== "posted") {
    throw new Error("Only posted invoices can have returns.");
  }

  const returnedByItem = await loadReturnedQtyByItemId(db, invoiceId);
  const itemIds = Array.isArray(invoice.item_ids) ? invoice.item_ids.filter(Boolean) : [];
  const lines: ReturnableLine[] = [];

  for (const itemId of itemIds) {
    const itemSnap = await getDoc(doc(db, COLLECTIONS.invoiceItems, itemId));
    if (!itemSnap.exists()) continue;
    const item = itemSnap.data() as InvoiceItemDoc;
    if (item.invoice_id !== invoiceId) continue;
    const sold = item.quantity;
    const already = returnedByItem.get(itemId) ?? 0;
    lines.push({
      original_invoice_item_id: itemId,
      product_id: item.product_id,
      sold_quantity: sold,
      already_returned: already,
      returnable_quantity: Math.max(0, sold - already),
      unit_price: item.unit_price,
      line_discount: item.line_discount,
      line_delivery_charge: item.line_delivery_charge,
      line_total: item.line_total,
    });
  }

  return { invoice, lines };
}

function validateReturnLinesAgainstReturnable(
  lines: ReturnLineInput[],
  returnable: ReturnableLine[],
): void {
  const returnableByItem = new Map(returnable.map((l) => [l.original_invoice_item_id, l]));
  let hasPositive = false;
  for (const line of lines) {
    const split = normalizeReturnLineSplit(line);
    const qty = split.quantity_returned;
    if (qty <= 0) continue;
    hasPositive = true;
    const cap = returnableByItem.get(line.original_invoice_item_id);
    if (!cap) throw new Error("Return line does not match the original invoice.");
    if (cap.product_id !== line.product_id) throw new Error("Product mismatch on return line.");
    if (qty > cap.returnable_quantity) {
      throw new Error(
        `Cannot return ${qty} units — only ${cap.returnable_quantity} returnable for this line.`,
      );
    }
    if (split.quantity_restock > qty || split.quantity_discard > qty) {
      throw new Error("Restock or discard quantity exceeds return quantity.");
    }
  }
  if (!hasPositive) throw new Error("Select at least one item quantity to return.");
}

function getReturnItemQuantities(item: InvoiceReturnItemDoc): {
  total: number;
  restock: number;
  discard: number;
} {
  const total = item.quantity_returned;
  if (
    typeof item.quantity_restock === "number" &&
    typeof item.quantity_discard === "number"
  ) {
    return {
      total,
      restock: item.quantity_restock,
      discard: item.quantity_discard,
    };
  }
  return { total, restock: total, discard: 0 };
}

async function buildOriginalItemsMap(
  db: Firestore,
  invoiceId: string,
  itemIds: string[],
): Promise<Map<string, InvoiceItemDoc>> {
  const map = new Map<string, InvoiceItemDoc>();
  for (const itemId of itemIds) {
    const snap = await getDoc(doc(db, COLLECTIONS.invoiceItems, itemId));
    if (!snap.exists()) throw new Error("Original invoice line not found.");
    const item = snap.data() as InvoiceItemDoc;
    if (item.invoice_id !== invoiceId) throw new Error("Invoice item mismatch.");
    map.set(itemId, item);
  }
  return map;
}

export async function createReturnDraft(
  db: Firestore,
  input: CreateReturnInput,
): Promise<{ returnId: string }> {
  const invoiceId = normalizeOrderId(input.original_invoice_id);
  const ctx = await loadReturnableContext(db, invoiceId);
  validateReturnLinesAgainstReturnable(input.lines, ctx.lines);

  const originalItems = await buildOriginalItemsMap(db, invoiceId, ctx.invoice.item_ids);
  const calc = calculateReturnSummary(
    input.lines.filter((l) => l.quantity_returned > 0),
    originalItems,
  );

  const returnRef = doc(collection(db, COLLECTIONS.invoiceReturns));
  const itemRefs = calc.lines.map(() => doc(collection(db, COLLECTIONS.invoiceReturnItems)));

  await runTransaction(db, async (tx) => {
    const invoiceSnap = await tx.get(doc(db, COLLECTIONS.invoices, invoiceId));
    if (!invoiceSnap.exists()) throw new Error("Invoice not found.");
    const invoice = invoiceSnap.data() as InvoiceDoc;
    if (invoice.status !== "posted") throw new Error("Only posted invoices can have returns.");

    tx.set(returnRef, {
      return_number: generateReturnNumber(),
      original_invoice_id: invoiceId,
      order_id: invoice.order_id,
      customer_id: invoice.customer_id,
      status: "draft",
      settlement_type: input.settlement_type,
      item_ids: itemRefs.map((r) => r.id),
      subtotal_amount: calc.subtotal_amount,
      total_amount: calc.total_amount,
      refund_amount: 0,
      ...(input.return_reason?.trim() ? { return_reason: input.return_reason.trim() } : {}),
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    } satisfies Omit<InvoiceReturnDoc, "created_at" | "updated_at"> & {
      created_at: unknown;
      updated_at: unknown;
    });

    calc.lines.forEach((line, idx) => {
      tx.set(itemRefs[idx]!, {
        return_id: returnRef.id,
        original_invoice_id: invoiceId,
        original_invoice_item_id: line.original_invoice_item_id,
        customer_id: invoice.customer_id,
        order_id: invoice.order_id,
        product_id: line.product_id,
        quantity_returned: line.quantity_returned,
        quantity_restock: line.quantity_restock,
        quantity_discard: line.quantity_discard,
        unit_price: line.unit_price,
        line_discount: line.line_discount,
        line_delivery_charge: line.line_delivery_charge,
        line_total: line.line_total,
        cogs_amount: 0,
        write_off_cogs_amount: 0,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    });
  });

  return { returnId: returnRef.id };
}

export async function updateReturnDraft(
  db: Firestore,
  returnId: string,
  input: UpdateReturnDraftInput,
): Promise<void> {
  const trimmedReturnId = returnId.trim();
  const invoiceId = normalizeOrderId(input.original_invoice_id);
  const ctx = await loadReturnableContext(db, invoiceId);
  validateReturnLinesAgainstReturnable(input.lines, ctx.lines);

  const originalItems = await buildOriginalItemsMap(db, invoiceId, ctx.invoice.item_ids);
  const calc = calculateReturnSummary(
    input.lines.filter((l) => l.quantity_returned > 0),
    originalItems,
  );

  const returnRef = doc(db, COLLECTIONS.invoiceReturns, trimmedReturnId);
  const returnSnap = await getDoc(returnRef);
  if (!returnSnap.exists()) throw new Error("Return not found.");
  const existing = returnSnap.data() as InvoiceReturnDoc;
  if (existing.status !== "draft") throw new Error("Only draft returns can be edited.");

  const oldItemIds = Array.isArray(existing.item_ids) ? existing.item_ids.filter(Boolean) : [];
  const newItemRefs = calc.lines.map(() => doc(collection(db, COLLECTIONS.invoiceReturnItems)));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(returnRef);
    if (!snap.exists()) throw new Error("Return not found.");
    const ret = snap.data() as InvoiceReturnDoc;
    if (ret.status !== "draft") throw new Error("Only draft returns can be edited.");

    for (const oldId of oldItemIds) {
      tx.delete(doc(db, COLLECTIONS.invoiceReturnItems, oldId));
    }

    tx.update(returnRef, {
      settlement_type: input.settlement_type,
      item_ids: newItemRefs.map((r) => r.id),
      subtotal_amount: calc.subtotal_amount,
      total_amount: calc.total_amount,
      refund_amount: 0,
      ...(input.return_reason?.trim() ? { return_reason: input.return_reason.trim() } : {}),
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      updated_at: serverTimestamp(),
    });

    calc.lines.forEach((line, idx) => {
      tx.set(newItemRefs[idx]!, {
        return_id: trimmedReturnId,
        original_invoice_id: invoiceId,
        original_invoice_item_id: line.original_invoice_item_id,
        customer_id: ret.customer_id,
        order_id: ret.order_id,
        product_id: line.product_id,
        quantity_returned: line.quantity_returned,
        quantity_restock: line.quantity_restock,
        quantity_discard: line.quantity_discard,
        unit_price: line.unit_price,
        line_discount: line.line_discount,
        line_delivery_charge: line.line_delivery_charge,
        line_total: line.line_total,
        cogs_amount: 0,
        write_off_cogs_amount: 0,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    });
  });
}

export async function deleteReturnDraft(db: Firestore, returnId: string): Promise<void> {
  const trimmedReturnId = returnId.trim();
  const returnRef = doc(db, COLLECTIONS.invoiceReturns, trimmedReturnId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(returnRef);
    if (!snap.exists()) throw new Error("Return not found.");
    const ret = snap.data() as InvoiceReturnDoc;
    if (ret.status !== "draft") throw new Error("Only draft returns can be deleted.");
    const itemIds = Array.isArray(ret.item_ids) ? ret.item_ids.filter(Boolean) : [];
    for (const itemId of itemIds) {
      tx.delete(doc(db, COLLECTIONS.invoiceReturnItems, itemId));
    }
    tx.delete(returnRef);
  });
}

type ConsumptionRow = { id: string; data: LotConsumptionDoc };

function sortConsumptionsLifo(rows: ConsumptionRow[]): ConsumptionRow[] {
  return [...rows].sort((a, b) => {
    const at = typeof a.data.created_at?.toMillis === "function" ? a.data.created_at.toMillis() : 0;
    const bt = typeof b.data.created_at?.toMillis === "function" ? b.data.created_at.toMillis() : 0;
    return bt - at;
  });
}

type AllocationChunk = {
  consumptionId: string;
  lotId: string;
  productId: string;
  invoiceItemId: string;
  quantity: number;
  unitCost: number;
  cogsAmount: number;
};

function computePendingReturnAllocations(
  returnItems: Array<{ id: string; data: InvoiceReturnItemDoc }>,
  allConsumptions: ConsumptionRow[],
  restoredByConsumption: Map<string, number>,
  writtenOffByConsumption: Map<string, number>,
): {
  pendingRestores: AllocationChunk[];
  pendingWriteOffs: AllocationChunk[];
  lineRestockCogsByItemId: Map<string, number>;
  lineWriteOffCogsByItemId: Map<string, number>;
  restoreByLot: Map<string, number>;
  restoreByProduct: Map<string, number>;
} {
  const consumptionsByItem = new Map<string, ConsumptionRow[]>();
  for (const c of allConsumptions) {
    if (c.data.reversed_at) continue;
    const priorUsed =
      (restoredByConsumption.get(c.id) ?? 0) + (writtenOffByConsumption.get(c.id) ?? 0);
    const available = c.data.quantity - priorUsed;
    if (available <= 0) continue;
    const list = consumptionsByItem.get(c.data.invoice_item_id) ?? [];
    list.push(c);
    consumptionsByItem.set(c.data.invoice_item_id, list);
  }
  for (const [key, list] of consumptionsByItem) {
    consumptionsByItem.set(key, sortConsumptionsLifo(list));
  }

  const pendingRestores: AllocationChunk[] = [];
  const pendingWriteOffs: AllocationChunk[] = [];
  const lineRestockCogsByItemId = new Map<string, number>();
  const lineWriteOffCogsByItemId = new Map<string, number>();
  const restoreByLot = new Map<string, number>();
  const restoreByProduct = new Map<string, number>();
  const consumedInThisReturn = new Map<string, number>();

  function availableOnChunk(chunk: ConsumptionRow): number {
    const priorUsed =
      (restoredByConsumption.get(chunk.id) ?? 0) + (writtenOffByConsumption.get(chunk.id) ?? 0);
    const inFlight = consumedInThisReturn.get(chunk.id) ?? 0;
    return chunk.data.quantity - priorUsed - inFlight;
  }

  function allocateFromChunks(
    chunks: ConsumptionRow[],
    need: number,
    target: AllocationChunk[],
    updateStock: boolean,
  ): { allocatedQty: number; allocatedCogs: number } {
    let remaining = need;
    let allocatedCogs = 0;
    for (const chunk of chunks) {
      if (remaining <= 0) break;
      const available = availableOnChunk(chunk);
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      remaining -= take;
      const unitCost = chunk.data.unit_cost;
      const cogsAmount = roundMoney2(unitCost * take);
      allocatedCogs += cogsAmount;
      consumedInThisReturn.set(chunk.id, (consumedInThisReturn.get(chunk.id) ?? 0) + take);
      target.push({
        consumptionId: chunk.id,
        lotId: chunk.data.lot_id,
        productId: chunk.data.product_id,
        invoiceItemId: chunk.data.invoice_item_id,
        quantity: take,
        unitCost,
        cogsAmount,
      });
      if (updateStock) {
        restoreByLot.set(
          chunk.data.lot_id,
          (restoreByLot.get(chunk.data.lot_id) ?? 0) + take,
        );
        restoreByProduct.set(
          chunk.data.product_id,
          (restoreByProduct.get(chunk.data.product_id) ?? 0) + take,
        );
      }
    }
    return { allocatedQty: need - remaining, allocatedCogs: roundMoney2(allocatedCogs) };
  }

  for (const row of returnItems) {
    const item = row.data;
    const { restock, discard } = getReturnItemQuantities(item);
    const chunks = consumptionsByItem.get(item.original_invoice_item_id) ?? [];

    const restockResult = allocateFromChunks(chunks, restock, pendingRestores, true);
    const discardResult = allocateFromChunks(chunks, discard, pendingWriteOffs, false);

    if (restockResult.allocatedQty < restock || discardResult.allocatedQty < discard) {
      throw new Error("Not enough lot consumption history to process this return line.");
    }

    lineRestockCogsByItemId.set(row.id, restockResult.allocatedCogs);
    lineWriteOffCogsByItemId.set(row.id, discardResult.allocatedCogs);
  }

  return {
    pendingRestores,
    pendingWriteOffs,
    lineRestockCogsByItemId,
    lineWriteOffCogsByItemId,
    restoreByLot,
    restoreByProduct,
  };
}

export async function postReturn(db: Firestore, returnId: string): Promise<void> {
  const trimmedReturnId = returnId.trim();
  if (!trimmedReturnId) throw new Error("Return ID is required.");

  const auth = getAuthClient();
  if (auth.currentUser) {
    await auth.currentUser.getIdToken(true);
  }
  await logFirestoreAuthForDebug("postReturn (before transaction)");

  const returnRef = doc(db, COLLECTIONS.invoiceReturns, trimmedReturnId);
  const preReturnSnap = await getDoc(returnRef);
  if (!preReturnSnap.exists()) throw new Error("Return not found.");
  const preReturn = preReturnSnap.data() as InvoiceReturnDoc;
  if (preReturn.status === "posted") return;
  if (preReturn.status !== "draft") throw new Error("Only draft returns can be posted.");

  const invoiceId = preReturn.original_invoice_id;
  const itemIds = Array.isArray(preReturn.item_ids) ? preReturn.item_ids.filter(Boolean) : [];
  if (itemIds.length === 0) throw new Error("Return has no items.");

  const returnItems: Array<{ id: string; data: InvoiceReturnItemDoc }> = [];
  for (const itemId of itemIds) {
    const snap = await getDoc(doc(db, COLLECTIONS.invoiceReturnItems, itemId));
    if (!snap.exists()) throw new Error("Return items are incomplete.");
    returnItems.push({ id: itemId, data: snap.data() as InvoiceReturnItemDoc });
  }

  const consumptionQ = query(
    collection(db, COLLECTIONS.lotConsumptions),
    where("invoice_id", "==", invoiceId),
  );
  const consumptionSnap = await getDocs(consumptionQ);
  const allConsumptions: ConsumptionRow[] = [];
  consumptionSnap.forEach((d) => {
    allConsumptions.push({ id: d.id, data: d.data() as LotConsumptionDoc });
  });

  const restorationQ = query(
    collection(db, COLLECTIONS.returnLotRestorations),
    where("invoice_id", "==", invoiceId),
  );
  const restorationSnap = await getDocs(restorationQ);
  const restoredByConsumption = new Map<string, number>();
  restorationSnap.forEach((d) => {
    const row = d.data() as ReturnLotRestorationDoc;
    restoredByConsumption.set(
      row.consumption_id,
      (restoredByConsumption.get(row.consumption_id) ?? 0) + row.quantity,
    );
  });

  const writeOffQ = query(
    collection(db, COLLECTIONS.returnLotWriteOffs),
    where("invoice_id", "==", invoiceId),
  );
  const writeOffSnap = await getDocs(writeOffQ);
  const writtenOffByConsumption = new Map<string, number>();
  writeOffSnap.forEach((d) => {
    const row = d.data() as ReturnLotWriteOffDoc;
    writtenOffByConsumption.set(
      row.consumption_id,
      (writtenOffByConsumption.get(row.consumption_id) ?? 0) + row.quantity,
    );
  });

  try {
    const {
      pendingRestores,
      pendingWriteOffs,
      lineRestockCogsByItemId,
      lineWriteOffCogsByItemId,
      restoreByLot,
      restoreByProduct,
    } = computePendingReturnAllocations(
      returnItems,
      allConsumptions,
      restoredByConsumption,
      writtenOffByConsumption,
    );

    const totalWriteOffCogs = roundMoney2(
      [...lineWriteOffCogsByItemId.values()].reduce((sum, n) => sum + n, 0),
    );

    await runTransaction(db, async (tx) => {
      const retSnap = await tx.get(returnRef);
      if (!retSnap.exists()) throw new Error("Return not found.");
      const ret = retSnap.data() as InvoiceReturnDoc;
      if (ret.status === "posted") return;
      if (ret.status !== "draft") throw new Error("Only draft returns can be posted.");

      const invoiceRef = doc(db, COLLECTIONS.invoices, invoiceId);
      const invoiceSnap = await tx.get(invoiceRef);
      if (!invoiceSnap.exists()) throw new Error("Original invoice not found.");
      const invoice = invoiceSnap.data() as InvoiceDoc;
      if (invoice.status !== "posted") throw new Error("Original invoice is not posted.");

      const postedTotal = getInvoicePostedTotal(invoice);
      const returnedSoFar = getInvoiceReturnedAmount(invoice);
      const returnTotal = roundMoney2(ret.total_amount);
      if (returnedSoFar + returnTotal > postedTotal + 0.01) {
        throw new Error("Return total exceeds remaining invoice value.");
      }

      const refundAmount = roundMoney2(ret.total_amount);
      if (ret.settlement_type === "cash_refund") {
        const paidNow = getInvoicePaidAmount(invoice);
        if (refundAmount > paidNow + 0.01) {
          throw new Error("Cash refund exceeds amount paid on this invoice.");
        }
      }

      // Firestore transactions: all reads before any writes.
      const lotNextQtyById = new Map<string, number>();
      for (const [lotId, qtyRestore] of restoreByLot) {
        const lotRef = doc(db, COLLECTIONS.stockLots, lotId);
        const lotSnap = await tx.get(lotRef);
        if (!lotSnap.exists()) throw new Error("A consumed stock lot no longer exists.");
        const lot = lotSnap.data() as StockLotDoc;
        const current = typeof lot.qty_remaining === "number" ? lot.qty_remaining : 0;
        const lotIn = typeof lot.qty_in === "number" ? lot.qty_in : 0;
        const next = current + qtyRestore;
        if (next > lotIn) {
          throw new Error("Invalid restoration: lot quantity would exceed original intake.");
        }
        lotNextQtyById.set(lotId, next);
      }

      const productNextStockById = new Map<string, number>();
      for (const [productId, qtyRestore] of restoreByProduct) {
        const productRef = doc(db, COLLECTIONS.products, productId);
        const productSnap = await tx.get(productRef);
        if (!productSnap.exists()) throw new Error("A product in this return no longer exists.");
        const product = productSnap.data() as ProductDoc;
        const currentStock = typeof product.stock_quantity === "number" ? product.stock_quantity : 0;
        productNextStockById.set(productId, currentStock + qtyRestore);
      }

      for (const row of returnItems) {
        const restockCogs = lineRestockCogsByItemId.get(row.id) ?? 0;
        const writeOffCogs = lineWriteOffCogsByItemId.get(row.id) ?? 0;
        tx.update(doc(db, COLLECTIONS.invoiceReturnItems, row.id), {
          cogs_amount: restockCogs,
          write_off_cogs_amount: writeOffCogs,
          updated_at: serverTimestamp(),
        });
      }

      for (const restore of pendingRestores) {
        const restorationRef = doc(collection(db, COLLECTIONS.returnLotRestorations));
        tx.set(restorationRef, {
          return_id: trimmedReturnId,
          consumption_id: restore.consumptionId,
          lot_id: restore.lotId,
          product_id: restore.productId,
          invoice_id: invoiceId,
          invoice_item_id: restore.invoiceItemId,
          quantity: restore.quantity,
          unit_cost: restore.unitCost,
          cogs_amount: restore.cogsAmount,
          created_at: serverTimestamp(),
        });
      }

      for (const writeOff of pendingWriteOffs) {
        const writeOffRef = doc(collection(db, COLLECTIONS.returnLotWriteOffs));
        tx.set(writeOffRef, {
          return_id: trimmedReturnId,
          consumption_id: writeOff.consumptionId,
          lot_id: writeOff.lotId,
          product_id: writeOff.productId,
          invoice_id: invoiceId,
          invoice_item_id: writeOff.invoiceItemId,
          quantity: writeOff.quantity,
          unit_cost: writeOff.unitCost,
          cogs_amount: writeOff.cogsAmount,
          created_at: serverTimestamp(),
        });
      }

      for (const [lotId, nextQty] of lotNextQtyById) {
        tx.update(doc(db, COLLECTIONS.stockLots, lotId), {
          qty_remaining: nextQty,
          updated_at: serverTimestamp(),
        });
      }

      for (const [productId, nextStock] of productNextStockById) {
        tx.update(doc(db, COLLECTIONS.products, productId), {
          stock_quantity: nextStock,
        });
      }

      for (const row of returnItems) {
        const item = row.data;
        const qty = item.quantity_returned;
        const lineSubtotal = roundMoney2(item.unit_price * qty - item.line_discount);
        const restockCogs = lineRestockCogsByItemId.get(row.id) ?? 0;
        const avgUnitCost = qty > 0 ? restockCogs / qty : 0;
        const negTotal = roundMoney2(-item.line_total);
        const negCogs = roundMoney2(-restockCogs);
        const negSubtotal = roundMoney2(-lineSubtotal);

        const saleRef = doc(collection(db, COLLECTIONS.sales));
        tx.set(saleRef, {
          invoice_id: invoiceId,
          original_invoice_id: invoiceId,
          return_id: trimmedReturnId,
          sale_type: "return",
          order_id: ret.order_id,
          customer_id: ret.customer_id,
          product_id: item.product_id,
          quantity: qty,
          sale_price: item.unit_price,
          unit_cost: avgUnitCost,
          line_subtotal: negSubtotal,
          line_discount: item.line_discount,
          line_delivery_charge: item.line_delivery_charge,
          cogs_amount: negCogs,
          total_amount: negTotal,
          posted_at: serverTimestamp(),
          date: serverTimestamp(),
        });
      }

      const nextReturned = roundMoney2(returnedSoFar + returnTotal);
      const existingReturnIds = Array.isArray(invoice.return_ids) ? invoice.return_ids.filter(Boolean) : [];
      const nextReturnIds = existingReturnIds.includes(trimmedReturnId)
        ? existingReturnIds
        : [...existingReturnIds, trimmedReturnId];

      let nextPaid = getInvoicePaidAmount(invoice);
      if (ret.settlement_type === "cash_refund") {
        nextPaid = roundMoney2(Math.max(0, nextPaid - refundAmount));
      }

      const nextPaymentStatus = derivePaymentStatus(
        { ...invoice, returned_amount: nextReturned },
        nextPaid,
      );

      tx.update(invoiceRef, {
        returned_amount: nextReturned,
        return_ids: nextReturnIds,
        paid_amount: nextPaid,
        payment_status: nextPaymentStatus,
        updated_at: serverTimestamp(),
      });

      tx.update(returnRef, {
        status: "posted",
        refund_amount: refundAmount,
        subtotal_amount: ret.subtotal_amount,
        total_amount: returnTotal,
        write_off_cogs_amount: totalWriteOffCogs,
        posted_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    });
  } catch (e) {
    logFirestoreError("postReturn: transaction failed", e);
    if (e instanceof FirebaseError) {
      if (e.code === "permission-denied") {
        throw new Error(
          "Posting return was denied by Firestore rules. Deploy the latest firestore.rules (firebase deploy --only firestore:rules) and ensure your account has the admin claim.",
        );
      }
      if (
        e.code === "failed-precondition" ||
        e.code === "invalid-argument" ||
        (typeof e.message === "string" &&
          (/Firestore transactions require all reads|transaction too big|too many/i.test(e.message) ||
            /DEADLINE/i.test(e.message)))
      ) {
        throw new Error(
          `Posting return failed (Firestore transaction limit or ordering). Try returning fewer lines. Original: ${e.message}`,
        );
      }
    }
    throw e;
  }
}

export function suggestSettlementType(invoice: InvoiceDoc): InvoiceReturnDoc["settlement_type"] {
  const paid = getInvoicePaidAmount(invoice);
  if (paid > 0.01) return "cash_refund";
  return "reduce_balance";
}
