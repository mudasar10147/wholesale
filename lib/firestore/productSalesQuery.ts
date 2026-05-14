import { collection, getDocs, query, where, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { SaleDoc } from "@/lib/types/firestore";
import type { SaleDocRow } from "@/lib/firestore/salesDrilldown";

/**
 * All sales rows for one product (unsorted; sort client-side by `date`).
 */
export async function fetchSalesForProduct(db: Firestore, productId: string): Promise<SaleDocRow[]> {
  const q = query(collection(db, COLLECTIONS.sales), where("product_id", "==", productId));
  const snap = await getDocs(q);
  const out: SaleDocRow[] = [];
  snap.forEach((d) => {
    out.push({ id: d.id, data: d.data() as SaleDoc });
  });
  return out;
}
