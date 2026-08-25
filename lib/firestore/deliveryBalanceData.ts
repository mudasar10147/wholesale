import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { fetchProductNamesByIds } from "@/lib/firestore/salesDrilldown";
import {
  buildDeliveryBalanceGroups,
  invoiceHasRemainingBalance,
  type DeliveryBalanceCustomerGroup,
  type DeliveryBalanceCustomerInput,
  type DeliveryBalanceInvoiceInput,
  type DeliveryReturnLine,
} from "@/lib/invoices/deliveryBalanceList";
import type {
  InvoiceDoc,
  InvoiceReturnDoc,
  InvoiceReturnItemDoc,
} from "@/lib/types/firestore";

/** Firestore `in` filters accept at most 30 values. */
const IN_BATCH = 30;

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

type ReturnAccumulator = {
  productId: string;
  quantityReturned: number;
  quantityRestock: number;
  quantityDiscard: number;
  creditAmount: number;
  reducesBalance: boolean;
};

/**
 * Load every unpaid/part-paid invoice grouped by shop, with the goods that came back on
 * each one (restock vs damaged/discard) resolved to product names.
 *
 * `customerById` is supplied by the caller from the shared session cache
 * (`referenceData.ts`), which `/sales` already holds — re-reading the collection here is
 * exactly the waste that cache exists to remove. Product names are still resolved on
 * demand: `/sales` does NOT subscribe to products, so opening a full products listener
 * for an occasional PDF would cost more than fetching the few returned ids per download.
 */
export async function loadDeliveryBalanceGroups(
  db: Firestore,
  customerById: ReadonlyMap<string, DeliveryBalanceCustomerInput>,
): Promise<DeliveryBalanceCustomerGroup[]> {
  const invoiceSnap = await getDocs(
    query(collection(db, COLLECTIONS.invoices), orderBy("created_at", "desc")),
  );

  const allInvoices = invoiceSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as InvoiceDoc),
  }));

  const invoices: (DeliveryBalanceInvoiceInput & InvoiceDoc)[] =
    allInvoices.filter(invoiceHasRemainingBalance);

  const returnLinesByInvoiceId = await loadReturnLines(db, invoices);

  return buildDeliveryBalanceGroups(invoices, customerById, returnLinesByInvoiceId);
}

async function loadReturnLines(
  db: Firestore,
  invoices: readonly (DeliveryBalanceInvoiceInput & InvoiceDoc)[],
): Promise<Map<string, DeliveryReturnLine[]>> {
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
  if (invoiceIds.size === 0) return new Map();

  // key: `${invoiceId}::${productId}::${reducesBalance}`
  const accumulators = new Map<string, ReturnAccumulator & { invoiceId: string }>();

  const accumulate = (
    invoiceId: string,
    productId: string,
    reducesBalance: boolean,
    returned: number,
    restock: number,
    discard: number,
    credit: number,
  ) => {
    const key = `${invoiceId}::${productId}::${reducesBalance ? "1" : "0"}`;
    const existing = accumulators.get(key);
    if (existing) {
      existing.quantityReturned += returned;
      existing.quantityRestock += restock;
      existing.quantityDiscard += discard;
      existing.creditAmount = roundMoney2(existing.creditAmount + credit);
      return;
    }
    accumulators.set(key, {
      invoiceId,
      productId,
      reducesBalance,
      quantityReturned: returned,
      quantityRestock: restock,
      quantityDiscard: discard,
      creditAmount: roundMoney2(credit),
    });
  };

  // Drafts carry their counter-sale returns inline on the invoice doc — no extra reads.
  for (const invoice of invoices) {
    if (invoice.status !== "draft") continue;
    for (const line of invoice.return_lines ?? []) {
      if (!line?.product_id) continue;
      accumulate(
        invoice.id,
        line.product_id,
        true,
        Math.max(0, Math.trunc(line.quantity_returned ?? 0)),
        Math.max(0, Math.trunc(line.quantity_restock ?? 0)),
        Math.max(0, Math.trunc(line.quantity_discard ?? 0)),
        Number.isFinite(line.line_total) ? line.line_total : 0,
      );
    }
  }

  // Posted invoices reference their returns as separate documents.
  const returnSnap = await getDocs(collection(db, COLLECTIONS.invoiceReturns));
  const relevantReturns = new Map<string, InvoiceReturnDoc>();
  returnSnap.forEach((docSnap) => {
    const ret = docSnap.data() as InvoiceReturnDoc;
    if (ret.status !== "posted") return;
    if (!invoiceIds.has(ret.original_invoice_id)) return;
    relevantReturns.set(docSnap.id, ret);
  });

  const returnIds = [...relevantReturns.keys()];
  if (returnIds.length > 0) {
    const batches = await Promise.all(
      chunk(returnIds, IN_BATCH).map((ids) =>
        getDocs(
          query(collection(db, COLLECTIONS.invoiceReturnItems), where("return_id", "in", ids)),
        ),
      ),
    );

    for (const batch of batches) {
      batch.forEach((docSnap) => {
        const item = docSnap.data() as InvoiceReturnItemDoc;
        const parent = relevantReturns.get(item.return_id);
        if (!parent) return;
        if (!invoiceIds.has(item.original_invoice_id)) return;
        accumulate(
          item.original_invoice_id,
          item.product_id,
          parent.settlement_type !== "credit_note",
          Math.max(0, Math.trunc(item.quantity_returned ?? 0)),
          Math.max(0, Math.trunc(item.quantity_restock ?? 0)),
          Math.max(0, Math.trunc(item.quantity_discard ?? 0)),
          Number.isFinite(item.line_total) ? item.line_total : 0,
        );
      });
    }
  }

  const entries = [...accumulators.values()];
  if (entries.length === 0) return new Map();

  const productNames = await fetchProductNamesByIds(
    db,
    entries.map((entry) => entry.productId),
  );

  const byInvoice = new Map<string, DeliveryReturnLine[]>();
  for (const entry of entries) {
    const line: DeliveryReturnLine = {
      productId: entry.productId,
      productName: productNames.get(entry.productId) ?? "(unknown product)",
      quantityReturned: entry.quantityReturned,
      quantityRestock: entry.quantityRestock,
      quantityDiscard: entry.quantityDiscard,
      creditAmount: entry.creditAmount,
      reducesBalance: entry.reducesBalance,
    };
    const list = byInvoice.get(entry.invoiceId);
    if (list) list.push(line);
    else byInvoice.set(entry.invoiceId, [line]);
  }

  for (const list of byInvoice.values()) {
    list.sort((a, b) => a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" }));
  }

  return byInvoice;
}
