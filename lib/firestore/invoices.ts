import { FirebaseError } from "firebase/app";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { calculateInvoiceSummary, type InvoiceCalcLineInput } from "@/lib/invoices/calculations";
import type {
  CustomerDoc,
  InvoiceDoc,
  InvoiceItemCogsDoc,
  InvoiceItemDoc,
  LotConsumptionDoc,
  ProductDoc,
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
};

/** Firestore allows at most ~500 document reads+writes per transaction. */
const FIRESTORE_TXN_DOC_CAP = 500;

/**
 * Load customer + products outside a transaction, matching previous server checks.
 * Drafts do not reserve stock; posting still enforces real stock/FIFO.
 */
async function preflightValidateDraftInvoiceLines(
  db: Firestore,
  customerId: string,
  lines: InvoiceCalcLineInput[],
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
): Promise<{ invoiceId: string }> {
  const customerId = input.customer_id.trim();
  const orderId = normalizeOrderId(input.order_id);
  const notes = input.notes?.trim();

  assertValidCreateInvoiceInput(input);
  assertValidOrderId(orderId);

  await preflightValidateDraftInvoiceLines(db, customerId, input.lines);

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

/** Replaces draft line items and totals. Stock is re-validated against current product quantities (drafts do not reserve stock). */
export async function updateDraftInvoice(
  db: Firestore,
  invoiceId: string,
  input: UpdateDraftInvoiceInput,
): Promise<void> {
  const trimmedId = normalizeOrderId(invoiceId);
  const customerId = input.customer_id.trim();
  const notes = input.notes?.trim();

  assertValidCreateInvoiceInput(input);
  assertValidOrderId(trimmedId);

  if (normalizeOrderId(input.order_id) !== trimmedId) {
    throw new Error("Order ID cannot be changed.");
  }

  await preflightValidateDraftInvoiceLines(db, customerId, input.lines);

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

export async function postInvoice(db: Firestore, invoiceId: string): Promise<void> {
  const trimmedId = invoiceId.trim().toUpperCase();
  if (!trimmedId) {
    throw new Error("Invoice ID is required.");
  }

  const auth = getAuthClient();
  if (auth.currentUser) {
    await auth.currentUser.getIdToken(true);
  }
  await logFirestoreAuthForDebug("postInvoice (before transaction)");

  const invoiceRef = doc(db, COLLECTIONS.invoices, trimmedId);
  const preCheck = await getDoc(invoiceRef);
  if (!preCheck.exists()) {
    throw new Error("Invoice not found.");
  }
  const preInvoice = preCheck.data() as InvoiceDoc | undefined;
  if (preInvoice?.status === "posted") {
    return;
  }
  if (preInvoice?.status === "void") {
    throw new Error("Cannot post a void invoice.");
  }
  if (preInvoice?.status !== "draft") {
    throw new Error(`Only draft invoices can be posted (current status: ${String(preInvoice?.status)}).`);
  }

  const preloadedLotsByProduct = new Map<string, string[]>();
  const lotsSnap = await getDocs(collection(db, COLLECTIONS.stockLots));
  lotsSnap.forEach((docSnap) => {
    const data = docSnap.data() as Partial<StockLotDoc>;
    const productId = typeof data.product_id === "string" ? data.product_id : "";
    if (!productId) return;
    const list = preloadedLotsByProduct.get(productId) ?? [];
    list.push(docSnap.id);
    preloadedLotsByProduct.set(productId, list);
  });

  const itemIdsForEstimate = Array.isArray(preInvoice.item_ids) ? preInvoice.item_ids.filter(Boolean) : [];
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
  const productIdsForEstimate = Array.from(neededByProductEarly.keys());
  let lotReadSumForEstimate = 0;
  for (const pid of productIdsForEstimate) {
    lotReadSumForEstimate += (preloadedLotsByProduct.get(pid) ?? []).length;
  }
  const postTxnOpEstimate =
    1 +
    itemIdsForEstimate.length +
    productIdsForEstimate.length +
    lotReadSumForEstimate +
    itemIdsForEstimate.length * 4;
  if (postTxnOpEstimate > FIRESTORE_TXN_DOC_CAP) {
    throw new Error(
      `This invoice is too large to post in one step (estimated ${postTxnOpEstimate} Firestore operations; limit ${FIRESTORE_TXN_DOC_CAP}). Split into multiple drafts with fewer lines or fewer stock lots per product.`,
    );
  }

  try {
    await runTransaction(db, async (tx) => {
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
      const itemRef = doc(db, COLLECTIONS.invoiceItems, itemId);
      const itemSnap = await tx.get(itemRef);
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
      const productRef = doc(db, COLLECTIONS.products, productId);
      const productSnap = await tx.get(productRef);
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

    const lotsByProductId = new Map<string, Array<{ id: string; data: StockLotDoc }>>();
    const pendingOpeningLots: Array<{
      ref: ReturnType<typeof doc>;
      payload: Record<string, unknown>;
    }> = [];

    for (const productId of productIds) {
      const product = productById.get(productId);
      const currentStock = stockSnapshot.get(productId) ?? 0;

      const lots: Array<{ id: string; data: StockLotDoc }> = [];
      const lotIds = preloadedLotsByProduct.get(productId) ?? [];
      for (const lotId of lotIds) {
        const lotRef = doc(db, COLLECTIONS.stockLots, lotId);
        const lotSnap = await tx.get(lotRef);
        if (!lotSnap.exists()) continue;
        const lotData = lotSnap.data() as StockLotDoc;
        if (lotData.product_id === productId) {
          lots.push({ id: lotId, data: lotData });
        }
      }

      const lotTotal = lots.reduce((acc, row) => acc + (row.data.qty_remaining ?? 0), 0);
      const gap = Math.max(0, currentStock - lotTotal);
      if (gap > 0) {
        // Backfill legacy stock into FIFO system once so old products remain postable.
        const openingRef = doc(collection(db, COLLECTIONS.stockLots));
        const openingCost = typeof product?.cost_price === "number" ? product.cost_price : 0;
        pendingOpeningLots.push({
          ref: openingRef,
          payload: {
            product_id: productId,
            unit_cost: openingCost,
            qty_in: gap,
            qty_remaining: gap,
            source: "opening_balance",
            reference_id: productId,
            received_at: product?.created_at ?? serverTimestamp(),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          },
        });
        lots.push({
          id: openingRef.id,
          data: {
            product_id: productId,
            unit_cost: openingCost,
            qty_in: gap,
            qty_remaining: gap,
            source: "opening_balance",
            reference_id: productId,
            received_at: product?.created_at ?? ({} as StockLotDoc["received_at"]),
            created_at: {} as StockLotDoc["created_at"],
            updated_at: {} as StockLotDoc["updated_at"],
          },
        });
      }

      lots.sort((a, b) => {
        const at = typeof a.data.received_at?.toMillis === "function" ? a.data.received_at.toMillis() : 0;
        const bt = typeof b.data.received_at?.toMillis === "function" ? b.data.received_at.toMillis() : 0;
        return at - bt;
      });
      lotsByProductId.set(productId, lots);
    }

    for (const o of pendingOpeningLots) {
      tx.set(o.ref, o.payload);
    }
    for (const productId of productIds) {
      const currentStock = stockSnapshot.get(productId) ?? 0;
      const qtyNeeded = neededByProduct.get(productId) ?? 0;
      tx.update(doc(db, COLLECTIONS.products, productId), {
        stock_quantity: currentStock - qtyNeeded,
      });
    }

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

      for (const lot of productLots) {
        tx.update(doc(db, COLLECTIONS.stockLots, lot.id), {
          qty_remaining: lot.data.qty_remaining,
          updated_at: serverTimestamp(),
        });
      }
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

    tx.update(invoiceRef, {
      status: "posted",
      stock_reversal_applied: false,
      posted_subtotal_amount: invoice.subtotal_amount,
      posted_discount_amount: invoice.discount_amount,
      posted_delivery_charge: invoice.delivery_charge,
      posted_total_amount: invoice.total_amount,
      posted_cogs_amount: roundMoney2(postedCogs),
      posted_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  });
  } catch (e) {
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

  const preloadedConsumptionIds: string[] = [];
  const consumptionAllSnap = await getDocs(collection(db, COLLECTIONS.lotConsumptions));
  consumptionAllSnap.forEach((docSnap) => {
    const data = docSnap.data() as Partial<LotConsumptionDoc>;
    if (data.invoice_id === trimmedId) {
      preloadedConsumptionIds.push(docSnap.id);
    }
  });

  const invoiceRef = doc(db, COLLECTIONS.invoices, trimmedId);
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
    for (const c of consumptions) {
      const lotId = c.data.lot_id;
      const productId = c.data.product_id;
      const qty = c.data.quantity;
      if (!lotId || !productId || !Number.isInteger(qty) || qty <= 0) {
        throw new Error("Invalid lot-consumption data.");
      }
      restoreByProduct.set(productId, (restoreByProduct.get(productId) ?? 0) + qty);
      restoreByLot.set(lotId, (restoreByLot.get(lotId) ?? 0) + qty);
    }

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
      tx.update(lotRef, {
        qty_remaining: next,
        updated_at: serverTimestamp(),
      });
    }

    for (const c of consumptions) {
      tx.update(doc(db, COLLECTIONS.lotConsumptions, c.id), {
        reversed_at: serverTimestamp(),
      });
    }

    for (const [productId, qtyRestore] of restoreByProduct) {
      const productRef = doc(db, COLLECTIONS.products, productId);
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists()) {
        throw new Error("A product in this invoice no longer exists.");
      }
      const product = productSnap.data() as ProductDoc | undefined;
      const currentStock = typeof product?.stock_quantity === "number" ? product.stock_quantity : 0;
      tx.update(productRef, {
        stock_quantity: currentStock + qtyRestore,
      });
    }

    tx.update(invoiceRef, {
      status: "void",
      stock_reversal_applied: true,
      voided_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  });
  } catch (e) {
    logFirestoreError("voidInvoice: transaction failed (Firestore rules — see console)", e);
    throw e;
  }
}
