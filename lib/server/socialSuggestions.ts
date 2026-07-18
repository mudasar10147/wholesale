import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { defaultNewArrivalSettings } from "@/lib/products/newArrival";
import {
  DEFAULT_NEW_ARRIVAL_THRESHOLD_DAYS,
  NEW_ARRIVAL_SETTINGS_DOC_ID,
  type NewArrivalSettingsDoc,
} from "@/lib/types/firestore";
import {
  rankAgingStock,
  rankBestSellers,
  rankNewArrivals,
  rankOverstock,
  type LotLine,
  type SaleLine,
  type SuggestionProduct,
} from "@/lib/social/suggestionRanking";
import type { SuggestionLens, SuggestionRow } from "@/lib/social/types";

/**
 * Product suggestions are computed here, on the server, with admin credentials —
 * NOT in the browser.
 *
 * The social role must never read `sales` or `stock_lots` directly: Firestore rules are
 * all-or-nothing per document, and those docs also carry `customer_id`, `unit_cost`,
 * `cogs_amount`, `trader_id` and `purchase_source`. Granting read access to rank best
 * sellers would hand the social manager our customer list, margins, and supplier list.
 *
 * So we read them here and return only `SuggestionRow`, which carries no such field.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Explicitly whitelists fields. Never spread the product doc — it contains `cost_price`. */
async function loadProducts(db: Firestore): Promise<SuggestionProduct[]> {
  const snap = await db.collection(COLLECTIONS.products).get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: str(data.name) ?? "Product",
      category: str(data.category),
      salePrice: num(data.sale_price),
      stockQuantity: num(data.stock_quantity),
      imageUrl: str(data.image_url),
      imagePath: str(data.image_path),
      createdAt: toDate(data.created_at),
    };
  });
}

/**
 * Sale lines in the window. Single-field range — served by the automatic index.
 *
 * Known approximation: voided invoices leave their `sales` rows behind (SaleDoc has no
 * status field), so a voided line still counts here. Filtering them out costs a full
 * `invoices` scan, which is not worth it for a suggestion list. If voids become common,
 * cross-check against `invoices` where `ledger_status == 'posted'`.
 */
async function loadSaleLines(db: Firestore, since: Date, now: Date): Promise<SaleLine[]> {
  const snap = await db
    .collection(COLLECTIONS.sales)
    .where("date", ">=", Timestamp.fromDate(since))
    .where("date", "<=", Timestamp.fromDate(now))
    .get();

  return snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        productId: str(data.product_id) ?? "",
        quantity: num(data.quantity),
        isReturn: data.sale_type === "return",
      };
    })
    .filter((line) => line.productId.length > 0);
}

function toLotLine(data: FirebaseFirestore.DocumentData): LotLine | null {
  const receivedAt = toDate(data.received_at);
  const productId = str(data.product_id);
  if (!receivedAt || !productId) return null;
  return {
    productId,
    qtyRemaining: num(data.qty_remaining),
    receivedAt,
    isStockIn: data.source === "stock_in",
  };
}

/** Lots still holding stock, at any age. Single inequality — no composite index needed. */
async function loadUnsoldLots(db: Firestore): Promise<LotLine[]> {
  const snap = await db.collection(COLLECTIONS.stockLots).where("qty_remaining", ">", 0).get();
  return snap.docs.map((doc) => toLotLine(doc.data())).filter((lot): lot is LotLine => lot !== null);
}

/**
 * The admin-configured new-arrival window (days). Falls back to the default when unset or
 * malformed — a suggestion list must never fail over a missing settings doc.
 */
async function loadNewArrivalThresholdDays(db: Firestore): Promise<number> {
  try {
    const snap = await db.collection(COLLECTIONS.settings).doc(NEW_ARRIVAL_SETTINGS_DOC_ID).get();
    if (!snap.exists) return defaultNewArrivalSettings().thresholdDays;
    const raw = snap.data() as NewArrivalSettingsDoc | undefined;
    const days = raw?.threshold_days;
    if (typeof days !== "number" || !Number.isFinite(days)) {
      return DEFAULT_NEW_ARRIVAL_THRESHOLD_DAYS;
    }
    const rounded = Math.round(days);
    return rounded >= 1 && rounded <= 365 ? rounded : DEFAULT_NEW_ARRIVAL_THRESHOLD_DAYS;
  } catch {
    return DEFAULT_NEW_ARRIVAL_THRESHOLD_DAYS;
  }
}

export async function computeSuggestions(
  lens: SuggestionLens,
  days: number,
  now = new Date(),
): Promise<SuggestionRow[]> {
  const db = getFirebaseAdminFirestore();
  const since = new Date(now.getTime() - days * MS_PER_DAY);

  // Each lens fetches only what it needs — no lens reads every collection.
  switch (lens) {
    case "best_sellers": {
      const [products, sales] = await Promise.all([loadProducts(db), loadSaleLines(db, since, now)]);
      return rankBestSellers(products, sales, days);
    }
    case "aging_stock": {
      const [products, sales, lots] = await Promise.all([
        loadProducts(db),
        loadSaleLines(db, since, now),
        loadUnsoldLots(db),
      ]);
      return rankAgingStock(products, sales, lots, days, now);
    }
    case "new_arrivals": {
      // New arrivals ignore the caller's window and the sales/lot ledgers entirely: a new
      // arrival is a newly *created* product, and how long it stays new is an admin setting.
      const [products, thresholdDays] = await Promise.all([
        loadProducts(db),
        loadNewArrivalThresholdDays(db),
      ]);
      return rankNewArrivals(products, thresholdDays, now);
    }
    case "overstock": {
      const [products, sales] = await Promise.all([loadProducts(db), loadSaleLines(db, since, now)]);
      return rankOverstock(products, sales, days);
    }
  }
}
