/**
 * What a product actually sells for while an offer is running.
 *
 * Offers are a DERIVED layer: `products.sale_price` is never written to (see the header of
 * ./metrics.ts — automatic price-setting was deliberately removed so the list price is only
 * ever set by hand). An offer ending therefore restores prices with no cleanup and no
 * migration, and a historical invoice keeps whatever it was written with.
 *
 * Deliberately Firestore-free, like lib/products/newArrival.ts, so it runs in the browser, on
 * the server, and under `node --experimental-strip-types` in tests without dragging in the SDK.
 */

import { isNewArrival } from "@/lib/products/newArrival";
import type { SocialOfferDiscountType } from "@/lib/types/firestore";

/**
 * The minimal offer shape the pricer needs. `SocialOfferRow` satisfies it structurally, so
 * callers pass Firestore rows straight in. Not `SocialOfferDoc` itself: that pulls in
 * `Timestamp`, and this module must stay loadable outside the Firestore SDK.
 */
export type OfferPricingRule = {
  id: string;
  title: string;
  discount_type: SocialOfferDiscountType;
  discount_value: number;
  /**
   * In a normal offer, the products it covers. In a sitewide offer (`applies_to_all`), the
   * products it EXCLUDES — the same list, read the other way round.
   */
  product_ids: string[];
  /** Sitewide sale. Absent on offers authored before this existed — treat as false. */
  applies_to_all?: boolean;
  /** Sitewide sales skip new arrivals unless this is set. Ignored by normal offers. */
  includes_new_arrivals?: boolean;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
};

/** Just enough of a product to price it. `createdAt` is only consulted by sitewide offers. */
export type OfferPricingProduct = {
  id: string;
  salePrice: number;
  /** Firestore Timestamp, Date, or epoch ms — whatever the surface has on hand. */
  createdAt?: unknown;
};

export type OfferPrice = {
  /** The manually-set list price, untouched. */
  listPrice: number;
  /** What the customer pays now. Equals `listPrice` when no offer applies. */
  effectivePrice: number;
  /** `listPrice - effectivePrice`, never negative. */
  savings: number;
  /** The winning offer, or null when the product is not on offer. */
  offer: OfferPricingRule | null;
  /** Whole percent off, derived — so a flat "Rs. 250 off" still reads as "25% off". */
  percentOff: number | null;
};

/** Money is compared and rounded in integer cents — see the note on `discountedCents`. */
function toCents(n: number): number {
  return Math.round(n * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

function finiteOrZero(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Active, and today falls inside the validity window. Both bounds inclusive. */
export function isOfferLive(
  offer: Pick<OfferPricingRule, "is_active" | "starts_on" | "ends_on">,
  todayKey: string,
): boolean {
  return offer.is_active && offer.starts_on <= todayKey && offer.ends_on >= todayKey;
}

/** The subset of offers in force today. Preserves input order. */
export function selectLiveOffers<T extends OfferPricingRule>(
  offers: readonly T[],
  todayKey: string,
): T[] {
  return offers.filter((offer) => isOfferLive(offer, todayKey));
}

/**
 * Whether an offer applies to a product.
 *
 * A sitewide offer covers everything EXCEPT what is listed on it, and except new arrivals
 * unless it opts them in — so stocking a new SKU mid-sale does not silently discount it.
 */
export function offerCoversProduct(
  offer: OfferPricingRule,
  product: OfferPricingProduct,
  newArrivalThresholdDays: number,
  now: Date = new Date(),
): boolean {
  const listed = offer.product_ids.includes(product.id);
  if (!offer.applies_to_all) {
    return listed;
  }
  if (listed) {
    return false;
  }
  if (offer.includes_new_arrivals) {
    return true;
  }
  return !isNewArrival(product.createdAt, newArrivalThresholdDays, now);
}

/**
 * What one offer would charge, in cents. Null means "this offer does not price anything" —
 * a 'none' offer is caption-only decoration, and must be able neither to win nor to suppress
 * a real discount running alongside it.
 */
function discountedCents(baseCents: number, offer: OfferPricingRule): number | null {
  if (offer.discount_type === "none") {
    return null;
  }
  if (offer.discount_type === "percent") {
    const pct = Math.min(100, Math.max(0, finiteOrZero(offer.discount_value)));
    return Math.round((baseCents * (100 - pct)) / 100);
  }
  // Flat: floors at zero. A typo'd "5000 off" on a 1499 item gives away the item, not money.
  return Math.max(0, baseCents - toCents(Math.max(0, finiteOrZero(offer.discount_value))));
}

/** The answer for a product nothing applies to. Also the shape every surface falls back to. */
export function noOfferPrice(listPrice: number): OfferPrice {
  const price = fromCents(Math.max(0, toCents(finiteOrZero(listPrice))));
  return { listPrice: price, effectivePrice: price, savings: 0, offer: null, percentOff: null };
}

function priceFrom(baseCents: number, bestCents: number, winner: OfferPricingRule | null): OfferPrice {
  const listPrice = fromCents(baseCents);
  if (!winner || bestCents >= baseCents) {
    return { listPrice, effectivePrice: listPrice, savings: 0, offer: null, percentOff: null };
  }
  const savingsCents = baseCents - bestCents;
  return {
    listPrice,
    effectivePrice: fromCents(bestCents),
    savings: fromCents(savingsCents),
    offer: winner,
    percentOff: Math.round((savingsCents / baseCents) * 100),
  };
}

/**
 * The winning price across every live offer: the one that leaves the customer paying least.
 *
 * Compared in integer cents so float wobble cannot flip the winner. A sitewide offer and a
 * product-specific one compete on exactly equal footing — which is the whole payoff of the
 * "best deal wins" rule: no precedence logic is needed anywhere. Ties go to the first offer in
 * the array, and `fetchSocialOffers` sorts `starts_on` descending, so a tie resolves to the
 * most recently started offer, deterministically.
 *
 * Exactly one offer ever wins, so discounts never stack and there is no compounding rounding.
 */
export function resolveOfferPrice(
  product: OfferPricingProduct,
  liveOffers: readonly OfferPricingRule[],
  newArrivalThresholdDays: number,
  now: Date = new Date(),
): OfferPrice {
  const baseCents = Math.max(0, toCents(finiteOrZero(product.salePrice)));
  if (baseCents <= 0) {
    return noOfferPrice(fromCents(baseCents));
  }

  let winner: OfferPricingRule | null = null;
  let bestCents = baseCents;
  for (const offer of liveOffers) {
    if (!offerCoversProduct(offer, product, newArrivalThresholdDays, now)) continue;
    const cents = discountedCents(baseCents, offer);
    if (cents === null) continue;
    if (cents < bestCents) {
      bestCents = cents;
      winner = offer;
    }
  }

  return priceFrom(baseCents, bestCents, winner);
}

/**
 * A prebuilt resolver for list surfaces. Splitting sitewide from per-product offers once keeps
 * a long product table O(1) per row instead of O(offers × product_ids).
 */
export type OfferPriceIndex = {
  price(product: OfferPricingProduct): OfferPrice;
  /** True when nothing is running — lets a surface skip offer rendering entirely. */
  readonly isEmpty: boolean;
};

export function buildOfferPriceIndex(
  liveOffers: readonly OfferPricingRule[],
  newArrivalThresholdDays: number,
  now: Date = new Date(),
): OfferPriceIndex {
  // Rank is the offer's position in `liveOffers`. Candidates are re-sorted by it before
  // pricing, so an exact tie resolves to the same winner the direct path would pick.
  type Ranked = { offer: OfferPricingRule; rank: number };
  const sitewide: Ranked[] = [];
  const byProductId = new Map<string, Ranked[]>();

  liveOffers.forEach((offer, rank) => {
    if (offer.applies_to_all) {
      sitewide.push({ offer, rank });
      return;
    }
    for (const productId of offer.product_ids) {
      const bucket = byProductId.get(productId);
      if (bucket) bucket.push({ offer, rank });
      else byProductId.set(productId, [{ offer, rank }]);
    }
  });

  return {
    isEmpty: liveOffers.length === 0,
    price(product) {
      const candidates = sitewide.concat(byProductId.get(product.id) ?? []);
      if (candidates.length === 0) {
        return noOfferPrice(product.salePrice);
      }
      candidates.sort((a, b) => a.rank - b.rank);
      return resolveOfferPrice(
        product,
        candidates.map((c) => c.offer),
        newArrivalThresholdDays,
        now,
      );
    },
  };
}

/**
 * The price cell for string-only output (PDFs). Returns exactly `format(listPrice)` when there
 * is no offer, so untouched rows render byte-identically to before offers existed.
 */
export function formatOfferPriceCell(price: OfferPrice, format: (n: number) => string): string {
  if (!price.offer) {
    return format(price.listPrice);
  }
  return `${format(price.effectivePrice)} (was ${format(price.listPrice)}, ${price.percentOff}% off)`;
}
