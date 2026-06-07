/**
 * Run: npm run test:pricing
 * Standalone tests (no path aliases) for pricing formulas.
 */
import assert from "node:assert/strict";

const DEFAULT_GLOBAL = 15;

function marginPercent(salePrice: number, costPrice: number): number | null {
  if (salePrice <= 0 || !Number.isFinite(salePrice)) return null;
  return ((salePrice - costPrice) / salePrice) * 100;
}

function markupPercent(salePrice: number, costPrice: number): number | null {
  if (costPrice <= 0 || !Number.isFinite(costPrice)) return null;
  return ((salePrice - costPrice) / costPrice) * 100;
}

function automaticSalePrice(costPrice: number, targetMarginPercent: number): number {
  if (costPrice < 0 || !Number.isFinite(costPrice)) return 0;
  if (targetMarginPercent >= 100) throw new Error("Target margin must be below 100%.");
  if (targetMarginPercent <= 0) return Math.round(costPrice);
  return Math.round(costPrice / (1 - targetMarginPercent / 100));
}

function potentialProfitLost(
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
  return Math.round(lostPerUnit * stock * 100) / 100;
}

function resolveEffectiveTargetMargin(
  product: { target_margin_percent?: number; category?: string },
  categoryTemplates: Record<string, { target_margin_percent: number }>,
  globalDefault = DEFAULT_GLOBAL,
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

assert.equal(marginPercent(120, 100), (20 / 120) * 100);
assert.equal(markupPercent(120, 100), 20);
assert.equal(marginPercent(0, 100), null);
assert.equal(automaticSalePrice(100, 20), 125);
assert.equal(automaticSalePrice(50, 50), 100);
assert.equal(automaticSalePrice(563, 15), 662);
assert.throws(() => automaticSalePrice(100, 100));
assert.equal(potentialProfitLost(90, 80, 20, 10), 100);
assert.equal(potentialProfitLost(100, 80, 20, 10), 0);
assert.equal(
  resolveEffectiveTargetMargin({ category: "Snacks" }, { Snacks: { target_margin_percent: 18 } }),
  18,
);
assert.equal(
  resolveEffectiveTargetMargin(
    { category: "Snacks", target_margin_percent: 22 },
    { Snacks: { target_margin_percent: 18 } },
  ),
  22,
);

console.log("lib/pricing/metrics.test.ts — all passed");
