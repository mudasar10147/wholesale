import { collection, getDocs, query, where, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { InvoiceItemDoc } from "@/lib/types/firestore";

export type InvoiceLineRow = { id: string; data: InvoiceItemDoc };

/**
 * Invoice line items that reference this product (draft + posted).
 */
export async function fetchInvoiceItemsForProduct(
  db: Firestore,
  productId: string,
): Promise<InvoiceLineRow[]> {
  const q = query(collection(db, COLLECTIONS.invoiceItems), where("product_id", "==", productId));
  const snap = await getDocs(q);
  const out: InvoiceLineRow[] = [];
  snap.forEach((d) => {
    out.push({ id: d.id, data: d.data() as InvoiceItemDoc });
  });
  return out;
}
