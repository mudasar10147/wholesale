import type { LowStockProductRow } from "@/lib/inventory/lowStock";
import {
  purchasePriceHistoryByProduct,
  resolvePurchasePrices,
  type StockLotRow,
} from "@/lib/inventory/reorderListPrices";

export type ReorderListRow = {
  key: string;
  isCustom: boolean;
  productId?: string;
  name: string;
  category: string | null;
  purchasePrice: number | null;
  previousPurchasePrice: number | null;
  lastPurchasePrice: number | null;
  stockQuantity: number;
};

function normalizeCategory(category: string | null | undefined): string | null {
  if (typeof category !== "string") return null;
  const trimmed = category.trim();
  return trimmed !== "" ? trimmed : null;
}

function compareCategories(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** Sort by category (alphabetical), then product name. Uncategorized/custom items last. */
export function sortReorderRowsByCategory(rows: ReorderListRow[]): ReorderListRow[] {
  return [...rows].sort((a, b) => {
    const byCategory = compareCategories(a.category, b.category);
    if (byCategory !== 0) return byCategory;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function createCustomReorderRow(name: string): ReorderListRow {
  const trimmed = name.trim();
  return {
    key: `custom-${crypto.randomUUID()}`,
    isCustom: true,
    name: trimmed,
    category: null,
    purchasePrice: null,
    previousPurchasePrice: null,
    lastPurchasePrice: null,
    stockQuantity: 0,
  };
}

export function buildReorderRowsFromLowStock(
  products: LowStockProductRow[],
  lots: StockLotRow[],
): ReorderListRow[] {
  const history = purchasePriceHistoryByProduct(lots);

  return sortReorderRowsByCategory(
    products.map((row) => {
      const prices = resolvePurchasePrices(row.id, row.cost_price, history);
      return {
        key: row.id,
        isCustom: false,
        productId: row.id,
        name: row.name,
        category: normalizeCategory(row.category),
        purchasePrice: row.cost_price,
        previousPurchasePrice: prices.previousPurchasePrice,
        lastPurchasePrice: prices.lastPurchasePrice,
        stockQuantity: row.stock_quantity,
      };
    }),
  );
}
