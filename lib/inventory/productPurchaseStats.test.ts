/**
 * Run: npm run test:product-purchase-stats
 */
import assert from "node:assert/strict";
import {
  computeProductPurchaseStats,
  type ProductPurchaseLotInput,
} from "./productPurchaseStats.ts";
import { UNSPECIFIED_PURCHASE_SOURCE } from "./purchaseReports.ts";

function ts(date: Date): { toDate(): Date } {
  return { toDate: () => date };
}

const lots: ProductPurchaseLotInput[] = [
  {
    source: "stock_in",
    qty_in: 10,
    unit_cost: 100,
    purchase_source: "Hall Road",
    received_at: ts(new Date(2026, 5, 9)),
  },
  {
    source: "stock_in",
    qty_in: 5,
    unit_cost: 50,
    received_at: ts(new Date(2026, 5, 11)),
  },
  {
    source: "opening_balance",
    qty_in: 100,
    unit_cost: 10,
    received_at: ts(new Date(2026, 4, 1)),
  },
  {
    source: "adjustment",
    qty_in: 7,
    unit_cost: 5,
    received_at: ts(new Date(2026, 5, 1)),
  },
];

const stats = computeProductPurchaseStats(lots);

// Only stock_in lots count toward purchases.
assert.equal(stats.totalUnitsPurchased, 15);
assert.equal(stats.totalPurchaseValue, 10 * 100 + 5 * 50);
assert.equal(stats.receiptCount, 2);

// Receipts sorted newest first; missing purchase_source falls back to Unspecified.
assert.equal(stats.recentReceipts.length, 2);
assert.equal(stats.recentReceipts[0].source, UNSPECIFIED_PURCHASE_SOURCE);
assert.equal(stats.recentReceipts[0].qty, 5);
assert.equal(stats.recentReceipts[1].source, "Hall Road");
assert.equal(stats.recentReceipts[1].value, 1000);

// recentLimit caps the receipt list without affecting totals.
const capped = computeProductPurchaseStats(lots, 1);
assert.equal(capped.recentReceipts.length, 1);
assert.equal(capped.totalUnitsPurchased, 15);

// Empty input is handled.
const empty = computeProductPurchaseStats([]);
assert.equal(empty.totalUnitsPurchased, 0);
assert.equal(empty.receiptCount, 0);
assert.equal(empty.recentReceipts.length, 0);

console.log("productPurchaseStats tests passed");
