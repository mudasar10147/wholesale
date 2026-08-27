import { collection, doc, getDoc, getDocs, query, where, type Firestore } from "firebase/firestore";
import { getAuthClient } from "@/lib/firebase";
import { fulfillReturnLedger, type ReturnRestockScope } from "@/lib/inventory/returnLedger";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory/constants";
import { fulfillLedgerOutbox, type LedgerSourceBinding } from "@/lib/inventory/ledgerOutbox";
import type { InvoiceDoc, InvoiceItemDoc, InvoiceReturnDoc } from "@/lib/types/firestore";

/**
 * Every repair must be attributable. The Inventory Health button used to call
 * through with no uid, so each repaired ledger header landed without a
 * `posted_by_uid` and immediately tripped G7 — the repair created a fresh
 * finding while clearing an old one.
 */
function requireOperatorUid(explicit?: string): string {
  const uid = explicit?.trim() || getAuthClient().currentUser?.uid?.trim();
  if (!uid) {
    throw new Error("Sign in before repairing a ledger — every repair must be attributable.");
  }
  return uid;
}

async function buildInvoiceSaleLines(
  db: Firestore,
  invoice: InvoiceDoc,
): Promise<Map<string, number>> {
  const neededByProduct = new Map<string, number>();
  const itemIds = Array.isArray(invoice.item_ids) ? invoice.item_ids.filter(Boolean) : [];
  for (const itemId of itemIds) {
    const snap = await getDoc(doc(db, COLLECTIONS.invoiceItems, itemId));
    if (!snap.exists()) continue;
    const item = snap.data() as InvoiceItemDoc;
    neededByProduct.set(item.product_id, (neededByProduct.get(item.product_id) ?? 0) + item.quantity);
  }
  return neededByProduct;
}

/** Admin repair: backfill SALE ledger for a posted invoice. */
export async function repairInvoiceSaleLedger(db: Firestore, invoiceId: string, postedByUid?: string): Promise<void> {
  const operatorUid = requireOperatorUid(postedByUid);
  const trimmedId = invoiceId.trim().toUpperCase();
  const snap = await getDoc(doc(db, COLLECTIONS.invoices, trimmedId));
  if (!snap.exists()) throw new Error("Invoice not found.");
  const invoice = snap.data() as InvoiceDoc;
  if (invoice.status !== "posted") throw new Error("Only posted invoices can be repaired.");

  const neededByProduct = await buildInvoiceSaleLines(db, invoice);
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
    docId: trimmedId,
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
      source_document_id: trimmedId,
      posted_by_uid: operatorUid,
      lines,
    },
    binding,
    { stockCommitted: true },
  );
}

/**
 * Admin repair for a posted return's inventory ledger.
 *
 * Delegates to the shared writer so the three return shapes are handled exactly
 * as they are at post time: restocked quantities get a SALES_RETURN row, an
 * all-discard return gets an honest `not_applicable` instead of a fabricated
 * zero-quantity movement, and re-running changes nothing.
 *
 * Writes only ledger documents and the return's own ledger fields. Stock, lots,
 * consumptions, COGS and cash are already settled by `postReturn`; repair
 * records what happened, it does not re-do it.
 */
export async function repairReturnLedger(
  db: Firestore,
  returnId: string,
  postedByUid?: string,
): Promise<ReturnRestockScope["kind"]> {
  const operatorUid = requireOperatorUid(postedByUid);
  const trimmedId = returnId.trim();
  const snap = await getDoc(doc(db, COLLECTIONS.invoiceReturns, trimmedId));
  if (!snap.exists()) throw new Error("Return not found.");
  const ret = snap.data() as InvoiceReturnDoc;
  if (ret.status !== "posted") throw new Error("Only posted returns can be repaired.");

  return fulfillReturnLedger(db, trimmedId, ret, { postedByUid: operatorUid });
}

export type PendingLedgerRow = {
  id: string;
  kind: "invoice" | "return";
  status: string;
  ledger_status?: string;
  ledger_error?: string;
  posted_at?: string;
};

/** Load documents with pending or failed inventory ledger writes. */
export async function loadPendingLedgerDocuments(db: Firestore): Promise<PendingLedgerRow[]> {
  const rows: PendingLedgerRow[] = [];

  for (const status of ["pending", "failed"] as const) {
    const invoiceQ = query(collection(db, COLLECTIONS.invoices), where("ledger_status", "==", status));
    const invoiceSnap = await getDocs(invoiceQ);
    invoiceSnap.forEach((d) => {
      const data = d.data() as InvoiceDoc;
      if (data.status === "posted") {
        rows.push({
          id: d.id,
          kind: "invoice",
          status: data.status,
          ledger_status: data.ledger_status,
          ledger_error: data.ledger_error,
          posted_at: data.posted_at?.toDate?.()?.toISOString?.(),
        });
      }
    });

    const returnQ = query(collection(db, COLLECTIONS.invoiceReturns), where("ledger_status", "==", status));
    const returnSnap = await getDocs(returnQ);
    returnSnap.forEach((d) => {
      const data = d.data() as InvoiceReturnDoc;
      if (data.status === "posted") {
        rows.push({
          id: d.id,
          kind: "return",
          status: data.status,
          ledger_status: data.ledger_status,
          ledger_error: data.ledger_error,
          posted_at: data.posted_at?.toDate?.()?.toISOString?.(),
        });
      }
    });
  }

  return rows;
}
