/**
 * Run: npm run test:pricing
 *
 * This is money code. An offer resolving wrong changes what a customer is charged, silently
 * and everywhere at once, so the edges get pinned hard: floors, clamps, garbage inputs, and
 * every combination of the sitewide / exclusion / new-arrival rules.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOfferPriceIndex,
  isOfferLive,
  formatOfferPriceCell,
  noOfferPrice,
  resolveOfferPrice,
  selectLiveOffers,
  type OfferPricingProduct,
  type OfferPricingRule,
} from "@/lib/pricing/offerPricing";

const THRESHOLD = 14;
const NOW = new Date("2026-08-15T12:00:00Z");
const OLD_PRODUCT = new Date("2025-01-01T00:00:00Z").getTime();
const NEW_PRODUCT = new Date("2026-08-10T00:00:00Z").getTime();

function offer(over: Partial<OfferPricingRule> = {}): OfferPricingRule {
  return {
    id: "o1",
    title: "Week Clearance",
    discount_type: "percent",
    discount_value: 7,
    product_ids: ["p1"],
    starts_on: "2026-08-01",
    ends_on: "2026-08-31",
    is_active: true,
    ...over,
  };
}

function product(over: Partial<OfferPricingProduct> = {}): OfferPricingProduct {
  return { id: "p1", salePrice: 1499, createdAt: OLD_PRODUCT, ...over };
}

function price(p: OfferPricingProduct, offers: OfferPricingRule[]) {
  return resolveOfferPrice(p, offers, THRESHOLD, NOW);
}

// ── The degradation guarantee ────────────────────────────────────────────────
// Every surface falls back to this when offers are unreadable or none are live. If this
// breaks, the app shows wrong prices to everyone, not just during a sale.

test("no live offers leaves the list price completely untouched", () => {
  const result = price(product(), []);
  assert.equal(result.effectivePrice, 1499);
  assert.equal(result.listPrice, 1499);
  assert.equal(result.savings, 0);
  assert.equal(result.offer, null);
  assert.equal(result.percentOff, null);
});

test("noOfferPrice matches the empty-offers result exactly", () => {
  assert.deepEqual(noOfferPrice(1499), price(product(), []));
});

// ── Arithmetic ───────────────────────────────────────────────────────────────

test("a percent offer prices to the cent", () => {
  const result = price(product(), [offer({ discount_value: 7 })]);
  assert.equal(result.effectivePrice, 1394.07);
  assert.equal(result.savings, 104.93);
  assert.equal(result.percentOff, 7);
  // Must be whole cents, or the rules' line_total identity drifts on large quantities.
  assert.ok(Number.isInteger(Math.round(result.effectivePrice * 100)));
  assert.equal(result.effectivePrice * 100, Math.round(result.effectivePrice * 100));
});

test("a flat offer subtracts a currency amount", () => {
  const result = price(product(), [offer({ discount_type: "flat", discount_value: 250 })]);
  assert.equal(result.effectivePrice, 1249);
  assert.equal(result.savings, 250);
});

test("a flat discount larger than the price floors at zero, never negative", () => {
  const result = price(product(), [offer({ discount_type: "flat", discount_value: 5000 })]);
  assert.equal(result.effectivePrice, 0);
  assert.ok(result.effectivePrice >= 0);
  assert.equal(result.savings, 1499);
  assert.equal(result.percentOff, 100);
});

test("100% off is zero, and a nonsense 150% is clamped to zero rather than negative", () => {
  assert.equal(price(product(), [offer({ discount_value: 100 })]).effectivePrice, 0);
  const overshoot = price(product(), [offer({ discount_value: 150 })]);
  assert.equal(overshoot.effectivePrice, 0);
  assert.ok(overshoot.effectivePrice >= 0);
});

test("garbage discount values are treated as no discount at all", () => {
  for (const bad of [Number.NaN, -10, Number.POSITIVE_INFINITY]) {
    const result = price(product(), [offer({ discount_value: bad })]);
    assert.equal(result.effectivePrice, 1499, `discount_value ${String(bad)}`);
    assert.equal(result.offer, null);
  }
});

test("a repeating decimal still lands on whole cents", () => {
  const result = price(product({ salePrice: 999 }), [offer({ discount_value: 33 })]);
  assert.equal(result.effectivePrice, 669.33);
  assert.equal(Math.round(result.effectivePrice * 100), 66933);
});

test("percentOff is derived, so a flat offer also reads as a percentage", () => {
  const result = price(product({ salePrice: 1000 }), [
    offer({ discount_type: "flat", discount_value: 250 }),
  ]);
  assert.equal(result.percentOff, 25);
});

test("a broken list price yields zero without dividing by zero", () => {
  for (const bad of [0, -5, Number.NaN]) {
    const result = price(product({ salePrice: bad }), [offer()]);
    assert.equal(result.effectivePrice, 0, `salePrice ${String(bad)}`);
    assert.equal(result.offer, null);
    assert.equal(result.percentOff, null);
  }
});

// ── 'none' offers are decoration and must stay inert ─────────────────────────

test("a 'none' offer never wins", () => {
  const result = price(product(), [offer({ discount_type: "none", discount_value: 0 })]);
  assert.equal(result.effectivePrice, 1499);
  assert.equal(result.offer, null);
});

test("a live 'none' offer does not suppress a real discount beside it", () => {
  const result = price(product(), [
    offer({ id: "greeting", discount_type: "none", discount_value: 0 }),
    offer({ id: "real", discount_value: 10 }),
  ]);
  assert.equal(result.effectivePrice, 1349.1);
  assert.equal(result.offer?.id, "real");
});

// ── Overlap: best deal for the customer ──────────────────────────────────────

test("the cheaper of two live offers wins, whichever order they arrive in", () => {
  const cheap = offer({ id: "cheap", discount_value: 20 });
  const dear = offer({ id: "dear", discount_value: 5 });

  assert.equal(price(product(), [cheap, dear]).offer?.id, "cheap");
  assert.equal(price(product(), [dear, cheap]).offer?.id, "cheap");
  assert.equal(price(product(), [dear, cheap]).effectivePrice, 1199.2);
});

test("percent and flat compete directly with no type precedence", () => {
  const pct = offer({ id: "pct", discount_value: 10 }); // -149.90
  const flat = offer({ id: "flat", discount_type: "flat", discount_value: 400 });
  assert.equal(price(product(), [pct, flat]).offer?.id, "flat");
});

test("an exact tie resolves deterministically to the first offer", () => {
  const a = offer({ id: "a", discount_value: 10 });
  const b = offer({ id: "b", discount_value: 10 });
  assert.equal(price(product(), [a, b]).offer?.id, "a");
  assert.equal(price(product(), [b, a]).offer?.id, "b");
  assert.equal(price(product(), [a, b]).effectivePrice, price(product(), [b, a]).effectivePrice);
});

// ── Sitewide offers, exclusions, and new arrivals ────────────────────────────

test("a sitewide offer covers a product it never names", () => {
  const sale = offer({ id: "azadi", applies_to_all: true, product_ids: [], discount_value: 10 });
  const result = price(product({ id: "never-mentioned" }), [sale]);
  assert.equal(result.effectivePrice, 1349.1);
  assert.equal(result.offer?.id, "azadi");
});

test("in sitewide mode the product list EXCLUDES — a listed product pays full price", () => {
  const sale = offer({ id: "azadi", applies_to_all: true, product_ids: ["p1"], discount_value: 10 });
  assert.equal(price(product({ id: "p1" }), [sale]).effectivePrice, 1499);
  assert.equal(price(product({ id: "p1" }), [sale]).offer, null);
  assert.equal(price(product({ id: "p2" }), [sale]).effectivePrice, 1349.1);
});

test("a sitewide offer skips new arrivals by default", () => {
  const sale = offer({ id: "azadi", applies_to_all: true, product_ids: [], discount_value: 10 });
  assert.equal(price(product({ createdAt: NEW_PRODUCT }), [sale]).offer, null);
  assert.equal(price(product({ createdAt: NEW_PRODUCT }), [sale]).effectivePrice, 1499);
  assert.equal(price(product({ createdAt: OLD_PRODUCT }), [sale]).effectivePrice, 1349.1);
});

test("ticking include-new-arrivals brings them into a sitewide offer", () => {
  const sale = offer({
    id: "azadi",
    applies_to_all: true,
    includes_new_arrivals: true,
    product_ids: [],
    discount_value: 10,
  });
  assert.equal(price(product({ createdAt: NEW_PRODUCT }), [sale]).effectivePrice, 1349.1);
});

test("an exclusion beats include-new-arrivals — the list always wins", () => {
  const sale = offer({
    applies_to_all: true,
    includes_new_arrivals: true,
    product_ids: ["p1"],
    discount_value: 10,
  });
  assert.equal(price(product({ id: "p1", createdAt: NEW_PRODUCT }), [sale]).offer, null);
});

test("a normal offer ignores the new-arrival rule entirely", () => {
  const targeted = offer({ product_ids: ["p1"], discount_value: 10 });
  assert.equal(price(product({ createdAt: NEW_PRODUCT }), [targeted]).effectivePrice, 1349.1);
});

test("sitewide and specific offers compete on equal footing, both directions", () => {
  const sitewide = offer({ id: "azadi", applies_to_all: true, product_ids: [], discount_value: 10 });

  const betterSpecific = offer({ id: "clearance", product_ids: ["p1"], discount_value: 15 });
  assert.equal(price(product(), [sitewide, betterSpecific]).offer?.id, "clearance");

  const worseSpecific = offer({ id: "clearance", product_ids: ["p1"], discount_value: 5 });
  assert.equal(price(product(), [sitewide, worseSpecific]).offer?.id, "azadi");
});

test("both new flags absent behaves exactly as false", () => {
  const legacy = offer({ product_ids: ["p1"], discount_value: 10 });
  assert.equal(legacy.applies_to_all, undefined);
  assert.equal(price(product({ id: "p1" }), [legacy]).effectivePrice, 1349.1);
  assert.equal(price(product({ id: "p2" }), [legacy]).offer, null);
});

// ── The live window ──────────────────────────────────────────────────────────

test("the offer window includes both its first and last day", () => {
  const o = offer({ starts_on: "2026-08-01", ends_on: "2026-08-31" });
  assert.equal(isOfferLive(o, "2026-08-01"), true);
  assert.equal(isOfferLive(o, "2026-08-31"), true);
  assert.equal(isOfferLive(o, "2026-07-31"), false);
  assert.equal(isOfferLive(o, "2026-09-01"), false);
});

test("an inactive offer is never live, even mid-window", () => {
  assert.equal(isOfferLive(offer({ is_active: false }), "2026-08-15"), false);
});

test("selectLiveOffers keeps only what is running, in order", () => {
  const live = offer({ id: "live" });
  const expired = offer({ id: "expired", starts_on: "2026-01-01", ends_on: "2026-01-31" });
  const paused = offer({ id: "paused", is_active: false });
  assert.deepEqual(
    selectLiveOffers([expired, live, paused], "2026-08-15").map((o) => o.id),
    ["live"],
  );
});

// ── The index must agree with the direct path, always ────────────────────────

test("buildOfferPriceIndex returns identical answers to resolveOfferPrice", () => {
  const offers = [
    offer({ id: "azadi", applies_to_all: true, product_ids: ["p3"], discount_value: 10 }),
    offer({ id: "clearance", product_ids: ["p1", "p2"], discount_value: 15 }),
    offer({ id: "flat", discount_type: "flat", product_ids: ["p2"], discount_value: 400 }),
    offer({ id: "greeting", discount_type: "none", discount_value: 0, product_ids: ["p1"] }),
  ];
  const index = buildOfferPriceIndex(offers, THRESHOLD, NOW);

  const products = [
    product({ id: "p1", salePrice: 1499 }),
    product({ id: "p2", salePrice: 1499 }),
    product({ id: "p3", salePrice: 800 }),
    product({ id: "p4", salePrice: 250 }),
    product({ id: "p5", salePrice: 999, createdAt: NEW_PRODUCT }),
    product({ id: "p6", salePrice: 0 }),
  ];

  for (const p of products) {
    assert.deepEqual(
      index.price(p),
      resolveOfferPrice(p, offers, THRESHOLD, NOW),
      `product ${p.id} disagrees between index and direct path`,
    );
  }
});

test("an empty index reports itself empty and changes no price", () => {
  const index = buildOfferPriceIndex([], THRESHOLD, NOW);
  assert.equal(index.isEmpty, true);
  assert.equal(index.price(product()).effectivePrice, 1499);
});

// ── PDF/string output ────────────────────────────────────────────────────────

test("formatOfferPriceCell is byte-identical to the plain format when nothing applies", () => {
  const fmt = (n: number) => n.toFixed(2);
  assert.equal(formatOfferPriceCell(price(product(), []), fmt), fmt(1499));
});

test("formatOfferPriceCell shows the saving when an offer applies", () => {
  const fmt = (n: number) => n.toFixed(2);
  const cell = formatOfferPriceCell(price(product(), [offer({ discount_value: 7 })]), fmt);
  assert.equal(cell, "1394.07 (was 1499.00, 7% off)");
});
