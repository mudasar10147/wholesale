"use client";

import { useLiveOffers } from "@/lib/firestore/liveOffers";
import type { OfferPrice, OfferPricingProduct } from "@/lib/pricing/offerPricing";
import { noOfferPrice } from "@/lib/pricing/offerPricing";
import { cn } from "@/lib/utils";

/** The formatter every local `formatMoney` in this codebase is a copy of. */
function defaultFormat(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * The "N% off" pill. Returns nothing when a product is not on offer, so it can be dropped in
 * unconditionally next to a price — same contract as {@link NewArrivalBadge}.
 */
export function OfferBadge({
  percentOff,
  offerTitle,
  className,
}: {
  percentOff: number | null;
  offerTitle?: string;
  className?: string;
}) {
  if (percentOff === null || percentOff <= 0) return null;
  return (
    <span
      title={offerTitle}
      className={cn(
        "shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400",
        className,
      )}
    >
      {percentOff}% off
    </span>
  );
}

/**
 * A product's price, struck through and replaced when an offer is running.
 *
 * Pure by design: the price is resolved by the caller, not here. A list renders many of these,
 * so the parent reads the live offers once (via {@link useLiveOffers}) and prices rows from the
 * index rather than opening a Firestore listener per row. For a one-off, use
 * {@link ConnectedOfferPriceText}.
 *
 * With no offer it renders a BARE fragment — no wrapper, no class. Every cell this drops into
 * already carries its own styling, so an extra span would shift the layout of every
 * non-discounted row, which is nearly all of them.
 */
export function OfferPriceText({
  price,
  format = defaultFormat,
  showBadge = true,
  className,
}: {
  price: OfferPrice;
  /** The caller's own money formatter — this repo has no shared one. */
  format?: (n: number) => string;
  showBadge?: boolean;
  className?: string;
}) {
  if (!price.offer) {
    return <>{format(price.listPrice)}</>;
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-muted-foreground line-through">{format(price.listPrice)}</span>
      <span className="font-semibold text-foreground">{format(price.effectivePrice)}</span>
      {showBadge ? <OfferBadge percentOff={price.percentOff} offerTitle={price.offer.title} /> : null}
    </span>
  );
}

/** Self-contained: reads the live offers itself. Use for standalone, non-list surfaces. */
export function ConnectedOfferPriceText({
  product,
  format,
  showBadge,
  className,
}: {
  product: OfferPricingProduct;
  format?: (n: number) => string;
  showBadge?: boolean;
  className?: string;
}) {
  const { index, loading } = useLiveOffers();
  const price = loading ? noOfferPrice(product.salePrice) : index.price(product);
  return (
    <OfferPriceText price={price} format={format} showBadge={showBadge} className={className} />
  );
}
