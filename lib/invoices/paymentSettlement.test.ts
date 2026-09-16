/**
 * Run: npm run test:payment-settlement
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeSettlementOffer,
  MAX_INVOICE_SETTLEMENT,
} from "./paymentSettlement.ts";

test("the counter case: 1,600 paid on a 1,630 bill offers to settle 30", () => {
  const offer = describeSettlementOffer(1630, 1600);
  assert.deepEqual(offer, { remainder: 30, canSettle: true, overCap: false, maxSettlement: 100 });
});

test("a remainder above the cap stays due", () => {
  const offer = describeSettlementOffer(1630, 1400);
  assert.equal(offer.remainder, 230);
  assert.equal(offer.canSettle, false);
  assert.equal(offer.overCap, true);
});

test("the cap itself can be settled, a paisa more cannot", () => {
  assert.equal(describeSettlementOffer(1000, 1000 - MAX_INVOICE_SETTLEMENT).canSettle, true);
  assert.equal(describeSettlementOffer(1000, 1000 - MAX_INVOICE_SETTLEMENT - 0.02).canSettle, false);
});

test("paying the bill in full offers nothing", () => {
  assert.deepEqual(describeSettlementOffer(1630, 1630), {
    remainder: 0,
    canSettle: false,
    overCap: false,
    maxSettlement: 100,
  });
});

test("a leftover of a paisa counts as settled already, so nothing is offered", () => {
  assert.equal(describeSettlementOffer(1630, 1629.99).canSettle, false);
});

test("an overpayment offers nothing — it is refused elsewhere", () => {
  const offer = describeSettlementOffer(1630, 1650);
  assert.equal(offer.canSettle, false);
  assert.equal(offer.remainder, 0);
});

test("a zero or negative payment offers nothing", () => {
  for (const payment of [0, -50, Number.NaN]) {
    assert.equal(describeSettlementOffer(1630, payment).canSettle, false, String(payment));
  }
});

test("a custom cap is honoured and reported back", () => {
  const offer = describeSettlementOffer(1630, 1600, 20);
  assert.equal(offer.canSettle, false);
  assert.equal(offer.overCap, true);
  assert.equal(offer.maxSettlement, 20);
});

test("works in paisa, not just round rupees", () => {
  const offer = describeSettlementOffer(1630.75, 1600.5);
  assert.equal(offer.remainder, 30.25);
  assert.equal(offer.canSettle, true);
});
