/**
 * Plain price/margin display helpers. The automatic percentage-based pricing feature that
 * once lived here (target-margin recompute, effective-mode resolution, below-target analytics)
 * has been removed — sale prices are now only ever set manually.
 */

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
