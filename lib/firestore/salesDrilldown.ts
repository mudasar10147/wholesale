import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
  Timestamp,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProductDoc, SaleDoc } from "@/lib/types/firestore";

export type SaleDocRow = {
  id: string;
  data: SaleDoc;
};

/**
 * Same date range as KPI `loadProfitForPeriod`, but returns document ids for auditing.
 */
export async function fetchSalesDocsInRange(
  db: Firestore,
  start: Date,
  end: Date,
): Promise<SaleDocRow[]> {
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);
  const q = query(
    collection(db, COLLECTIONS.sales),
    where("date", ">=", startTs),
    where("date", "<=", endTs),
  );
  const snap = await getDocs(q);
  const out: SaleDocRow[] = [];
  snap.forEach((d) => out.push({ id: d.id, data: d.data() as SaleDoc }));
  return out;
}

const NAME_BATCH = 25;

/**
 * Resolve product display names for a set of product ids (parallel getDoc batches).
 */
export async function fetchProductNamesByIds(
  db: Firestore,
  productIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(productIds.filter((id) => id && id.length > 0))];
  const map = new Map<string, string>();

  for (let i = 0; i < unique.length; i += NAME_BATCH) {
    const chunk = unique.slice(i, i + NAME_BATCH);
    const snaps = await Promise.all(
      chunk.map((id) => getDoc(doc(db, COLLECTIONS.products, id))),
    );
    snaps.forEach((s, idx) => {
      const id = chunk[idx]!;
      if (!s.exists()) {
        map.set(id, "(unknown product)");
        return;
      }
      const d = s.data() as ProductDoc;
      map.set(id, typeof d.name === "string" && d.name.trim() ? d.name.trim() : "(unnamed)");
    });
  }

  return map;
}
