import type { CategoryMarginTemplate, ProductDoc } from "@/lib/types/firestore";
import { DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT } from "@/lib/types/firestore";

export type MarginColorBand = "red" | "orange" | "green" | "darkGreen" | "neutral";

export type PricingProductRow = ProductDoc & { id: string };

export type PricingSummary = {
  totalProducts: number;
  averageMarginPercent: number | null;
  productsBelowTarget: number;
  lowestMarginProduct: { name: string; marginPercent: number } | null;
  highestMarginProduct: { name: string; marginPercent: number } | null;
  potentialAdditionalProfit: number;
};

export type EnrichedPricingRow = PricingProductRow & {
  profitPerUnit: number;
  marginPercent: number | null;
  markupPercent: number | null;
  inventoryValue: number;
  effectiveTargetMarginPercent: number;
  potentialProfitLost: number;
  isBelowTarget: boolean;
  isLowMargin: boolean;
  isOutOfStock: boolean;
};

export function profitPerUnit(salePrice: number, costPrice: number): number {
  return salePrice - costPrice;
}

/** Gross margin % on selling price. */
export function marginPercent(salePrice: number, costPrice: number): number | null {
  if (salePrice <= 0 || !Number.isFinite(salePrice)) return null;
  return ((salePrice - costPrice) / salePrice) * 100;
}

/** Markup % on cost. */
export function markupPercent(salePrice: number, costPrice: number): number | null {
  if (costPrice <= 0 || !Number.isFinite(costPrice)) return null;
  return ((salePrice - costPrice) / costPrice) * 100;
}

export function inventoryValue(costPrice: number, stockQuantity: number): number {
  const cost = Number.isFinite(costPrice) ? costPrice : 0;
  const stock = Number.isFinite(stockQuantity) ? stockQuantity : 0;
  return cost * stock;
}

/** Rounded to whole currency units (e.g. rupees with no paise). */
export function automaticSalePrice(costPrice: number, targetMarginPercent: number): number {
  if (costPrice < 0 || !Number.isFinite(costPrice)) return 0;
  if (targetMarginPercent >= 100) throw new Error("Target margin must be below 100%.");
  if (targetMarginPercent <= 0) return Math.round(costPrice);
  return Math.round(costPrice / (1 - targetMarginPercent / 100));
}

export function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function resolveEffectiveTargetMargin(
  product: Pick<ProductDoc, "target_margin_percent" | "category">,
  categoryTemplates: Record<string, CategoryMarginTemplate>,
  globalDefault: number = DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT,
): number {
  if (
    typeof product.target_margin_percent === "number" &&
    Number.isFinite(product.target_margin_percent)
  ) {
    return product.target_margin_percent;
  }
  const cat = product.category?.trim();
  if (cat && categoryTemplates[cat]) {
    return categoryTemplates[cat].target_margin_percent;
  }
  return globalDefault;
}

export function resolveEffectivePricingMode(
  product: Pick<ProductDoc, "pricing_mode" | "category">,
  categoryTemplates: Record<string, CategoryMarginTemplate>,
): "manual" | "automatic" {
  if (product.pricing_mode === "automatic" || product.pricing_mode === "manual") {
    return product.pricing_mode;
  }
  const cat = product.category?.trim();
  if (cat && categoryTemplates[cat]) {
    return categoryTemplates[cat].pricing_mode;
  }
  return "manual";
}

export function potentialProfitLost(
  salePrice: number,
  costPrice: number,
  targetMarginPercent: number,
  stockQuantity: number,
): number {
  const margin = marginPercent(salePrice, costPrice);
  if (margin === null || margin >= targetMarginPercent) return 0;
  const targetSale = automaticSalePrice(costPrice, targetMarginPercent);
  const lostPerUnit = Math.max(0, targetSale - salePrice);
  const stock = Number.isFinite(stockQuantity) ? stockQuantity : 0;
  return roundMoney2(lostPerUnit * stock);
}

export function isLowMargin(marginPct: number | null, threshold = 8): boolean {
  return marginPct !== null && marginPct < threshold;
}

export function isBelowTargetMargin(
  salePrice: number,
  costPrice: number,
  targetMarginPercent: number,
): boolean {
  const margin = marginPercent(salePrice, costPrice);
  if (margin === null) return false;
  return margin < targetMarginPercent;
}

export function marginColorBand(marginPct: number | null): MarginColorBand {
  if (marginPct === null || !Number.isFinite(marginPct)) return "neutral";
  if (marginPct < 8) return "red";
  if (marginPct < 12) return "orange";
  if (marginPct <= 18) return "green";
  return "darkGreen";
}

export function marginColorClass(band: MarginColorBand): string {
  switch (band) {
    case "red":
      return "text-destructive font-medium";
    case "orange":
      return "text-amber-600 dark:text-amber-400 font-medium";
    case "green":
      return "text-emerald-600 dark:text-emerald-400 font-medium";
    case "darkGreen":
      return "text-emerald-800 dark:text-emerald-300 font-semibold";
    default:
      return "text-muted-foreground";
  }
}

export function enrichPricingRow(
  row: PricingProductRow,
  categoryTemplates: Record<string, CategoryMarginTemplate>,
  globalDefault: number,
): EnrichedPricingRow {
  const cost = typeof row.cost_price === "number" ? row.cost_price : 0;
  const sale = typeof row.sale_price === "number" ? row.sale_price : 0;
  const stock = typeof row.stock_quantity === "number" ? row.stock_quantity : 0;
  const margin = marginPercent(sale, cost);
  const effectiveTarget = resolveEffectiveTargetMargin(row, categoryTemplates, globalDefault);
  const belowTarget = isBelowTargetMargin(sale, cost, effectiveTarget);
  return {
    ...row,
    profitPerUnit: profitPerUnit(sale, cost),
    marginPercent: margin,
    markupPercent: markupPercent(sale, cost),
    inventoryValue: inventoryValue(cost, stock),
    effectiveTargetMarginPercent: effectiveTarget,
    potentialProfitLost: belowTarget
      ? potentialProfitLost(sale, cost, effectiveTarget, stock)
      : 0,
    isBelowTarget: belowTarget,
    isLowMargin: isLowMargin(margin),
    isOutOfStock: stock <= 0,
  };
}

export function aggregatePricingSummary(
  rows: PricingProductRow[],
  globalDefault: number,
  categoryTemplates: Record<string, CategoryMarginTemplate>,
): PricingSummary {
  const enriched = rows.map((r) => enrichPricingRow(r, categoryTemplates, globalDefault));
  const margins = enriched
    .map((r) => r.marginPercent)
    .filter((m): m is number => m !== null && Number.isFinite(m));

  let lowest: { name: string; marginPercent: number } | null = null;
  let highest: { name: string; marginPercent: number } | null = null;
  for (const r of enriched) {
    if (r.marginPercent === null) continue;
    if (!lowest || r.marginPercent < lowest.marginPercent) {
      lowest = { name: r.name, marginPercent: r.marginPercent };
    }
    if (!highest || r.marginPercent > highest.marginPercent) {
      highest = { name: r.name, marginPercent: r.marginPercent };
    }
  }

  const averageMarginPercent =
    margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : null;

  return {
    totalProducts: rows.length,
    averageMarginPercent,
    productsBelowTarget: enriched.filter((r) => r.isBelowTarget).length,
    lowestMarginProduct: lowest,
    highestMarginProduct: highest,
    potentialAdditionalProfit: roundMoney2(
      enriched.reduce((sum, r) => sum + r.potentialProfitLost, 0),
    ),
  };
}
