import type { SocialProductRow, SuggestionRow } from "@/lib/social/types";

/**
 * Pure ranking for the four suggestion lenses. Deliberately Firestore-free: the caller
 * reads the raw docs (server-side, with admin credentials) and hands plain values in.
 * Nothing in here touches cost, customer, or supplier data.
 */

export type SaleLine = {
  productId: string;
  quantity: number;
  /** Return rows store a POSITIVE quantity with negative money — they must subtract units. */
  isReturn: boolean;
};

export type LotLine = {
  productId: string;
  qtyRemaining: number;
  receivedAt: Date;
  /** Only `stock_in` lots are real purchases; opening balances and adjustments are not. */
  isStockIn: boolean;
};

export type SuggestionProduct = SocialProductRow & {
  createdAt: Date | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_SUGGESTION_LIMIT = 20;

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

/**
 * Net units sold per product. A returned unit cancels a sold one; without the
 * `isReturn` branch a heavily-returned product would rank as a best seller.
 */
export function netUnitsByProduct(sales: readonly SaleLine[]): Map<string, number> {
  const units = new Map<string, number>();
  for (const line of sales) {
    if (!line.productId || !Number.isFinite(line.quantity)) continue;
    const delta = line.isReturn ? -line.quantity : line.quantity;
    units.set(line.productId, (units.get(line.productId) ?? 0) + delta);
  }
  return units;
}

/** Oldest still-unsold lot per product, as an age in days. */
export function oldestLotAgeByProduct(lots: readonly LotLine[], now: Date): Map<string, number> {
  const ages = new Map<string, number>();
  for (const lot of lots) {
    if (lot.qtyRemaining <= 0) continue;
    const age = daysBetween(lot.receivedAt, now);
    const existing = ages.get(lot.productId);
    if (existing === undefined || age > existing) {
      ages.set(lot.productId, age);
    }
  }
  return ages;
}

/** Most recent purchase receipt per product. */
export function latestStockInByProduct(lots: readonly LotLine[]): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const lot of lots) {
    if (!lot.isStockIn) continue;
    const existing = latest.get(lot.productId);
    if (!existing || lot.receivedAt.getTime() > existing.getTime()) {
      latest.set(lot.productId, lot.receivedAt);
    }
  }
  return latest;
}

function toRow(product: SuggestionProduct, metricLabel: string, metricValue: number): SuggestionRow {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    salePrice: product.salePrice,
    stockQuantity: product.stockQuantity,
    imageUrl: product.imageUrl,
    imagePath: product.imagePath,
    createdAtMs: product.createdAt ? product.createdAt.getTime() : undefined,
    metricLabel,
    metricValue,
  };
}

function pluralDays(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

export function rankBestSellers(
  products: readonly SuggestionProduct[],
  sales: readonly SaleLine[],
  days: number,
  limit = DEFAULT_SUGGESTION_LIMIT,
): SuggestionRow[] {
  const units = netUnitsByProduct(sales);
  return products
    .map((product) => ({ product, sold: units.get(product.id) ?? 0 }))
    .filter((entry) => entry.sold > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, limit)
    .map((entry) => toRow(entry.product, `${entry.sold} sold in ${days}d`, entry.sold));
}

/**
 * In stock, but nothing sold in the window. Ranked by how long the oldest unsold unit
 * has been sitting — that is the money actually stuck on the shelf.
 */
export function rankAgingStock(
  products: readonly SuggestionProduct[],
  sales: readonly SaleLine[],
  lots: readonly LotLine[],
  days: number,
  now: Date,
  limit = DEFAULT_SUGGESTION_LIMIT,
): SuggestionRow[] {
  const units = netUnitsByProduct(sales);
  const ages = oldestLotAgeByProduct(lots, now);

  return products
    .filter((product) => product.stockQuantity > 0 && (units.get(product.id) ?? 0) <= 0)
    .map((product) => {
      // No lot on file (opening stock predating the ledger) — fall back to the product's own age.
      const age = ages.get(product.id) ?? (product.createdAt ? daysBetween(product.createdAt, now) : 0);
      return { product, age };
    })
    .sort((a, b) => b.age - a.age)
    .slice(0, limit)
    .map((entry) =>
      toRow(entry.product, `${pluralDays(entry.age)} in stock, no sale in ${days}d`, entry.age),
    );
}

/**
 * New arrivals are brand-new SKUs — products *created* within the window. A restocked
 * product is NOT a new arrival, so this looks only at `created_at`, never at stock receipts.
 * The window is the admin-configured new-arrival threshold.
 */
export function rankNewArrivals(
  products: readonly SuggestionProduct[],
  days: number,
  now: Date,
  limit = DEFAULT_SUGGESTION_LIMIT,
): SuggestionRow[] {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY);

  return products
    .map((product) => ({ product, createdAt: product.createdAt }))
    .filter(
      (entry): entry is { product: SuggestionProduct; createdAt: Date } =>
        entry.createdAt !== null && entry.createdAt >= cutoff,
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map((entry) => {
      const age = daysBetween(entry.createdAt, now);
      const label = age === 0 ? "Added today" : `Added ${pluralDays(age)} ago`;
      return toRow(entry.product, label, -age);
    });
}

/**
 * Selling, but far too slowly for how much is on hand. Products with zero sales are
 * excluded on purpose — those belong to the aging lens, and would otherwise flood this one
 * with an infinite weeks-of-cover.
 */
export function rankOverstock(
  products: readonly SuggestionProduct[],
  sales: readonly SaleLine[],
  days: number,
  limit = DEFAULT_SUGGESTION_LIMIT,
): SuggestionRow[] {
  const units = netUnitsByProduct(sales);
  const weeks = Math.max(days / 7, 1 / 7);

  return products
    .filter((product) => product.stockQuantity > 0)
    .map((product) => {
      const sold = units.get(product.id) ?? 0;
      const perWeek = sold / weeks;
      return { product, perWeek, cover: perWeek > 0 ? product.stockQuantity / perWeek : 0 };
    })
    .filter((entry) => entry.perWeek > 0 && entry.cover >= 1)
    .sort((a, b) => b.cover - a.cover)
    .slice(0, limit)
    .map((entry) => {
      const cover = Math.round(entry.cover);
      return toRow(
        entry.product,
        `${cover} weeks of stock left at current pace`,
        entry.cover,
      );
    });
}
