import { collection, doc, getDoc, getDocs, query, where, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory/constants";
import { fulfillLedgerOutbox, type LedgerSourceBinding } from "@/lib/inventory/ledgerOutbox";
import type { InvoiceDoc, InvoiceItemDoc, InvoiceReturnDoc, InvoiceReturnItemDoc } from "@/lib/types/firestore";

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
      posted_by_uid: postedByUid,
      lines,
    },
    binding,
    { stockCommitted: true },
  );
}

/** Admin repair: backfill SALES_RETURN ledger for a posted return. */
export async function repairReturnLedger(db: Firestore, returnId: string, postedByUid?: string): Promise<void> {
  const trimmedId = returnId.trim();
  const snap = await getDoc(doc(db, COLLECTIONS.invoiceReturns, trimmedId));
  if (!snap.exists()) throw new Error("Return not found.");
  const ret = snap.data() as InvoiceReturnDoc;
  if (ret.status !== "posted") throw new Error("Only posted returns can be repaired.");

  const qtyByProduct = new Map<string, number>();
  const itemIds = Array.isArray(ret.item_ids) ? ret.item_ids.filter(Boolean) : [];
  for (const itemId of itemIds) {
    const itemSnap = await getDoc(doc(db, COLLECTIONS.invoiceReturnItems, itemId));
    if (!itemSnap.exists()) continue;
    const item = itemSnap.data() as InvoiceReturnItemDoc;
    if (item.quantity_restock > 0) {
      qtyByProduct.set(
        item.product_id,
        (qtyByProduct.get(item.product_id) ?? 0) + item.quantity_restock,
      );
    }
  }

  const lines = Array.from(qtyByProduct.entries()).map(([product_id, quantity]) => ({
    product_id,
    warehouse_id: DEFAULT_WAREHOUSE_ID,
    direction: "in" as const,
    quantity,
    unit_cost: 0,
  }));
  if (lines.length === 0) return;

  const binding: LedgerSourceBinding = {
    collection: COLLECTIONS.invoiceReturns,
    docId: trimmedId,
    statusField: "ledger_status",
    transactionIdField: "inventory_transaction_id",
    errorField: "ledger_error",
  };
  await fulfillLedgerOutbox(
    db,
    {
      type: "SALES_RETURN",
      warehouse_id: DEFAULT_WAREHOUSE_ID,
      source_document_type: "invoice_return",
      source_document_id: trimmedId,
      posted_by_uid: postedByUid,
      lines,
    },
    binding,
    { stockCommitted: true },
  );
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
