/**
 * What an invoice line is worth the moment a clerk picks a product.
 *
 * Extracted from the two invoice forms so it can be unit-tested — the inline duplicate it
 * replaces (identical in AddInvoiceForm and EditDraftInvoiceForm) never could be. This is the
 * only rule-driven auto-fill of a money field in the app, so it earns its own tests.
 *
 * The offer lands as a separate `offer_discount`, not as a lower unit price: the customer sees
 * the list price and the saving on the receipt, and the clerk's own Discount box stays free to
 * stack on top of it.
 */

import {
  resolveOfferPrice,
  type OfferPricingProduct,
  type OfferPricingRule,
} from "@/lib/pricing/offerPricing";

export type SeededLine = {
  /** List price as a string for the form input. Never `toFixed`ed — see below. */
  unitPrice: string;
  /** Saving on ONE unit. The line's `offer_discount` is this × quantity. */
  offerDiscountPerUnit: number;
  /** Offer title, for the receipt. Null when nothing applies. */
  offerLabel: string | null;
};

/**
 * Returns null when the product is unknown, so the caller keeps whatever the clerk typed.
 *
 * `String(...)` rather than `toFixed(2)` deliberately: with no offer this yields exactly
 * today's `"1500"`, not `"1500.00"`. Every line in the app takes this path, so a formatting
 * change here would be a visible change on the overwhelming majority of invoices.
 */
export function seedLineForProduct(
  product: OfferPricingProduct | undefined,
  liveOffers: readonly OfferPricingRule[],
  newArrivalThresholdDays: number,
  now: Date = new Date(),
): SeededLine | null {
  if (!product || typeof product.salePrice !== "number" || !Number.isFinite(product.salePrice)) {
    return null;
  }

  const price = resolveOfferPrice(product, liveOffers, newArrivalThresholdDays, now);
  return {
    unitPrice: String(price.listPrice),
    offerDiscountPerUnit: price.savings,
    offerLabel: price.offer ? price.offer.title : null,
  };
}

/**
 * The line's `offer_discount` for a given quantity, rounded to cents.
 *
 * Recomputed on every quantity edit — but the unit price never is, or a clerk's manual price
 * override would be silently stomped.
 */
export function offerDiscountForQuantity(offerDiscountPerUnit: number, quantity: number): number {
  if (!Number.isFinite(offerDiscountPerUnit) || offerDiscountPerUnit <= 0) return 0;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(offerDiscountPerUnit * quantity * 100) / 100;
}
