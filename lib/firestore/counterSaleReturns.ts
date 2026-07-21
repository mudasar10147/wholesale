import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { fetchCustomerPurchaseLines } from "@/lib/firestore/customerPurchaseHistory";
import {
  createReturnDraft,
  postReturn,
} from "@/lib/firestore/invoiceReturns";
import {
  getInvoicePostedTotal,
  derivePaymentStatus,
} from "@/lib/invoices/invoiceEffective";
import { calculateCounterSaleSummary } from "@/lib/invoices/counterSaleCalculations";
import type { ReturnLineInput } from "@/lib/invoices/returnCalculations";
import type {
  CashEntryDoc,
  InvoiceDoc,
  InvoiceReturnDoc,
  InvoiceReturnLineEmbedded,
} from "@/lib/types/firestore";

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Raw return line as captured in the invoice form, before resolution against purchase history. */
export type CounterSaleReturnInput = {
  original_invoice_id: string;
  original_invoice_item_id: string;
  quantity_returned: number;
  quantity_restock: number;
  quantity_discard: number;
  /** Position in the invoice's combined line list, so the saved order is preserved. */
  sort_order?: number;
};

function toInt(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * Validate raw return lines against the customer's actual purchase history and resolve them
 * into embedded return lines (with the original price + proportional credit). Enforces the
 * v1 guard that the original purchase invoice is fully paid, so the credit can be safely
 * netted onto the new invoice (see the plan's money model).
 */
export async function resolveReturnLines(
  db: Firestore,
  customerId: string,
  inputs: CounterSaleReturnInput[],
): Promise<InvoiceReturnLineEmbedded[]> {
  if (!inputs || inputs.length === 0) return [];
  const cid = customerId.trim();
  if (!cid) throw new Error("Select a customer before adding returns.");

  const purchaseLines = await fetchCustomerPurchaseLines(db, cid);
  const byItemId = new Map(purchaseLines.map((l) => [l.invoiceItemId, l]));

  const resolved: InvoiceReturnLineEmbedded[] = [];
  for (const input of inputs) {
    const pl = byItemId.get(input.original_invoice_item_id);
    if (!pl || pl.invoiceId !== input.original_invoice_id.trim()) {
      throw new Error("A return item no longer matches this customer's purchase history.");
    }
    const qty = toInt(input.quantity_returned);
    if (qty <= 0) continue;
    if (qty > pl.returnableQuantity) {
      throw new Error(
        `Cannot return ${qty} of ${pl.orderId} — only ${pl.returnableQuantity} returnable.`,
      );
    }
    const restock = toInt(input.quantity_restock);
    const discard = toInt(input.quantity_discard);
    if (restock < 0 || discard < 0 || restock + discard !== qty) {
      throw new Error("Restock and discard quantities must add up to the return quantity.");
    }

    // Proportional credit at the original price, matching calculateReturnSummary's ratio.
    const lineTotal =
      pl.soldQuantity > 0 ? roundMoney2((pl.lineTotal * qty) / pl.soldQuantity) : 0;

    resolved.push({
      original_invoice_id: pl.invoiceId,
      original_invoice_item_id: pl.invoiceItemId,
      original_order_id: pl.orderId,
      product_id: pl.productId,
      quantity_returned: qty,
      quantity_restock: restock,
      quantity_discard: discard,
      unit_price: pl.unitPrice,
      line_total: lineTotal,
      ...(typeof input.sort_order === "number" ? { sort_order: input.sort_order } : {}),
    });
  }
  return resolved;
}

/** Sum of return line credits (R). */
export function sumReturnLinesCredit(lines: readonly InvoiceReturnLineEmbedded[]): number {
  return roundMoney2(lines.reduce((acc, l) => acc + (Number.isFinite(l.line_total) ? l.line_total : 0), 0));
}

function groupByOriginalInvoice(
  lines: readonly InvoiceReturnLineEmbedded[],
): Map<string, ReturnLineInput[]> {
  const groups = new Map<string, ReturnLineInput[]>();
  for (const l of lines) {
    const bucket = groups.get(l.original_invoice_id) ?? [];
    bucket.push({
      original_invoice_item_id: l.original_invoice_item_id,
      product_id: l.product_id,
      quantity_returned: l.quantity_returned,
      quantity_restock: l.quantity_restock,
      quantity_discard: l.quantity_discard,
    });
    groups.set(l.original_invoice_id, bucket);
  }
  return groups;
}

/**
 * Materialize and post the inline return lines of a posted invoice, then apply their credit
 * to it. Idempotent/resumable: safe to re-run after a partial failure (mirrors the ledger
 * outbox). One `invoice_returns` doc is created per original invoice, settled as `cash_refund`
 * so the customer's prior payment is released and re-applied here; any excess over the sale is
 * refunded as a single deterministic cash-out entry.
 */
export async function finalizeCounterSaleReturns(db: Firestore, invoiceId: string): Promise<void> {
  const invoiceRef = doc(db, COLLECTIONS.invoices, invoiceId.trim());
  const snap = await getDoc(invoiceRef);
  if (!snap.exists()) return;
  const invoice = snap.data() as InvoiceDoc;
  const returnLines = Array.isArray(invoice.return_lines) ? invoice.return_lines : [];
  if (returnLines.length === 0) return;
  if (invoice.returns_post_status === "posted") return;

  // 1. Create one return draft per original invoice (skip any already created on a prior run).
  const groups = groupByOriginalInvoice(returnLines);
  const attached = Array.isArray(invoice.attached_return_ids)
    ? [...invoice.attached_return_ids.filter(Boolean)]
    : [];
  const doneOriginals = new Set<string>();
  for (const id of attached) {
    const rsnap = await getDoc(doc(db, COLLECTIONS.invoiceReturns, id));
    if (rsnap.exists()) doneOriginals.add((rsnap.data() as InvoiceReturnDoc).original_invoice_id);
  }
  for (const [originalId, lines] of groups) {
    if (doneOriginals.has(originalId)) continue;
    const { returnId } = await createReturnDraft(db, {
      original_invoice_id: originalId,
      lines,
      settlement_type: "credit_note",
    });
    attached.push(returnId);
    await updateDoc(invoiceRef, {
      attached_return_ids: attached,
      updated_at: serverTimestamp(),
    });
  }

  // 2. Post each return (postReturn is idempotent — no-op if already posted).
  for (const id of attached) {
    await postReturn(db, id);
  }

  // 3. Apply credit to this invoice; refund any excess as one deterministic cash-out.
  const saleTotal = getInvoicePostedTotal(invoice);
  const summary = calculateCounterSaleSummary(saleTotal, returnLines);

  if (summary.cash_refund_amount > 0.01) {
    const refundRef = doc(db, COLLECTIONS.cashEntries, `counter-refund-${invoiceId.trim()}`);
    const payload: Omit<CashEntryDoc, "created_at"> & { created_at: unknown } = {
      entry_type: "remove",
      amount: summary.cash_refund_amount,
      date: serverTimestamp() as unknown as CashEntryDoc["date"],
      note: `Return refund on ${invoice.order_id}`,
      created_at: serverTimestamp(),
    };
    await setDoc(refundRef, payload);
  }

  const paymentStatus = derivePaymentStatus(
    { ...invoice, returned_amount: 0, posted_total_amount: saleTotal },
    summary.applied_credit,
  );
  await updateDoc(invoiceRef, {
    paid_amount: summary.applied_credit,
    payment_status: paymentStatus,
    cash_refund_amount: summary.cash_refund_amount,
    returns_post_status: "posted",
    updated_at: serverTimestamp(),
  });
}
