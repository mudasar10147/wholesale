/**
 * Run: npm run test:pricing
 *
 * The invoice seam. Two of these matter more than the rest: the regression guard proving
 * nothing changed when no offer is live (the overwhelming majority of every invoice ever
 * written), and the end-to-end check proving a discounted line actually survives the
 * arithmetic identity in firestore.rules — i.e. that the invoice can be saved at all.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { offerDiscountForQuantity, seedLineForProduct } from "@/lib/invoices/lineSeed";
import { calculateInvoiceSummary } from "@/lib/invoices/calculations";
import { parseNonNegativeDecimal } from "@/lib/validation/numbers";
import type { OfferPricingRule } from "@/lib/pricing/offerPricing";

const THRESHOLD = 14;
const NOW = new Date("2026-08-15T12:00:00Z");
const OLD_PRODUCT = new Date("2025-01-01T00:00:00Z").getTime();

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

const PRODUCT = { id: "p1", salePrice: 1500, createdAt: OLD_PRODUCT };

test("an unknown product seeds nothing, so the clerk keeps what they typed", () => {
  assert.equal(seedLineForProduct(undefined, [], THRESHOLD, NOW), null);
  assert.equal(
    seedLineForProduct({ id: "p1", salePrice: Number.NaN }, [], THRESHOLD, NOW),
    null,
  );
});

test("with no live offer the seeded price is exactly String(sale_price), as before", () => {
  const seeded = seedLineForProduct(PRODUCT, [], THRESHOLD, NOW);
  assert.equal(seeded?.unitPrice, "1500");
  assert.equal(seeded?.unitPrice, String(PRODUCT.salePrice));
  assert.notEqual(seeded?.unitPrice, "1500.00");
  assert.equal(seeded?.offerDiscountPerUnit, 0);
  assert.equal(seeded?.offerLabel, null);
});

test("a live offer keeps the list price and returns the saving separately", () => {
  const seeded = seedLineForProduct(PRODUCT, [offer({ discount_value: 10 })], THRESHOLD, NOW);
  // The customer must see the list price on the receipt, with the discount below it.
  assert.equal(seeded?.unitPrice, "1500");
  assert.equal(seeded?.offerDiscountPerUnit, 150);
  assert.equal(seeded?.offerLabel, "Week Clearance");
});

test("an offer that does not cover the product leaves it alone", () => {
  const seeded = seedLineForProduct(PRODUCT, [offer({ product_ids: ["other"] })], THRESHOLD, NOW);
  assert.equal(seeded?.offerDiscountPerUnit, 0);
  assert.equal(seeded?.offerLabel, null);
});

test("the line discount scales with quantity and rounds to cents", () => {
  assert.equal(offerDiscountForQuantity(104.93, 7), 734.51);
  assert.equal(offerDiscountForQuantity(150, 10), 1500);
  assert.equal(offerDiscountForQuantity(0, 10), 0);
  assert.equal(offerDiscountForQuantity(10, 0), 0);
  assert.equal(offerDiscountForQuantity(Number.NaN, 5), 0);
});

test("a discounted line survives the arithmetic identity firestore.rules enforces", () => {
  // 999 @ 33% is a repeating decimal — the shape most likely to drift past the ±0.05 band.
  const seeded = seedLineForProduct(
    { id: "p1", salePrice: 999, createdAt: OLD_PRODUCT },
    [offer({ discount_value: 33 })],
    THRESHOLD,
    NOW,
  );
  assert.ok(seeded);

  const parsed = parseNonNegativeDecimal(seeded.unitPrice);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.ok);

  const quantity = 7;
  const offerDiscount = offerDiscountForQuantity(seeded.offerDiscountPerUnit, quantity);
  const summary = calculateInvoiceSummary({
    lines: [
      {
        product_id: "p1",
        quantity,
        unit_price: parsed.value,
        line_discount: 0,
        offer_discount: offerDiscount,
      },
    ],
    delivery_charge: 120,
    discount_amount: 0,
  });

  const line = summary.lines[0]!;
  const identity =
    line.quantity * line.unit_price -
    line.line_discount -
    line.offer_discount +
    line.line_delivery_charge;
  // approxMoneyEq in firestore.rules is a ±0.05 band.
  assert.ok(
    Math.abs(line.line_total - identity) <= 0.05,
    `line_total ${line.line_total} vs identity ${identity}`,
  );
  // The customer pays the offer price on every unit.
  assert.equal(line.unit_price, 999);
  assert.equal(offerDiscount, 2307.69);
});

test("a clerk's own discount stacks on top of the offer's", () => {
  const summary = calculateInvoiceSummary({
    lines: [
      {
        product_id: "p1",
        quantity: 10,
        unit_price: 1500,
        line_discount: 500,
        offer_discount: 1500,
      },
    ],
    delivery_charge: 0,
    discount_amount: 0,
  });
  // 15000 - 500 (clerk) - 1500 (offer) = 13000
  assert.equal(summary.subtotal_amount, 13000);
  assert.equal(summary.lines[0]!.line_total, 13000);
});

test("offer plus manual discount can never drive a line negative", () => {
  const summary = calculateInvoiceSummary({
    lines: [
      {
        product_id: "p1",
        quantity: 1,
        unit_price: 100,
        line_discount: 90,
        offer_discount: 50,
      },
    ],
    delivery_charge: 0,
    discount_amount: 0,
  });
  assert.equal(summary.lines[0]!.line_total, 0);
  assert.ok(summary.subtotal_amount >= 0);
});

test("a line with no offer_discount behaves exactly as it did before the field existed", () => {
  const summary = calculateInvoiceSummary({
    lines: [{ product_id: "p1", quantity: 3, unit_price: 250, line_discount: 50 }],
    delivery_charge: 0,
    discount_amount: 0,
  });
  assert.equal(summary.lines[0]!.line_total, 700);
  assert.equal(summary.lines[0]!.offer_discount, 0);
});
