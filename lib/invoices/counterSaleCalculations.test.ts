/**
 * Run: npm run test:counter-sale
 */
import assert from "node:assert/strict";
import {
  calculateCounterSaleSummary,
  sumReturnsCredit,
} from "./counterSaleCalculations.ts";

// sale greater than returns → customer owes the difference, no refund
{
  const s = calculateCounterSaleSummary(1500, [{ line_total: 500 }, { line_total: 500 }]);
  assert.equal(s.returns_credit_amount, 1000);
  assert.equal(s.applied_credit, 1000);
  assert.equal(s.net_amount_due, 500);
  assert.equal(s.cash_refund_amount, 0);
}

// sale equals returns → fully covered, nothing owed, no refund
{
  const s = calculateCounterSaleSummary(1000, [{ line_total: 1000 }]);
  assert.equal(s.applied_credit, 1000);
  assert.equal(s.net_amount_due, 0);
  assert.equal(s.cash_refund_amount, 0);
}

// returns greater than sale → invoice covered, excess refunded in cash
{
  const s = calculateCounterSaleSummary(600, [{ line_total: 1000 }]);
  assert.equal(s.returns_credit_amount, 1000);
  assert.equal(s.applied_credit, 600);
  assert.equal(s.net_amount_due, 0);
  assert.equal(s.cash_refund_amount, 400);
}

// no returns → plain sale
{
  const s = calculateCounterSaleSummary(750, []);
  assert.equal(s.returns_credit_amount, 0);
  assert.equal(s.applied_credit, 0);
  assert.equal(s.net_amount_due, 750);
  assert.equal(s.cash_refund_amount, 0);
}

// rounding and non-finite guards
{
  assert.equal(sumReturnsCredit([{ line_total: 33.335 }, { line_total: 0.005 }]), 33.34);
  const s = calculateCounterSaleSummary(Number.NaN, [{ line_total: Number.POSITIVE_INFINITY }]);
  assert.equal(s.sale_total, 0);
  assert.equal(s.returns_credit_amount, 0);
  assert.equal(s.net_amount_due, 0);
  assert.equal(s.cash_refund_amount, 0);
}

console.log("counterSaleCalculations tests passed");
