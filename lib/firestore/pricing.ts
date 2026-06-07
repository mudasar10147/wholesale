import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { maybeApplyAutomaticSalePrice } from "@/lib/pricing/automaticPricing";
import {
  automaticSalePrice,
  resolveEffectivePricingMode,
  resolveEffectiveTargetMargin,
} from "@/lib/pricing/metrics";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { loadPricingSettings } from "@/lib/firestore/pricingSettings";
import type { CategoryMarginTemplate, PricingMode, ProductDoc } from "@/lib/types/firestore";

const BATCH_SIZE = 450;

export type UpdateProductPricingInput = {
  target_margin_percent?: number;
  pricing_mode?: PricingMode;
  sale_price?: number;
};

function validateTargetMargin(m: number): void {
  if (typeof m !== "number" || !Number.isFinite(m) || m < 0 || m >= 100) {
    throw new Error("Target margin must be between 0 and 100 (exclusive).");
  }
}

function validateSalePrice(p: number): void {
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0) {
    throw new Error("Sale price must be zero or greater.");
  }
}

export async function updateProductPricing(
  db: Firestore,
  productId: string,
  input: UpdateProductPricingInput,
): Promise<void> {
  const settings = await loadPricingSettings(db);
  const ref = doc(db, COLLECTIONS.products, productId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Product not found.");
    const product = snap.data() as ProductDoc;

    const patch: Record<string, unknown> = {
      pricing_updated_at: serverTimestamp(),
    };

    if (input.target_margin_percent !== undefined) {
      validateTargetMargin(input.target_margin_percent);
      patch.target_margin_percent = input.target_margin_percent;
    }

    if (input.pricing_mode !== undefined) {
      if (input.pricing_mode !== "manual" && input.pricing_mode !== "automatic") {
        throw new Error("Pricing mode must be manual or automatic.");
      }
      patch.pricing_mode = input.pricing_mode;
    }

    if (input.sale_price !== undefined) {
      validateSalePrice(input.sale_price);
      patch.sale_price = input.sale_price;
      patch.pricing_mode = "manual";
    }

    const merged: ProductDoc = {
      ...product,
      ...patch,
      target_margin_percent:
        patch.target_margin_percent !== undefined
          ? (patch.target_margin_percent as number)
          : product.target_margin_percent,
      pricing_mode:
        patch.pricing_mode !== undefined
          ? (patch.pricing_mode as PricingMode)
          : product.pricing_mode,
    };

    const mode = resolveEffectivePricingMode(merged, settings.categoryTemplates);
    if (mode === "automatic" && input.sale_price === undefined) {
      const target = resolveEffectiveTargetMargin(
        merged,
        settings.categoryTemplates,
        settings.globalDefaultTargetMarginPercent,
      );
      patch.sale_price = automaticSalePrice(product.cost_price, target);
      patch.pricing_mode = "automatic";
    }

    tx.update(ref, patch);
  });
}

async function loadProductsByIds(
  db: Firestore,
  productIds: string[],
): Promise<Array<{ id: string; data: ProductDoc }>> {
  const out: Array<{ id: string; data: ProductDoc }> = [];
  for (const id of productIds) {
    const snap = await getDoc(doc(db, COLLECTIONS.products, id));
    if (snap.exists()) {
      out.push({ id: snap.id, data: snap.data() as ProductDoc });
    }
  }
  return out;
}

export async function bulkUpdateTargetMargin(
  db: Firestore,
  productIds: string[],
  targetMarginPercent: number,
): Promise<void> {
  validateTargetMargin(targetMarginPercent);
  const settings = await loadPricingSettings(db);
  const products = await loadProductsByIds(db, productIds);

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const chunk = products.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const { id, data } of chunk) {
      const patch: Record<string, unknown> = {
        target_margin_percent: targetMarginPercent,
        pricing_updated_at: serverTimestamp(),
      };
      const merged = { ...data, target_margin_percent: targetMarginPercent };
      const mode = resolveEffectivePricingMode(merged, settings.categoryTemplates);
      if (mode === "automatic") {
        patch.sale_price = automaticSalePrice(data.cost_price, targetMarginPercent);
      }
      batch.update(doc(db, COLLECTIONS.products, id), patch);
    }
    await batch.commit();
  }
}

export async function bulkSetPricingMode(
  db: Firestore,
  productIds: string[],
  mode: PricingMode,
): Promise<void> {
  if (mode !== "manual" && mode !== "automatic") {
    throw new Error("Pricing mode must be manual or automatic.");
  }
  const settings = await loadPricingSettings(db);
  const products = await loadProductsByIds(db, productIds);

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const chunk = products.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const { id, data } of chunk) {
      const patch: Record<string, unknown> = {
        pricing_mode: mode,
        pricing_updated_at: serverTimestamp(),
      };
      if (mode === "automatic") {
        const merged = { ...data, pricing_mode: mode };
        const target = resolveEffectiveTargetMargin(
          merged,
          settings.categoryTemplates,
          settings.globalDefaultTargetMarginPercent,
        );
        patch.sale_price = automaticSalePrice(data.cost_price, target);
      }
      batch.update(doc(db, COLLECTIONS.products, id), patch);
    }
    await batch.commit();
  }
}

export async function bulkRecalculateSalePrices(
  db: Firestore,
  productIds: string[],
): Promise<void> {
  const settings = await loadPricingSettings(db);
  const products = await loadProductsByIds(db, productIds);

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const chunk = products.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const { id, data } of chunk) {
      const mode = resolveEffectivePricingMode(data, settings.categoryTemplates);
      if (mode !== "automatic") continue;
      const target = resolveEffectiveTargetMargin(
        data,
        settings.categoryTemplates,
        settings.globalDefaultTargetMarginPercent,
      );
      batch.update(doc(db, COLLECTIONS.products, id), {
        sale_price: automaticSalePrice(data.cost_price, target),
        pricing_updated_at: serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

/**
 * Apply automatic pricing to a product patch inside a transaction.
 */
export function applyAutomaticPricingToPatch(
  product: ProductDoc | undefined,
  patch: Record<string, unknown>,
  categoryTemplates: Record<string, CategoryMarginTemplate>,
  globalDefault: number,
  manualSalePriceOverride?: number,
): void {
  const applied = maybeApplyAutomaticSalePrice(product, patch, {
    categoryTemplates,
    globalDefault,
    manualSalePriceOverride,
  });
  if (applied) {
    patch.pricing_updated_at = serverTimestamp();
  }
}

export async function loadPricingSettingsForWrites(db: Firestore) {
  return loadPricingSettings(db);
}
