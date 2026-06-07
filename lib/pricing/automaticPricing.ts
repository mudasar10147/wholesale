import {
  automaticSalePrice,
  resolveEffectivePricingMode,
  resolveEffectiveTargetMargin,
} from "@/lib/pricing/metrics";
import type { CategoryMarginTemplate, ProductDoc } from "@/lib/types/firestore";
import { DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT } from "@/lib/types/firestore";

export type PricingPatch = Record<string, unknown>;

export function resolveEffectiveTargetMarginFromSettings(
  product: Pick<ProductDoc, "target_margin_percent" | "category">,
  categoryTemplates: Record<string, CategoryMarginTemplate>,
  globalDefault: number = DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT,
): number {
  return resolveEffectiveTargetMargin(product, categoryTemplates, globalDefault);
}

/**
 * When pricing_mode is automatic, set sale_price from cost and target margin on the patch.
 * Returns true if sale_price was updated.
 */
export function maybeApplyAutomaticSalePrice(
  product: ProductDoc | undefined,
  patch: PricingPatch,
  opts?: {
    categoryTemplates?: Record<string, CategoryMarginTemplate>;
    globalDefault?: number;
    /** Explicit sale price from stock-in overrides automatic recalc. */
    manualSalePriceOverride?: number;
  },
): boolean {
  if (opts?.manualSalePriceOverride !== undefined) {
    return false;
  }

  const merged: ProductDoc = {
    name: product?.name ?? "",
    cost_price: typeof patch.cost_price === "number" ? patch.cost_price : (product?.cost_price ?? 0),
    sale_price: typeof patch.sale_price === "number" ? patch.sale_price : (product?.sale_price ?? 0),
    stock_quantity: product?.stock_quantity ?? 0,
    created_at: product?.created_at ?? ({} as ProductDoc["created_at"]),
    target_margin_percent:
      patch.target_margin_percent !== undefined
        ? (patch.target_margin_percent as number | undefined)
        : product?.target_margin_percent,
    pricing_mode:
      patch.pricing_mode !== undefined
        ? (patch.pricing_mode as ProductDoc["pricing_mode"])
        : product?.pricing_mode,
    category: product?.category,
  };

  const mode = resolveEffectivePricingMode(
    merged,
    opts?.categoryTemplates ?? {},
  );
  if (mode !== "automatic") return false;

  const target = resolveEffectiveTargetMargin(
    merged,
    opts?.categoryTemplates ?? {},
    opts?.globalDefault ?? DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT,
  );
  const cost = merged.cost_price;
  patch.sale_price = automaticSalePrice(cost, target);
  return true;
}

export function computeAutomaticSalePriceForProduct(
  product: Pick<ProductDoc, "cost_price" | "target_margin_percent" | "category">,
  categoryTemplates: Record<string, CategoryMarginTemplate>,
  globalDefault: number = DEFAULT_GLOBAL_TARGET_MARGIN_PERCENT,
): number {
  const target = resolveEffectiveTargetMargin(product, categoryTemplates, globalDefault);
  return automaticSalePrice(product.cost_price, target);
}

export function inheritPricingFieldsForNewProduct(
  category: string | undefined,
  categoryTemplates: Record<string, CategoryMarginTemplate>,
  globalDefault: number,
  costPrice: number,
): Pick<ProductDoc, "target_margin_percent" | "pricing_mode" | "sale_price"> {
  const cat = category?.trim();
  const template = cat ? categoryTemplates[cat] : undefined;
  const target_margin_percent = template?.target_margin_percent ?? globalDefault;
  const pricing_mode = template?.pricing_mode ?? "manual";
  let sale_price = 0;
  if (pricing_mode === "automatic") {
    sale_price = automaticSalePrice(costPrice, target_margin_percent);
  }
  return { target_margin_percent, pricing_mode, sale_price };
}
