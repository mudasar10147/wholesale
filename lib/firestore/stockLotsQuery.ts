import { collection, getDocs, query, where, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { withDeadline } from "@/lib/firestore/deadline";
import type { StockLotDoc } from "@/lib/types/firestore";

export type StockLotRow = { id: string; data: StockLotDoc };

/**
 * A lot query rides the Listen stream and can never time out on its own (see
 * `deadline.ts`), so it gets an explicit ceiling. Generous: this is meant to catch
 * a dead stream, not a slow one. Every posting path reaches Firestore lots through
 * this module, so bounding it here bounds all of them.
 */
const LOT_QUERY_TIMEOUT_MS = 20_000;

/**
 * Loads all stock lots for a single product (for FIFO + legacy gap detection).
 * Scoped query — not a full-table scan.
 */
export async function fetchStockLotsForProduct(db: Firestore, productId: string): Promise<StockLotRow[]> {
  const q = query(collection(db, COLLECTIONS.stockLots), where("product_id", "==", productId));
  const snap = await withDeadline(
    getDocs(q),
    `the stock-lot query for product ${productId}`,
    LOT_QUERY_TIMEOUT_MS,
  );
  const out: StockLotRow[] = [];
  snap.forEach((d) => {
    out.push({ id: d.id, data: d.data() as StockLotDoc });
  });
  return out;
}

/** Sorted lot IDs for a product (per-product query, not full-table scan). */
export async function fetchStockLotIdsForProduct(db: Firestore, productId: string): Promise<string[]> {
  const rows = await fetchStockLotsForProduct(db, productId);
  return rows.map((r) => r.id).sort();
}

/** Per-product lot IDs for multiple products (one query per product). */
export async function fetchStockLotIdsByProduct(
  db: Firestore,
  productIds: Iterable<string>,
): Promise<Map<string, string[]>> {
  const byProduct = new Map<string, string[]>();
  await Promise.all(
    [...productIds].map(async (productId) => {
      byProduct.set(productId, await fetchStockLotIdsForProduct(db, productId));
    }),
  );
  return byProduct;
}

export function isFirestoreContentionError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return (
    msg.includes("failed-precondition") ||
    msg.includes("aborted") ||
    msg.includes("contention") ||
    msg.includes("deadline")
  );
}

