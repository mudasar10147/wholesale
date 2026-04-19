import { collection, getDocs, query, where, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { StockLotDoc } from "@/lib/types/firestore";

export type StockLotRow = { id: string; data: StockLotDoc };

/**
 * Loads all stock lots for a single product (for FIFO + legacy gap detection).
 * Scoped query — not a full-table scan.
 */
export async function fetchStockLotsForProduct(db: Firestore, productId: string): Promise<StockLotRow[]> {
  const q = query(collection(db, COLLECTIONS.stockLots), where("product_id", "==", productId));
  const snap = await getDocs(q);
  const out: StockLotRow[] = [];
  snap.forEach((d) => {
    out.push({ id: d.id, data: d.data() as StockLotDoc });
  });
  return out;
}
