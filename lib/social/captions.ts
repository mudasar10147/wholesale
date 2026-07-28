import type {
  SocialMediaSettingsDoc,
  SocialOfferDoc,
  SocialPostKind,
} from "@/lib/types/firestore";
import type { SocialProductRow } from "@/lib/social/types";

/** Used until an admin saves `settings/social_media`. */
export const DEFAULT_SOCIAL_MEDIA_SETTINGS: Omit<SocialMediaSettingsDoc, "updated_at"> = {
  footer_line: "Limited stock | Order now",
  currency_prefix: "Rs.",
};

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function toPrice(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0";
}

/**
 * One product's line in a caption. Pass `listPrice` when the product is on offer and
 * `product.salePrice` already holds the discounted price — the old price is then struck
 * through, WhatsApp-style. Omit it and the output is byte-identical to before offers existed.
 */
export function productLine(
  product: SocialProductRow,
  currencyPrefix: string,
  listPrice?: number,
): string {
  const name = cleanName(product.name);
  const now = `${currencyPrefix} ${toPrice(product.salePrice)}`;
  if (typeof listPrice === "number" && Number.isFinite(listPrice) && listPrice > product.salePrice) {
    return `${name} - ~${currencyPrefix} ${toPrice(listPrice)}~ ${now}`;
  }
  return `${name} - ${now}`;
}

/**
 * Short human phrasing of an offer's discount, e.g. "10% off" or "Rs. 250 off".
 * Takes only the two fields it reads, so a pricing rule can be passed as well as a stored doc.
 */
export function describeOffer(
  offer: Pick<SocialOfferDoc, "discount_type" | "discount_value">,
  currencyPrefix: string,
): string {
  if (offer.discount_type === "percent") {
    return `${toPrice(offer.discount_value)}% off`;
  }
  if (offer.discount_type === "flat") {
    return `${currencyPrefix} ${toPrice(offer.discount_value)} off`;
  }
  return "";
}

function offerBlock(offer: SocialOfferDoc, currencyPrefix: string): string[] {
  const discount = describeOffer(offer, currencyPrefix);
  const heading = discount ? `${offer.title.trim()} — ${discount}` : offer.title.trim();
  const lines = [heading];
  const description = offer.description?.trim();
  if (description) {
    lines.push(description);
  }
  if (offer.ends_on) {
    lines.push(`Valid till ${offer.ends_on}`);
  }
  return lines;
}

export type BuildCaptionInput = {
  products: SocialProductRow[];
  offer?: SocialOfferDoc | null;
  /** Optional lead-in above the product list, e.g. "New arrival today". */
  headline?: string;
  currencyPrefix: string;
  footerLine: string;
  /**
   * Effective prices for products under a live offer, keyed by product id. When a product
   * appears here its caption line shows the old price struck through. Omit for plain pricing.
   */
  offerPricesById?: Map<string, { effectivePrice: number; listPrice: number }>;
};

/**
 * Compose the WhatsApp message. Blocks are separated by a blank line; empty blocks
 * are dropped so a post with no offer does not end up with a double gap.
 */
export function buildCaption({
  products,
  offer,
  headline,
  currencyPrefix,
  footerLine,
  offerPricesById,
}: BuildCaptionInput): string {
  const blocks: string[][] = [];

  const trimmedHeadline = headline?.trim();
  if (trimmedHeadline) {
    blocks.push([trimmedHeadline]);
  }
  if (products.length > 0) {
    blocks.push(
      products.map((product) => {
        const priced = offerPricesById?.get(product.id);
        if (!priced) return productLine(product, currencyPrefix);
        return productLine(
          { ...product, salePrice: priced.effectivePrice },
          currencyPrefix,
          priced.listPrice,
        );
      }),
    );
  }
  if (offer) {
    blocks.push(offerBlock(offer, currencyPrefix));
  }
  const trimmedFooter = footerLine.trim();
  if (trimmedFooter) {
    blocks.push([trimmedFooter]);
  }

  return blocks.map((lines) => lines.join("\n")).join("\n\n");
}

/**
 * Default headline per post kind, so a composed message does not read as anonymous. Kinds
 * with no entry here (`products`, `random`, `custom`) lead with the product list itself.
 */
export const HEADLINE_BY_KIND: Partial<Record<SocialPostKind, string>> = {
  best_sellers: "Products of the week",
  aging_stock: "Special clearance prices",
  new_arrivals: "Just arrived",
  offer: "Today's offer",
};
