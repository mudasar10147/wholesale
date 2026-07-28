/**
 * Run: npm run test:social
 *
 * `productLine` grew an optional third argument when offers started setting prices. The point
 * of these tests is that captions written without it are unchanged — the social manager's
 * existing posts must not shift under them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeOffer, productLine } from "./captions.ts";
import type { SocialProductRow } from "./types.ts";

const PRODUCT: SocialProductRow = { id: "p1", name: "Sugar 50kg", salePrice: 1500, stockQuantity: 4 };

test("a caption line without a list price is exactly what it always was", () => {
  assert.equal(productLine(PRODUCT, "Rs."), "Sugar 50kg - Rs. 1,500");
});

test("whitespace in a product name is still collapsed", () => {
  assert.equal(
    productLine({ ...PRODUCT, name: "  Sugar   50kg " }, "Rs."),
    "Sugar 50kg - Rs. 1,500",
  );
});

test("an offer price strikes through the old one", () => {
  assert.equal(
    productLine({ ...PRODUCT, salePrice: 1394 }, "Rs.", 1499),
    "Sugar 50kg - ~Rs. 1,499~ Rs. 1,394",
  );
});

test("a list price that is not actually higher is ignored", () => {
  assert.equal(productLine(PRODUCT, "Rs.", 1500), "Sugar 50kg - Rs. 1,500");
  assert.equal(productLine(PRODUCT, "Rs.", 900), "Sugar 50kg - Rs. 1,500");
  assert.equal(productLine(PRODUCT, "Rs.", Number.NaN), "Sugar 50kg - Rs. 1,500");
});

test("describeOffer still phrases both discount types after the signature widened", () => {
  assert.equal(describeOffer({ discount_type: "percent", discount_value: 10 }, "Rs."), "10% off");
  assert.equal(describeOffer({ discount_type: "flat", discount_value: 250 }, "Rs."), "Rs. 250 off");
  assert.equal(describeOffer({ discount_type: "none", discount_value: 0 }, "Rs."), "");
});
