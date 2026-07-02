import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { loadReturnedQtyByItemId } from "@/lib/firestore/invoiceReturns";
import type { InvoiceDoc, InvoiceItemDoc } from "@/lib/types/firestore";

export type CustomerPurchaseLine = {
  invoiceItemId: string;
  invoiceId: string;
  orderId: string;
  productId: string;
  soldQuantity: number;
  alreadyReturned: number;
  returnableQuantity: number;
  unitPrice: number;
  lineDiscount: number;
  lineDeliveryCharge: number;
  lineTotal: number;
  invoiceDate: Timestamp | null;
};

/**
 * Posted invoice line items for a customer, with returnable quantities.
 * Sorted newest invoice first.
 */
export async function fetchCustomerPurchaseLines(
  db: Firestore,
  customerId: string,
): Promise<CustomerPurchaseLine[]> {
  const trimmed = customerId.trim();
  if (!trimmed) return [];

  const itemsQ = query(
    collection(db, COLLECTIONS.invoiceItems),
    where("customer_id", "==", trimmed),
  );
  const itemsSnap = await getDocs(itemsQ);

  const itemsByInvoice = new Map<string, Array<{ id: string; data: InvoiceItemDoc }>>();
  itemsSnap.forEach((d) => {
    const data = d.data() as InvoiceItemDoc;
    const invId = data.invoice_id?.trim();
    if (!invId) return;
    const bucket = itemsByInvoice.get(invId) ?? [];
    bucket.push({ id: d.id, data });
    itemsByInvoice.set(invId, bucket);
  });

  const lines: CustomerPurchaseLine[] = [];

  await Promise.all(
    [...itemsByInvoice.entries()].map(async ([invoiceId, items]) => {
      const invSnap = await getDoc(doc(db, COLLECTIONS.invoices, invoiceId));
      if (!invSnap.exists()) return;
      const invoice = invSnap.data() as InvoiceDoc;
      if (invoice.status !== "posted") return;

      const returnedByItem = await loadReturnedQtyByItemId(db, invoiceId);
      const invoiceDate = invoice.posted_at ?? invoice.created_at ?? null;

      for (const { id, data } of items) {
        const sold = data.quantity;
        const already = returnedByItem.get(id) ?? 0;
        lines.push({
          invoiceItemId: id,
          invoiceId,
          orderId: invoice.order_id,
          productId: data.product_id,
          soldQuantity: sold,
          alreadyReturned: already,
          returnableQuantity: Math.max(0, sold - already),
          unitPrice: data.unit_price,
          lineDiscount: data.line_discount,
          lineDeliveryCharge: data.line_delivery_charge,
          lineTotal: data.line_total,
          invoiceDate,
        });
      }
    }),
  );

  lines.sort((a, b) => {
    const ta = a.invoiceDate?.toMillis?.() ?? 0;
    const tb = b.invoiceDate?.toMillis?.() ?? 0;
    if (tb !== ta) return tb - ta;
    return b.orderId.localeCompare(a.orderId);
  });

  return lines;
}
