import type { ProductDoc } from "@/lib/types/firestore";

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export const LOW_STOCK_THRESHOLD_PRESETS = [0, 5, 10, 20] as const;

export type LowStockStatus = "out_of_stock" | "need_reorder";

export type LowStockStatusFilter = "all" | LowStockStatus;

export type LowStockProductInput = {
  id: string;
  name: string;
  category?: string | null;
  stock_quantity: number;
  cost_price: number;
  sale_price: number;
  pricing_mode?: ProductDoc["pricing_mode"];
};

export type LowStockProductRow = {
  id: string;
  name: string;
  category: string | null;
  stock_quantity: number;
  cost_price: number;
  sale_price: number;
  stockValueAtCost: number;
  status: LowStockStatus;
  pricing_mode: "manual" | "automatic";
};

export type LowStockKpis = {
  matchingCount: number;
  outOfStockCount: number;
  reorderCount: number;
  totalUnitsAtRisk: number;
  totalValueAtCost: number;
};

export type LowStockListFilters = {
  search: string;
  category: string;
  status: LowStockStatusFilter;
};

export function normalizeThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LOW_STOCK_THRESHOLD;
  return Math.max(0, Math.floor(value));
}

export function parseThresholdFromUrl(value: string | null): number {
  if (value === null || value.trim() === "") return DEFAULT_LOW_STOCK_THRESHOLD;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LOW_STOCK_THRESHOLD;
  return normalizeThreshold(n);
}

function normalizeStockQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeMoney(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

export function toLowStockRow(product: LowStockProductInput): LowStockProductRow {
  const stock = normalizeStockQuantity(product.stock_quantity);
  const cost = normalizeMoney(product.cost_price);
  const sale = normalizeMoney(product.sale_price);

  return {
    id: product.id,
    name: typeof product.name === "string" && product.name.trim() !== "" ? product.name : "—",
    category: typeof product.category === "string" && product.category.trim() !== "" ? product.category : null,
    stock_quantity: stock,
    cost_price: cost,
    sale_price: sale,
    stockValueAtCost: stock * cost,
    status: stock === 0 ? "out_of_stock" : "need_reorder",
    pricing_mode: product.pricing_mode === "automatic" ? "automatic" : "manual",
  };
}

export function filterLowStockProducts(
  products: LowStockProductInput[],
  threshold: number,
  opts?: { status?: LowStockStatusFilter },
): LowStockProductRow[] {
  const t = normalizeThreshold(threshold);
  const statusFilter = opts?.status ?? "all";

  return products
    .map(toLowStockRow)
    .filter((row) => row.stock_quantity <= t)
    .filter((row) => statusFilter === "all" || row.status === statusFilter)
    .sort((a, b) => a.stock_quantity - b.stock_quantity);
}

export function applyLowStockListFilters(
  rows: LowStockProductRow[],
  filters: LowStockListFilters,
): LowStockProductRow[] {
  const q = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (q) {
      const name = row.name.toLowerCase();
      const category = (row.category ?? "").toLowerCase();
      if (!name.includes(q) && !category.includes(q)) return false;
    }
    if (filters.category && (row.category ?? "") !== filters.category) return false;
    return true;
  });
}

export function computeLowStockKpis(rows: LowStockProductRow[]): LowStockKpis {
  let outOfStockCount = 0;
  let reorderCount = 0;
  let totalUnitsAtRisk = 0;
  let totalValueAtCost = 0;

  for (const row of rows) {
    totalUnitsAtRisk += row.stock_quantity;
    totalValueAtCost += row.stockValueAtCost;
    if (row.status === "out_of_stock") outOfStockCount += 1;
    else reorderCount += 1;
  }

  return {
    matchingCount: rows.length,
    outOfStockCount,
    reorderCount,
    totalUnitsAtRisk,
    totalValueAtCost,
  };
}

export function collectProductCategories(products: LowStockProductInput[]): string[] {
  const set = new Set<string>();
  for (const product of products) {
    if (typeof product.category === "string" && product.category.trim() !== "") {
      set.add(product.category);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function lowStockStatusLabel(status: LowStockStatus): string {
  return status === "out_of_stock" ? "Out of stock" : "Need reorder";
}
