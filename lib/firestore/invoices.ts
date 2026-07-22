import { FirebaseError } from "firebase/app";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { fetchStockLotsForProduct, type StockLotRow } from "@/lib/firestore/stockLotsQuery";
import { emitPostingMetrics, nowMs } from "@/lib/inventory/postingMetrics";
import { calculateInvoiceSummary, type InvoiceCalcLineInput } from "@/lib/invoices/calculations";
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory/constants";
import { fulfillLedgerOutbox, type LedgerSourceBinding } from "@/lib/inventory/ledgerOutbox";
import {
  derivePaymentStatus,
  getInvoiceAmountDue,
  getInvoiceEffectiveTotal,
  getInvoicePaidAmount,
  getInvoiceReturnedAmount,
} from "@/lib/invoices/invoiceEffective";
import {
  formatInvoiceVoidBlockedMessage,
  loadInvoiceReturnBlockers,
} from "@/lib/firestore/invoiceReturns";
import {
  finalizeCounterSaleReturns,
  resolveReturnLines,
  sumReturnLinesCredit,
  type CounterSaleReturnInput,
} from "@/lib/firestore/counterSaleReturns";
import type {
  CustomerDoc,
  InvoiceDoc,
  InvoiceItemCogsDoc,
  InvoiceItemDoc,
  LotConsumptionDoc,
  ProductDoc,
  ReturnLotRestorationDoc,
  ReturnLotWriteOffDoc,
  StockLotDoc,
} from "@/lib/types/firestore";
import {
  assertValidCreateInvoiceInput,
  assertValidOrderId,
  normalizeOrderId,
} from "@/lib/validation/contracts";
import { getAuthClient } from "@/lib/firebase";
import { logFirestoreAuthForDebug, logFirestoreError } from "@/lib/firebase/firestoreDebug";

/** Two-decimal money to align with Firestore rules float checks. */
function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export type CreateInvoiceInput = {
  customer_id: string;
  order_id: string;
  discount_amount: number;
  delivery_charge: number;
  notes?: string;
  lines: InvoiceCalcLineInput[];
  /** Inline "counter-sale" return lines: items the customer is handing back on this sale. */
  return_lines?: CounterSaleReturnInput[];
};

/** Options for saving a draft only. Posting always re-checks stock and FIFO. */
export type DraftSaveOptions = {
  /**
   * When true, skips the preflight check that line quantities must not exceed current
   * `product.stock_quantity`. Use only after explicit user confirmation (oversell draft).
   */
  allowInsufficientStockForDraft?: boolean;
};

/** Firestore allows at most ~500 document reads+writes per transaction. */
const FIRESTORE_TXN_DOC_CAP = 500;

function stockLotMismatchMessage(
  productId: string,
  product: ProductDoc | undefined,
  book: number,
  lotTotal: number,
): string {
  const label = product?.name?.trim() || productId;
  return `Book stock (${book}) does not match lot total (${lotTotal}) for ${label}. Post a stock adjustment before invoicing.`;
}

function assertBookStockMatchesLots(
  productId: string,
  product: ProductDoc | undefined,
  book: number,
  lotTotal: number,
): void {
  if (book > lotTotal) {
    throw new Error(stockLotMismatchMessage(productId, product, book, lotTotal));
  }
}

async function fulfillInvoiceSaleLedger(
  db: Firestore,
  invoiceId: string,
  neededByProduct: Map<string, number>,
  postedByUid?: string,
): Promise<void> {
  const lines = Array.from(neededByProduct.entries()).map(([product_id, quantity]) => ({
    product_id,
    warehouse_id: DEFAULT_WAREHOUSE_ID,
    direction: "out" as const,
    quantity,
    unit_cost: 0,
  }));
  if (lines.length === 0) return;
  const binding: LedgerSourceBinding = {
    collection: COLLECTIONS.invoices,
    docId: invoiceId,
    statusField: "ledger_status",
    transactionIdField: "inventory_transaction_id",
    errorField: "ledger_error",
  };
  await fulfillLedgerOutbox(
    db,
    {
      type: "SALE",
      warehouse_id: DEFAULT_WAREHOUSE_ID,
      source_document_type: "invoice",
      source_document_id: invoiceId,
      posted_by_uid: postedByUid,
      lines,
    },
    binding,
    { stockCommitted: true },
  );
}

async function fulfillInvoiceVoidLedger(
  db: Firestore,
  invoiceId: string,
  restoreByProduct: Map<string, number>,
  postedByUid?: string,
): Promise<void> {
  const lines = Array.from(restoreByProduct.entries()).map(([product_id, quantity]) => ({
    product_id,
    warehouse_id: DEFAULT_WAREHOUSE_ID,
    direction: "in" as const,
    quantity,
    unit_cost: 0,
  }));
  if (lines.length === 0) return;
  const binding: LedgerSourceBinding = {
    collection: COLLECTIONS.invoices,
    docId: invoiceId,
    statusField: "void_ledger_status",
    transactionIdField: "void_inventory_transaction_id",
    errorField: "void_ledger_error",
  };
  await fulfillLedgerOutbox(
    db,
    {
      type: "SALE_VOID",
      warehouse_id: DEFAULT_WAREHOUSE_ID,
      source_document_type: "invoice",
      source_document_id: invoiceId,
      posted_by_uid: postedByUid,
      lines,
    },
    binding,
    { stockCommitted: true },
  );
}

function sortLotsByReceivedAt(lots: Array<{ id: string; data: StockLotDoc }>): void {
  lots.sort((a, b) => {
    const at = typeof a.data.received_at?.toMillis === "function" ? a.data.received_at.toMillis() : 0;
    const bt = typeof b.data.received_at?.toMillis === "function" ? b.data.received_at.toMillis() : 0;
    return at - bt;
  });
}

function captureLotQtySnapshot(
  lotsByProductId: Map<string, Array<{ id: string; data: StockLotDoc }>>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const rows of lotsByProductId.values()) {
    for (const lot of rows) {
      m.set(lot.id, typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0);
    }
  }
  return m;
}

function collectDirtyLotIds(
  before: Map<string, number>,
  lotsByProductId: Map<string, Array<{ id: string; data: StockLotDoc }>>,
): Set<string> {
  const dirty = new Set<string>();
  for (const rows of lotsByProductId.values()) {
    for (const lot of rows) {
      const prev = before.get(lot.id) ?? 0;
      const next = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
      if (prev !== next) {
        dirty.add(lot.id);
      }
    }
  }
  return dirty;
}

function cloneLotsByProductForSimulation(
  src: Map<string, Array<{ id: string; data: StockLotDoc }>>,
): Map<string, Array<{ id: string; data: StockLotDoc }>> {
  const out = new Map<string, Array<{ id: string; data: StockLotDoc }>>();
  for (const [pid, rows] of src) {
    out.set(
      pid,
      rows.map((r) => ({
        id: r.id,
        data: {
          ...r.data,
          qty_remaining: typeof r.data.qty_remaining === "number" ? r.data.qty_remaining : 0,
        },
      })),
    );
  }
  return out;
}

function simulateFifoForDirtyEstimate(
  invoiceItems: Array<{ id: string; data: InvoiceItemDoc }>,
  lotsByProductId: Map<string, Array<{ id: string; data: StockLotDoc }>>,
): Set<string> {
  const before = captureLotQtySnapshot(lotsByProductId);
  const sim = cloneLotsByProductForSimulation(lotsByProductId);
  for (const row of invoiceItems) {
    const item = row.data;
    const qty = item.quantity;
    const productLots = sim.get(item.product_id) ?? [];
    let need = qty;
    for (const lot of productLots) {
      if (need <= 0) {
        break;
      }
      const available = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
      if (available <= 0) {
        continue;
      }
      const take = Math.min(available, need);
      need -= take;
      lot.data.qty_remaining = available - take;
    }
  }
  return collectDirtyLotIds(before, sim);
}

function buildLotsMapsForPost(
  productIds: string[],
  lotsDataByProduct: Map<string, StockLotRow[]>,
  productById: Map<string, ProductDoc>,
  stockSnapshot: Map<string, number>,
): Map<string, Array<{ id: string; data: StockLotDoc }>> {
  const lotsByProductId = new Map<string, Array<{ id: string; data: StockLotDoc }>>();
  for (const productId of productIds) {
    const product = productById.get(productId);
    const currentStock = stockSnapshot.get(productId) ?? 0;
    const rows = lotsDataByProduct.get(productId) ?? [];
    const lots: Array<{ id: string; data: StockLotDoc }> = rows.map((r) => ({
      id: r.id,
      data: r.data,
    }));

    const lotTotal = lots.reduce(
      (acc, row) => acc + (typeof row.data.qty_remaining === "number" ? row.data.qty_remaining : 0),
      0,
    );
    const gap = Math.max(0, currentStock - lotTotal);
    if (gap > 0) {
      assertBookStockMatchesLots(productId, product, currentStock, lotTotal);
    }
    sortLotsByReceivedAt(lots);
    lotsByProductId.set(productId, lots);
  }
  return lotsByProductId;
}

/**
 * Load customer + products outside a transaction, matching previous server checks.
 * Drafts do not reserve stock; posting still enforces real stock/FIFO.
 * When `skipStockCheck` is true, product existence is still validated but quantities may exceed stock (oversell draft).
 */
async function preflightValidateDraftInvoiceLines(
  db: Firestore,
  customerId: string,
  lines: InvoiceCalcLineInput[],
  opts?: { skipStockCheck?: boolean },
): Promise<void> {
  const customerRef = doc(db, COLLECTIONS.customers, customerId);
  const customerSnap = await getDoc(customerRef);
  if (!customerSnap.exists()) throw new Error("Customer not found.");
  const customer = customerSnap.data() as CustomerDoc | undefined;
  if (!customer || !customer.is_active) throw new Error("Customer is not active.");

  const uniqueProductIds = Array.from(new Set(lines.map((line) => line.product_id.trim())));
  const productMap = new Map<string, ProductDoc>();
  await Promise.all(
    uniqueProductIds.map(async (productId) => {
      const productRef = doc(db, COLLECTIONS.products, productId);
      const productSnap = await getDoc(productRef);
      if (!productSnap.exists()) throw new Error("One or more products no longer exist.");
      productMap.set(productId, productSnap.data() as ProductDoc);
    }),
  );

  if (opts?.skipStockCheck) {
    return;
  }

  for (const line of lines) {
    const product = productMap.get(line.product_id.trim());
    if (!product) throw new Error("Invalid product in invoice line.");
    const stock = typeof product.stock_quantity === "number" ? product.stock_quantity : 0;
    if (line.quantity > stock) {
      throw new Error(`Not enough stock for ${product.name} (available: ${stock}).`);
    }
  }
}

export async function createDraftInvoice(
  db: Firestore,
  input: CreateInvoiceInput,
  options?: DraftSaveOptions,
): Promise<{ invoiceId: string }> {
  const customerId = input.customer_id.trim();
  const orderId = normalizeOrderId(input.order_id);
  const notes = input.notes?.trim();

  assertValidCreateInvoiceInput(input);
  assertValidOrderId(orderId);

  await preflightValidateDraftInvoiceLines(db, customerId, input.lines, {
    skipStockCheck: options?.allowInsufficientStockForDraft === true,
  });

  const resolvedReturnLines = await resolveReturnLines(db, customerId, input.return_lines ?? []);
  const returnFields =
    resolvedReturnLines.length > 0
      ? {
          return_lines: resolvedReturnLines,
          returns_credit_amount: sumReturnLinesCredit(resolvedReturnLines),
        }
      : {};

  const invoiceRef = doc(db, COLLECTIONS.invoices, orderId);
  const itemRefs = input.lines.map(() => doc(collection(db, COLLECTIONS.invoiceItems)));

  const txOpsEstimate = 3 + input.lines.length;
  if (txOpsEstimate > FIRESTORE_TXN_DOC_CAP) {
    throw new Error(
      `This invoice has too many lines to save at once (max ${FIRESTORE_TXN_DOC_CAP - 3} lines). Split into multiple invoices.`,
    );
  }

  await runTransaction(db, async (tx) => {
    const customerRef = doc(db, COLLECTIONS.customers, customerId);
    const customerSnap = await tx.get(customerRef);
    if (!customerSnap.exists()) throw new Error("Customer not found.");
    const customer = customerSnap.data() as CustomerDoc | undefined;
    if (!customer || !customer.is_active) throw new Error("Customer is not active.");

    const orderSnap = await tx.get(invoiceRef);
    if (orderSnap.exists()) {
      throw new Error("Order ID already used. Choose another.");
    }

    const calc = calculateInvoiceSummary({
      lines: input.lines,
      delivery_charge: input.delivery_charge,
      discount_amount: input.discount_amount,
    });

    tx.set(invoiceRef, {
      customer_id: customerId,
      order_id: orderId,
      status: "draft",
      payment_status: "unpaid",
      paid_amount: 0,
      stock_reversal_applied: false,
      item_ids: itemRefs.map((ref) => ref.id),
      subtotal_amount: calc.subtotal_amount,
      discount_amount: calc.discount_amount,
      delivery_charge: calc.delivery_charge,
      total_amount: calc.total_amount,
      ...returnFields,
      ...(notes ? { notes } : {}),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });

    calc.lines.forEach((line, idx) => {
      tx.set(itemRefs[idx]!, {
        invoice_id: invoiceRef.id,
        order_id: orderId,
        customer_id: customerId,
        product_id: line.product_id,
        quantity: line.quantity,
        unit_price: line.unit_price,
        line_discount: line.line_discount,
        line_delivery_charge: line.line_delivery_charge,
        line_total: line.line_total,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    });
  });

  return { invoiceId: invoiceRef.id };
}

/** Removes a draft invoice and its line items. Posted/void invoices must use void or stay on record. */
export async function deleteDraftInvoice(db: Firestore, invoiceId: string): Promise<void> {
  const trimmedId = invoiceId.trim().toUpperCase();
  if (!trimmedId) {
    throw new Error("Invoice ID is required.");
  }

  const invoiceRef = doc(db, COLLECTIONS.invoices, trimmedId);
  await runTransaction(db, async (tx) => {
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists()) {
      throw new Error("Invoice not found.");
    }
    const invoice = invoiceSnap.data() as InvoiceDoc | undefined;
    if (!invoice) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status !== "draft") {
      throw new Error("Only draft invoices can be deleted.");
    }

    const itemIds = Array.isArray(invoice.item_ids) ? invoice.item_ids.filter(Boolean) : [];
    for (const itemId of itemIds) {
      tx.delete(doc(db, COLLECTIONS.invoiceItems, itemId));
    }
    tx.delete(invoiceRef);
  });
}

export type UpdateDraftInvoiceInput = CreateInvoiceInput;

/** Replaces draft line items and totals. By default stock is re-validated; use `allowInsufficientStockForDraft` to save an oversell draft (posting still enforces stock). */
export async function updateDraftInvoice(
  db: Firestore,
  invoiceId: string,
  input: UpdateDraftInvoiceInput,
  options?: DraftSaveOptions,
): Promise<void> {
  const trimmedId = normalizeOrderId(invoiceId);
  const customerId = input.customer_id.trim();
  const notes = input.notes?.trim();

  assertValidCreateInvoiceInput(input);
  assertValidOrderId(trimmedId);

  if (normalizeOrderId(input.order_id) !== trimmedId) {
    throw new Error("Order ID cannot be changed.");
  }

  await preflightValidateDraftInvoiceLines(db, customerId, input.lines, {
    skipStockCheck: options?.allowInsufficientStockForDraft === true,
  });

  const resolvedReturnLines = await resolveReturnLines(db, customerId, input.return_lines ?? []);
  const returnFields =
    resolvedReturnLines.length > 0
      ? {
          return_lines: resolvedReturnLines,
          returns_credit_amount: sumReturnLinesCredit(resolvedReturnLines),
        }
      : { return_lines: deleteField(), returns_credit_amount: deleteField() };

  if (3 + input.lines.length > FIRESTORE_TXN_DOC_CAP) {
    throw new Error(
      `This invoice has too many lines to save at once (max ${FIRESTORE_TXN_DOC_CAP - 3} lines). Split into multiple invoices.`,
    );
  }

  const invoiceRef = doc(db, COLLECTIONS.invoices, trimmedId);
  const itemRefs = input.lines.map(() => doc(collection(db, COLLECTIONS.invoiceItems)));

  const preSnap = await getDoc(invoiceRef);
  if (!preSnap.exists()) {
    throw new Error("Invoice not found.");
  }
  const preExisting = preSnap.data() as InvoiceDoc | undefined;
  if (!preExisting) {
    throw new Error("Invoice not found.");
  }
  if (preExisting.status !== "draft") {
    throw new Error("Only draft invoices can be edited.");
  }

  const oldItemIds = Array.isArray(preExisting.item_ids) ? preExisting.item_ids.filter(Boolean) : [];
  const opEstimateSingleTxn = 3 + oldItemIds.length + input.lines.length;

  if (opEstimateSingleTxn > FIRESTORE_TXN_DOC_CAP) {
    for (let i = 0; i < oldItemIds.length; i += FIRESTORE_TXN_DOC_CAP) {
      const chunk = oldItemIds.slice(i, i + FIRESTORE_TXN_DOC_CAP);
      const batch = writeBatch(db);
      for (const itemId of chunk) {
        batch.delete(doc(db, COLLECTIONS.invoiceItems, itemId));
      }
      await batch.commit();
    }

    await runTransaction(db, async (tx) => {
      const invoiceSnap = await tx.get(invoiceRef);
      if (!invoiceSnap.exists()) {
        throw new Error("Invoice not found.");
      }
      const existing = invoiceSnap.data() as InvoiceDoc | undefined;
      if (!existing) {
        throw new Error("Invoice not found.");
      }
      if (existing.status !== "draft") {
        throw new Error("Only draft invoices can be edited.");
      }

      const customerRef = doc(db, COLLECTIONS.customers, customerId);
      const customerSnap = await tx.get(customerRef);
      if (!customerSnap.exists()) throw new Error("Customer not found.");
      const customer = customerSnap.data() as CustomerDoc | undefined;
      if (!customer || !customer.is_active) throw new Error("Customer is not active.");

      const calc = calculateInvoiceSummary({
        lines: input.lines,
        delivery_charge: input.delivery_charge,
        discount_amount: input.discount_amount,
      });

      tx.update(invoiceRef, {
        customer_id: customerId,
        order_id: trimmedId,
        status: "draft",
        payment_status: "unpaid",
        paid_amount: 0,
        stock_reversal_applied: false,
        item_ids: itemRefs.map((ref) => ref.id),
        subtotal_amount: calc.subtotal_amount,
        discount_amount: calc.discount_amount,
        delivery_charge: calc.delivery_charge,
        total_amount: calc.total_amount,
        ...returnFields,
        ...(notes ? { notes } : { notes: deleteField() }),
        updated_at: serverTimestamp(),
      });

      calc.lines.forEach((line, idx) => {
        tx.set(itemRefs[idx]!, {
          invoice_id: invoiceRef.id,
          order_id: trimmedId,
          customer_id: customerId,
          product_id: line.product_id,
          quantity: line.quantity,
          unit_price: line.unit_price,
          line_discount: line.line_discount,
          line_delivery_charge: line.line_delivery_charge,
          line_total: line.line_total,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      });
    });
    return;
  }

  await runTransaction(db, async (tx) => {
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists()) {
      throw new Error("Invoice not found.");
    }
    const existing = invoiceSnap.data() as InvoiceDoc | undefined;
    if (!existing) {
      throw new Error("Invoice not found.");
    }
    if (existing.status !== "draft") {
      throw new Error("Only draft invoices can be edited.");
    }

    const customerRef = doc(db, COLLECTIONS.customers, customerId);
    const customerSnap = await tx.get(customerRef);
    if (!customerSnap.exists()) throw new Error("Customer not found.");
    const customer = customerSnap.data() as CustomerDoc | undefined;
    if (!customer || !customer.is_active) throw new Error("Customer is not active.");

    const txnOldIds = Array.isArray(existing.item_ids) ? existing.item_ids.filter(Boolean) : [];
    for (const itemId of txnOldIds) {
      tx.delete(doc(db, COLLECTIONS.invoiceItems, itemId));
    }

    const calc = calculateInvoiceSummary({
      lines: input.lines,
      delivery_charge: input.delivery_charge,
      discount_amount: input.discount_amount,
    });

    tx.update(invoiceRef, {
      customer_id: customerId,
      order_id: trimmedId,
      status: "draft",
      payment_status: "unpaid",
      paid_amount: 0,
      stock_reversal_applied: false,
      item_ids: itemRefs.map((ref) => ref.id),
      subtotal_amount: calc.subtotal_amount,
      discount_amount: calc.discount_amount,
      delivery_charge: calc.delivery_charge,
      total_amount: calc.total_amount,
      ...returnFields,
      ...(notes ? { notes } : { notes: deleteField() }),
      updated_at: serverTimestamp(),
    });

    calc.lines.forEach((line, idx) => {
      tx.set(itemRefs[idx]!, {
        invoice_id: invoiceRef.id,
        order_id: trimmedId,
        customer_id: customerId,
        product_id: line.product_id,
        quantity: line.quantity,
        unit_price: line.unit_price,
        line_discount: line.line_discount,
        line_delivery_charge: line.line_delivery_charge,
        line_total: line.line_total,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    });
  });
}

/**
 * Test-only seam for the C1 concurrency test (§12.4). The suite injects this hook
 * to force a deterministic transaction-retry interleaving. It is `null` in
 * production — postInvoice's behaviour is unchanged when it is unset.
 */
export type PostInvoiceConcurrencyHook = (info: {
  invoiceId: string;
  attempt: number;
  phase: "afterReads";
}) => Promise<void>;
let postInvoiceConcurrencyHook: PostInvoiceConcurrencyHook | null = null;
export function __setPostInvoiceConcurrencyHook(hook: PostInvoiceConcurrencyHook | null): void {
  postInvoiceConcurrencyHook = hook;
}

export async function postInvoice(db: Firestore, invoiceId: string): Promise<void> {
  const trimmedId = invoiceId.trim().toUpperCase();
  if (!trimmedId) {
    throw new Error("Invoice ID is required.");
  }

  const auth = getAuthClient();
  if (auth.currentUser) {
    await auth.currentUser.getIdToken(false);
  }
  await logFirestoreAuthForDebug("postInvoice (before transaction)");

  const invoiceRef = doc(db, COLLECTIONS.invoices, trimmedId);
  const preCheck = await getDoc(invoiceRef);
  if (!preCheck.exists()) {
    throw new Error("Invoice not found.");
  }
  const preInvoice = preCheck.data() as InvoiceDoc | undefined;
  if (preInvoice?.status === "void") {
    throw new Error("Cannot post a void invoice.");
  }
  if (preInvoice?.status !== "draft" && preInvoice?.status !== "posted") {
    throw new Error(`Only draft invoices can be posted (current status: ${String(preInvoice?.status)}).`);
  }

  const itemIdsForEstimate = Array.isArray(preInvoice?.item_ids) ? preInvoice.item_ids.filter(Boolean) : [];
  if (itemIdsForEstimate.length === 0) {
    throw new Error("Invoice has no items to post.");
  }

  const itemSnapsEarly = await Promise.all(
    itemIdsForEstimate.map((id) => getDoc(doc(db, COLLECTIONS.invoiceItems, id))),
  );
  const neededByProductEarly = new Map<string, number>();
  for (let i = 0; i < itemSnapsEarly.length; i++) {
    const snap = itemSnapsEarly[i]!;
    if (!snap.exists()) {
      throw new Error("Invoice items are incomplete. Please recreate draft.");
    }
    const item = snap.data() as InvoiceItemDoc | undefined;
    if (!item || item.invoice_id !== trimmedId) {
      throw new Error("Invoice item mismatch detected.");
    }
    const productId = typeof item.product_id === "string" ? item.product_id : "";
    const qty = typeof item.quantity === "number" ? item.quantity : 0;
    if (!productId || !Number.isInteger(qty) || qty <= 0) {
      throw new Error("Invalid invoice item data.");
    }
    neededByProductEarly.set(productId, (neededByProductEarly.get(productId) ?? 0) + qty);
  }

  const inlineReturnLines = Array.isArray(preInvoice?.return_lines) ? preInvoice.return_lines : [];
  const hasInlineReturns = inlineReturnLines.length > 0;

  if (preInvoice?.status === "posted") {
    await fulfillInvoiceSaleLedger(db, trimmedId, neededByProductEarly, auth.currentUser?.uid);
    if (hasInlineReturns && preInvoice.returns_post_status !== "posted") {
      await finalizeCounterSaleReturns(db, trimmedId);
    }
    return;
  }

  const productIdsForEstimate = Array.from(neededByProductEarly.keys());

  const lotsDataByProduct = new Map<string, StockLotRow[]>();
  await Promise.all(
    productIdsForEstimate.map(async (pid) => {
      lotsDataByProduct.set(pid, await fetchStockLotsForProduct(db, pid));
    }),
  );

  const preloadedLotsByProduct = new Map<string, string[]>();
  for (const pid of productIdsForEstimate) {
    preloadedLotsByProduct.set(
      pid,
      (lotsDataByProduct.get(pid) ?? [])
        .filter((r) => (typeof r.data.qty_remaining === "number" ? r.data.qty_remaining : 0) > 0)
        .map((r) => r.id),
    );
  }

  const productDocsEarly = await Promise.all(
    productIdsForEstimate.map((pid) => getDoc(doc(db, COLLECTIONS.products, pid))),
  );
  const productByIdEarly = new Map<string, ProductDoc>();
  const stockSnapshotEarly = new Map<string, number>();
  for (let i = 0; i < productIdsForEstimate.length; i++) {
    const pid = productIdsForEstimate[i]!;
    const snap = productDocsEarly[i]!;
    if (!snap.exists()) {
      throw new Error("A product in this invoice no longer exists.");
    }
    const p = snap.data() as ProductDoc;
    productByIdEarly.set(pid, p);
    stockSnapshotEarly.set(pid, typeof p.stock_quantity === "number" ? p.stock_quantity : 0);
  }

  for (const pid of productIdsForEstimate) {
    const need = neededByProductEarly.get(pid) ?? 0;
    const stock = stockSnapshotEarly.get(pid) ?? 0;
    if (stock < need) {
      const p = productByIdEarly.get(pid);
      throw new Error(
        `Not enough stock for ${p?.name ?? pid} (needed: ${need}, available: ${stock}).`,
      );
    }
  }

  const invoiceItemsEarly: Array<{ id: string; data: InvoiceItemDoc }> = [];
  for (let i = 0; i < itemIdsForEstimate.length; i++) {
    const id = itemIdsForEstimate[i]!;
    const snap = itemSnapsEarly[i]!;
    invoiceItemsEarly.push({ id, data: snap.data() as InvoiceItemDoc });
  }

  const lotsByProductForEstimate = buildLotsMapsForPost(
    productIdsForEstimate,
    lotsDataByProduct,
    productByIdEarly,
    stockSnapshotEarly,
  );
  // The dirty estimate (FIFO-spanned lots ≈ consumption-doc count) now sizes ONLY
  // the op-cap preflight — it never seeds the in-transaction lot set (loaded fresh
  // every attempt). The M2 fix loads ALL ACTIVE lots per product inside the
  // transaction, so the guard is sized on active lots, not the spanned estimate
  // (§17 S3). getDocs is non-transactional (S4 — not counted toward the 500 cap);
  // the counted ops are the per-lot tx.get + the writes.
  const dirtyEstimate = simulateFifoForDirtyEstimate(invoiceItemsEarly, lotsByProductForEstimate);
  let activeLotsCountForEstimate = 0;
  for (const rows of lotsDataByProduct.values()) {
    for (const r of rows) {
      if ((typeof r.data.qty_remaining === "number" ? r.data.qty_remaining : 0) > 0) activeLotsCountForEstimate += 1;
    }
  }

  const postTxnOpEstimate =
    2 + // invoice read + write
    itemIdsForEstimate.length * 3 + // item read + sale + cogs write, per item
    productIdsForEstimate.length * 2 + // product read + write, per product
    activeLotsCountForEstimate * 2 + // active lot tx.get + lot write (worst case), per active lot
    dirtyEstimate.size; // consumption docs ≈ FIFO-spanned lots
  if (postTxnOpEstimate > FIRESTORE_TXN_DOC_CAP) {
    throw new Error(
      `This invoice is too large to post in one step (estimated ${postTxnOpEstimate} Firestore operations; limit ${FIRESTORE_TXN_DOC_CAP}). Split into multiple drafts with fewer lines or fewer stock lots per product.`,
    );
  }

  const postStartMs = nowMs();
  let txnAttempt = 0;
  let activeLotsRead = 0;
  try {
    await runTransaction(db, async (tx) => {
    txnAttempt += 1;
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists()) {
      throw new Error("Invoice not found.");
    }
    const invoice = invoiceSnap.data() as InvoiceDoc | undefined;
    // Another writer may have posted this invoice during our pre-check vs commit; treat as success.
    if (invoice?.status === "posted") {
      return;
    }
    if (!invoice || invoice.status !== "draft") {
      throw new Error(
        `Only draft invoices can be posted (current status: ${invoice?.status ?? "missing"}).`,
      );
    }
    if (invoice.stock_reversal_applied) {
      throw new Error("Invoice stock state is invalid. Cannot post this invoice.");
    }

    const itemIds = Array.isArray(invoice.item_ids) ? invoice.item_ids.filter(Boolean) : [];
    if (itemIds.length === 0) {
      throw new Error("Invoice has no items to post.");
    }

    const neededByProduct = new Map<string, number>();
    const invoiceItems: Array<{ id: string; data: InvoiceItemDoc }> = [];
    for (const itemId of itemIds) {
      const itemSnap = await tx.get(doc(db, COLLECTIONS.invoiceItems, itemId));
      if (!itemSnap.exists()) {
        throw new Error("Invoice items are incomplete. Please recreate draft.");
      }
      const item = itemSnap.data() as InvoiceItemDoc | undefined;
      if (!item || item.invoice_id !== trimmedId) {
        throw new Error("Invoice item mismatch detected.");
      }
      const productId = typeof item.product_id === "string" ? item.product_id : "";
      const qty = typeof item.quantity === "number" ? item.quantity : 0;
      if (!productId || !Number.isInteger(qty) || qty <= 0) {
        throw new Error("Invalid invoice item data.");
      }
      invoiceItems.push({ id: itemId, data: item });
      neededByProduct.set(productId, (neededByProduct.get(productId) ?? 0) + qty);
    }

    // All Firestore reads must finish before any writes in a transaction.
    const productIds = Array.from(neededByProduct.keys());
    const productById = new Map<string, ProductDoc>();
    const stockSnapshot = new Map<string, number>();

    for (const productId of productIds) {
      const productSnap = await tx.get(doc(db, COLLECTIONS.products, productId));
      if (!productSnap.exists()) {
        throw new Error("A product in this invoice no longer exists.");
      }
      const product = productSnap.data() as ProductDoc | undefined;
      const currentStock = typeof product?.stock_quantity === "number" ? product.stock_quantity : 0;
      const qtyNeeded = neededByProduct.get(productId) ?? 0;
      if (currentStock < qtyNeeded) {
        throw new Error(
          `Not enough stock for ${product?.name ?? productId} (needed: ${qtyNeeded}, available: ${currentStock}).`,
        );
      }
      if (product) {
        productById.set(productId, product);
      }
      stockSnapshot.set(productId, currentStock);
    }

    // M2 — Option A (§11.2, proven by the M1.5-S spike). Recompute the FIFO working
    // set from FRESH lot data on EVERY attempt; never reuse the pre-transaction
    // estimate or snapshot. The product anchor was read first (tx.get above), so a
    // concurrently-created lot co-writes the product and aborts us — the retry
    // re-queries and sees it. The client SDK has no transactional query (§2.2b):
    // getDocs is non-transactional (fresh each attempt) and every active lot we may
    // write is re-read with tx.get to place a precondition on the write set.
    const lotsByProductId = new Map<string, StockLotRow[]>();
    for (const productId of productIds) {
      const currentLots = await fetchStockLotsForProduct(db, productId);
      const rows: StockLotRow[] = [];
      for (const lot of currentLots) {
        const remaining = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
        if (remaining <= 0) continue; // active working set only
        const lotSnap = await tx.get(doc(db, COLLECTIONS.stockLots, lot.id));
        if (!lotSnap.exists()) continue;
        rows.push({ id: lot.id, data: lotSnap.data() as StockLotDoc });
      }
      lotsByProductId.set(productId, rows);
    }
    activeLotsRead = 0;
    for (const rows of lotsByProductId.values()) activeLotsRead += rows.length;

    // Sort each product's working lots FIFO (oldest received_at first) for consumption.
    //
    // The former in-transaction `assertBookStockMatchesLots(book, lotTotal)` was removed
    // here. Under Option A the product (a `tx.get`) and the freshly-queried lots are not a
    // single consistent snapshot, so a concurrent post committing mid-transaction makes
    // book and lotTotal transiently disagree — which the one-sided check would hard-fail
    // (a non-retryable throw) instead of letting the commit precondition force a retry.
    // Correctness now rests on: the product anchor + per-lot write-set preconditions (any
    // concurrent change aborts us and we retry with fresh reads), the FIFO insufficient-
    // lots guard below, and the read-only validator (P1/L6). Blocking a post on drift is
    // the job of the two-sided POST-STATE transactional assertion — M1's separate, gated
    // PR — which asserts after the writes and is retry-compatible.
    for (const productId of productIds) {
      const lots = lotsByProductId.get(productId) ?? [];
      sortLotsByReceivedAt(lots);
      lotsByProductId.set(productId, lots);
    }

    // Test-only seam (no-op in production): all reads and the assertion are done;
    // the product precondition is established but nothing is written yet. The C1
    // suite pauses here so a concurrent post can commit and force a retry.
    if (postInvoiceConcurrencyHook) {
      await postInvoiceConcurrencyHook({ invoiceId: trimmedId, attempt: txnAttempt, phase: "afterReads" });
    }

    for (const productId of productIds) {
      const currentStock = stockSnapshot.get(productId) ?? 0;
      const qtyNeeded = neededByProduct.get(productId) ?? 0;
      tx.update(doc(db, COLLECTIONS.products, productId), {
        stock_quantity: currentStock - qtyNeeded,
      });
    }

    const initialLotQtyMap = captureLotQtySnapshot(lotsByProductId);

    let postedCogs = 0;
    for (const row of invoiceItems) {
      const item = row.data;
      const qty = item.quantity;
      const productLots = lotsByProductId.get(item.product_id) ?? [];
      let need = qty;
      let cogsAmount = 0;
      const consumptionRows: Array<Omit<LotConsumptionDoc, "created_at" | "reversed_at">> = [];

      for (const lot of productLots) {
        if (need <= 0) break;
        const available = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
        if (available <= 0) continue;
        const take = Math.min(available, need);
        need -= take;
        lot.data.qty_remaining = available - take;
        const unitCost = typeof lot.data.unit_cost === "number" ? lot.data.unit_cost : 0;
        const chunkCogs = roundMoney2(unitCost * take);
        cogsAmount += chunkCogs;
        consumptionRows.push({
          invoice_id: trimmedId,
          order_id: invoice.order_id,
          invoice_item_id: row.id,
          product_id: item.product_id,
          lot_id: lot.id,
          quantity: take,
          unit_cost: unitCost,
          cogs_amount: chunkCogs,
        });
      }
      if (need > 0) {
        const product = productById.get(item.product_id);
        throw new Error(
          `FIFO lots are insufficient for ${product?.name ?? item.product_id} (missing: ${need}).`,
        );
      }
      cogsAmount = roundMoney2(cogsAmount);
      postedCogs += cogsAmount;

      for (const chunk of consumptionRows) {
        const consumptionRef = doc(collection(db, COLLECTIONS.lotConsumptions));
        tx.set(consumptionRef, {
          ...chunk,
          created_at: serverTimestamp(),
        });
      }

      // Must match Firestore rule `approxMoneyEq(cogs_amount, quantity * unit_cost_snapshot)`.
      // Do not use roundMoney2 here: qty * round(cogs/qty) can differ from cogs by > $0.05 on large lines.
      const avgUnitCost = qty > 0 ? cogsAmount / qty : 0;
      const lineSubtotal = roundMoney2(item.unit_price * qty - item.line_discount);
      const saleRef = doc(collection(db, COLLECTIONS.sales));
      tx.set(saleRef, {
        invoice_id: trimmedId,
        order_id: invoice.order_id,
        customer_id: invoice.customer_id,
        product_id: item.product_id,
        quantity: qty,
        sale_price: item.unit_price,
        unit_cost: avgUnitCost,
        line_subtotal: lineSubtotal,
        line_discount: item.line_discount,
        line_delivery_charge: item.line_delivery_charge,
        cogs_amount: cogsAmount,
        total_amount: item.line_total,
        posted_at: serverTimestamp(),
        date: serverTimestamp(),
      });

      const cogsRef = doc(db, COLLECTIONS.invoiceItemCogs, row.id);
      tx.set(cogsRef, {
        invoice_id: trimmedId,
        order_id: invoice.order_id,
        customer_id: invoice.customer_id,
        invoice_item_id: row.id,
        product_id: item.product_id,
        quantity: qty,
        unit_sale_price: item.unit_price,
        unit_cost_snapshot: avgUnitCost,
        line_subtotal: lineSubtotal,
        line_discount: item.line_discount,
        line_delivery_charge: item.line_delivery_charge,
        cogs_amount: cogsAmount,
        line_total: item.line_total,
        created_at: serverTimestamp(),
      } satisfies Omit<InvoiceItemCogsDoc, "created_at"> & { created_at: unknown });
    }

    const dirtyLotIds = collectDirtyLotIds(initialLotQtyMap, lotsByProductId);
    for (const lotId of dirtyLotIds) {
      const lotRow = Array.from(lotsByProductId.values())
        .flat()
        .find((r) => r.id === lotId);
      if (!lotRow) {
        continue;
      }
      tx.update(doc(db, COLLECTIONS.stockLots, lotId), {
        qty_remaining: lotRow.data.qty_remaining,
        updated_at: serverTimestamp(),
      });
    }

    tx.update(invoiceRef, {
      status: "posted",
      stock_reversal_applied: false,
      ledger_status: "pending",
      posted_subtotal_amount: invoice.subtotal_amount,
      posted_discount_amount: invoice.discount_amount,
      posted_delivery_charge: invoice.delivery_charge,
      posted_total_amount: invoice.total_amount,
      posted_cogs_amount: roundMoney2(postedCogs),
      ...(hasInlineReturns
        ? {
            returns_credit_amount: sumReturnLinesCredit(inlineReturnLines),
            returns_post_status: "pending",
          }
        : {}),
      posted_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    });
    await fulfillInvoiceSaleLedger(db, trimmedId, neededByProductEarly, auth.currentUser?.uid);
    if (hasInlineReturns) {
      await finalizeCounterSaleReturns(db, trimmedId);
    }
    emitPostingMetrics({
      invoice_id: trimmedId, uid: auth.currentUser?.uid, outcome: "posted",
      total_ms: nowMs() - postStartMs, txn_attempts: txnAttempt, retry_count: Math.max(0, txnAttempt - 1),
      product_count: productIdsForEstimate.length, active_lots_read: activeLotsRead, op_estimate: postTxnOpEstimate,
    });
  } catch (e) {
    emitPostingMetrics({
      invoice_id: trimmedId, uid: auth.currentUser?.uid, outcome: "failed",
      total_ms: nowMs() - postStartMs, txn_attempts: txnAttempt, retry_count: Math.max(0, txnAttempt - 1),
      product_count: productIdsForEstimate.length, active_lots_read: activeLotsRead, op_estimate: postTxnOpEstimate,
    });
    logFirestoreError("postInvoice: transaction failed (Firestore rules — see console; admin claim alone is not enough)", e);
    if (
      e instanceof FirebaseError &&
      (e.code === "failed-precondition" ||
        e.code === "invalid-argument" ||
        (typeof e.message === "string" &&
          (/500|transaction too big|too many/i.test(e.message) || /DEADLINE/i.test(e.message))))
    ) {
      throw new Error(
        `Posting failed (Firestore transaction limit or size). Try splitting this invoice into smaller drafts with fewer lines. Original: ${e.message}`,
      );
    }
    throw e;
  }
}

export async function recordInvoicePayment(
  db: Firestore,
  invoiceId: string,
  paymentAmount: number,
): Promise<void> {
  const trimmedId = invoiceId.trim().toUpperCase();
  if (!trimmedId) {
    throw new Error("Invoice ID is required.");
  }

  const amount = roundMoney2(paymentAmount);
  if (amount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  const invoiceRef = doc(db, COLLECTIONS.invoices, trimmedId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invoiceRef);
    if (!snap.exists()) {
      throw new Error("Invoice not found.");
    }
    const invoice = snap.data() as InvoiceDoc | undefined;
    if (!invoice) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status === "void") {
      throw new Error("Cannot record payment on a void invoice.");
    }
    if (invoice.status !== "posted") {
      throw new Error("Only posted invoices can receive payments.");
    }

    const effectiveTotal = getInvoiceEffectiveTotal(invoice);
    const amountDue = getInvoiceAmountDue(invoice);
    if (effectiveTotal <= 0.01 || amountDue <= 0.01) {
      throw new Error("Nothing is due on this invoice.");
    }
    if (amount > amountDue + 0.01) {
      throw new Error(`Payment cannot exceed amount due (${amountDue}).`);
    }

    const paidNow = getInvoicePaidAmount(invoice);
    const nextPaid = roundMoney2(paidNow + amount);
    tx.update(invoiceRef, {
      paid_amount: nextPaid,
      payment_status: derivePaymentStatus(invoice, nextPaid),
      updated_at: serverTimestamp(),
    });
  });
}

export async function updatePostedInvoiceDiscount(
  db: Firestore,
  invoiceId: string,
  discountAmount: number,
): Promise<void> {
  const trimmedId = invoiceId.trim().toUpperCase();
  if (!trimmedId) {
    throw new Error("Invoice ID is required.");
  }

  const discount = roundMoney2(discountAmount);
  if (!Number.isFinite(discount) || discount < 0) {
    throw new Error("Invoice discount must be zero or greater.");
  }

  const invoiceRef = doc(db, COLLECTIONS.invoices, trimmedId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invoiceRef);
    if (!snap.exists()) {
      throw new Error("Invoice not found.");
    }
    const invoice = snap.data() as InvoiceDoc | undefined;
    if (!invoice) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status !== "posted") {
      throw new Error("Only posted invoices can receive a discount adjustment.");
    }
    if (invoice.stock_reversal_applied) {
      throw new Error("Cannot adjust discount on a voided invoice.");
    }

    const subtotal = roundMoney2(invoice.subtotal_amount);
    const delivery = roundMoney2(invoice.delivery_charge);
    if (discount > subtotal + 0.01) {
      throw new Error("Invoice discount cannot exceed subtotal.");
    }

    const total = roundMoney2(Math.max(0, subtotal - discount + delivery));
    const returned = getInvoiceReturnedAmount(invoice);
    if (returned > total + 0.01) {
      throw new Error(
        "Discount is too large — the new total would be less than returns already posted on this invoice.",
      );
    }

    const updatedInvoice: InvoiceDoc = {
      ...invoice,
      discount_amount: discount,
      total_amount: total,
      posted_discount_amount: discount,
      posted_total_amount: total,
    };
    const effectiveTotal = getInvoiceEffectiveTotal(updatedInvoice);
    let paid = getInvoicePaidAmount(invoice);
    if (paid > effectiveTotal + 0.01) {
      paid = effectiveTotal;
    }

    tx.update(invoiceRef, {
      discount_amount: discount,
      total_amount: total,
      posted_discount_amount: discount,
      posted_total_amount: total,
      paid_amount: paid,
      payment_status: derivePaymentStatus(updatedInvoice, paid),
      updated_at: serverTimestamp(),
    });
  });
}

export async function markInvoicePaid(db: Firestore, invoiceId: string): Promise<void> {
  const trimmedId = invoiceId.trim().toUpperCase();
  if (!trimmedId) {
    throw new Error("Invoice ID is required.");
  }

  const invoiceRef = doc(db, COLLECTIONS.invoices, trimmedId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invoiceRef);
    if (!snap.exists()) {
      throw new Error("Invoice not found.");
    }
    const invoice = snap.data() as InvoiceDoc | undefined;
    if (!invoice) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status === "void") {
      throw new Error("Cannot mark a void invoice as paid.");
    }
    if (invoice.status !== "posted") {
      throw new Error("Only posted invoices can be marked as paid.");
    }

    const effectiveTotal = getInvoiceEffectiveTotal(invoice);
    const amountDue = getInvoiceAmountDue(invoice);
    const paidNow = getInvoicePaidAmount(invoice);

    if (effectiveTotal <= 0.01) {
      return;
    }

    if (amountDue <= 0.01) {
      if (paidNow !== effectiveTotal) {
        tx.update(invoiceRef, {
          paid_amount: effectiveTotal,
          payment_status: derivePaymentStatus(invoice, effectiveTotal),
          updated_at: serverTimestamp(),
        });
      }
      return;
    }

    const nextPaid = roundMoney2(paidNow + amountDue);
    tx.update(invoiceRef, {
      paid_amount: nextPaid,
      payment_status: derivePaymentStatus(invoice, nextPaid),
      updated_at: serverTimestamp(),
    });
  });
}

export async function voidInvoice(db: Firestore, invoiceId: string): Promise<void> {
  const trimmedId = invoiceId.trim().toUpperCase();
  if (!trimmedId) {
    throw new Error("Invoice ID is required.");
  }

  const auth = getAuthClient();
  if (auth.currentUser) {
    await auth.currentUser.getIdToken(true);
  }
  await logFirestoreAuthForDebug("voidInvoice (before transaction)");

  const returnBlockers = await loadInvoiceReturnBlockers(db, trimmedId);
  const voidBlockedMessage = formatInvoiceVoidBlockedMessage(returnBlockers);
  if (voidBlockedMessage) {
    throw new Error(voidBlockedMessage);
  }

  const consumptionQ = query(
    collection(db, COLLECTIONS.lotConsumptions),
    where("invoice_id", "==", trimmedId),
  );
  const consumptionSnap = await getDocs(consumptionQ);
  const preloadedConsumptionIds: string[] = [];
  consumptionSnap.forEach((docSnap) => {
    preloadedConsumptionIds.push(docSnap.id);
  });

  const restorationQ = query(
    collection(db, COLLECTIONS.returnLotRestorations),
    where("invoice_id", "==", trimmedId),
  );
  const restorationSnap = await getDocs(restorationQ);
  const restoredByConsumption = new Map<string, number>();
  restorationSnap.forEach((docSnap) => {
    const row = docSnap.data() as ReturnLotRestorationDoc;
    restoredByConsumption.set(
      row.consumption_id,
      (restoredByConsumption.get(row.consumption_id) ?? 0) + row.quantity,
    );
  });

  const writeOffQ = query(
    collection(db, COLLECTIONS.returnLotWriteOffs),
    where("invoice_id", "==", trimmedId),
  );
  const writeOffSnap = await getDocs(writeOffQ);
  const writtenOffByConsumption = new Map<string, number>();
  writeOffSnap.forEach((docSnap) => {
    const row = docSnap.data() as ReturnLotWriteOffDoc;
    writtenOffByConsumption.set(
      row.consumption_id,
      (writtenOffByConsumption.get(row.consumption_id) ?? 0) + row.quantity,
    );
  });

  const invoiceRef = doc(db, COLLECTIONS.invoices, trimmedId);

  const restoreByProductEarly = new Map<string, number>();
  for (const cid of preloadedConsumptionIds) {
    const csnap = await getDoc(doc(db, COLLECTIONS.lotConsumptions, cid));
    if (!csnap.exists()) continue;
    const cdata = csnap.data() as LotConsumptionDoc;
    if (cdata.invoice_id !== trimmedId || cdata.reversed_at) continue;
    const alreadyReturned = restoredByConsumption.get(cid) ?? 0;
    const alreadyWrittenOff = writtenOffByConsumption.get(cid) ?? 0;
    const qty = cdata.quantity - alreadyReturned - alreadyWrittenOff;
    if (qty > 0 && cdata.product_id) {
      restoreByProductEarly.set(
        cdata.product_id,
        (restoreByProductEarly.get(cdata.product_id) ?? 0) + qty,
      );
    }
  }

  try {
    await runTransaction(db, async (tx) => {
    const invoiceSnap = await tx.get(invoiceRef);
    if (!invoiceSnap.exists()) {
      throw new Error("Invoice not found.");
    }
    const invoice = invoiceSnap.data() as InvoiceDoc | undefined;
    if (!invoice) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status === "void") {
      throw new Error("Invoice is already void.");
    }

    const itemIds = Array.isArray(invoice.item_ids) ? invoice.item_ids.filter(Boolean) : [];
    if (itemIds.length === 0) {
      throw new Error("Invoice has no items.");
    }

    if (invoice.status === "draft") {
      tx.update(invoiceRef, {
        status: "void",
        stock_reversal_applied: false,
        voided_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      return;
    }

    if (invoice.status !== "posted") {
      throw new Error("Only draft or posted invoices can be voided.");
    }
    if (invoice.stock_reversal_applied) {
      throw new Error("Stock reversal already applied for this invoice.");
    }

    const consumptions: Array<{ id: string; data: LotConsumptionDoc }> = [];
    for (const cid of preloadedConsumptionIds) {
      const cref = doc(db, COLLECTIONS.lotConsumptions, cid);
      const csnap = await tx.get(cref);
      if (!csnap.exists()) continue;
      const cdata = csnap.data() as LotConsumptionDoc;
      if (cdata.invoice_id === trimmedId && !cdata.reversed_at) {
        consumptions.push({ id: cid, data: cdata });
      }
    }
    if (consumptions.length === 0) {
      throw new Error("No lot-consumption records found. Cannot reverse stock safely.");
    }

    // Reverse in opposite order of consumption time for safety and traceability.
    consumptions.sort((a, b) => {
      const at = typeof a.data.created_at?.toMillis === "function" ? a.data.created_at.toMillis() : 0;
      const bt = typeof b.data.created_at?.toMillis === "function" ? b.data.created_at.toMillis() : 0;
      return bt - at;
    });

    const restoreByProduct = new Map<string, number>();
    const restoreByLot = new Map<string, number>();
    const consumptionsToReverse: Array<{ id: string; data: LotConsumptionDoc }> = [];
    for (const c of consumptions) {
      const lotId = c.data.lot_id;
      const productId = c.data.product_id;
      const alreadyReturned = restoredByConsumption.get(c.id) ?? 0;
      const alreadyWrittenOff = writtenOffByConsumption.get(c.id) ?? 0;
      const qty = c.data.quantity - alreadyReturned - alreadyWrittenOff;
      if (!lotId || !productId || !Number.isInteger(c.data.quantity) || c.data.quantity <= 0) {
        throw new Error("Invalid lot-consumption data.");
      }
      if (qty <= 0) {
        consumptionsToReverse.push(c);
        continue;
      }
      restoreByProduct.set(productId, (restoreByProduct.get(productId) ?? 0) + qty);
      restoreByLot.set(lotId, (restoreByLot.get(lotId) ?? 0) + qty);
      consumptionsToReverse.push(c);
    }

    if (restoreByLot.size === 0 && consumptionsToReverse.length === 0) {
      throw new Error("No lot-consumption records found. Cannot reverse stock safely.");
    }

    // Firestore transactions require all reads before any writes.
    const lotNextQtyById = new Map<string, number>();
    for (const [lotId, qtyRestore] of restoreByLot) {
      const lotRef = doc(db, COLLECTIONS.stockLots, lotId);
      const lotSnap = await tx.get(lotRef);
      if (!lotSnap.exists()) {
        throw new Error("A consumed stock lot no longer exists.");
      }
      const lot = lotSnap.data() as StockLotDoc | undefined;
      const current = typeof lot?.qty_remaining === "number" ? lot.qty_remaining : 0;
      const lotIn = typeof lot?.qty_in === "number" ? lot.qty_in : 0;
      const next = current + qtyRestore;
      if (next > lotIn) {
        throw new Error("Invalid reversal: lot quantity would exceed original intake.");
      }
      lotNextQtyById.set(lotId, next);
    }

    const productNextStockById = new Map<string, number>();
    for (const [productId, qtyRestore] of restoreByProduct) {
      const productRef = doc(db, COLLECTIONS.products, productId);
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists()) {
        throw new Error("A product in this invoice no longer exists.");
      }
      const product = productSnap.data() as ProductDoc | undefined;
      const currentStock = typeof product?.stock_quantity === "number" ? product.stock_quantity : 0;
      productNextStockById.set(productId, currentStock + qtyRestore);
    }

    for (const [lotId, nextQty] of lotNextQtyById) {
      tx.update(doc(db, COLLECTIONS.stockLots, lotId), {
        qty_remaining: nextQty,
        updated_at: serverTimestamp(),
      });
    }

    for (const c of consumptionsToReverse) {
      tx.update(doc(db, COLLECTIONS.lotConsumptions, c.id), {
        reversed_at: serverTimestamp(),
      });
    }

    for (const [productId, nextStock] of productNextStockById) {
      tx.update(doc(db, COLLECTIONS.products, productId), {
        stock_quantity: nextStock,
      });
    }

    tx.update(invoiceRef, {
      status: "void",
      stock_reversal_applied: true,
      void_ledger_status: "pending",
      paid_amount: 0,
      payment_status: "unpaid",
      voided_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  });
    await fulfillInvoiceVoidLedger(db, trimmedId, restoreByProductEarly, auth.currentUser?.uid);
  } catch (e) {
    logFirestoreError("voidInvoice: transaction failed (Firestore rules — see console)", e);
    throw e;
  }
}
