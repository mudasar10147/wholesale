/**
 * Run: npm run test:product-purchase-stats
 */
import assert from "node:assert/strict";
import {
  computeProductPurchaseStats,
  type ProductPurchaseLotInput,
} from "./productPurchaseStats.ts";
import { buildTraderLookup, UNLINKED_TRADER_LABEL } from "./traderLookup.ts";

const traders = buildTraderLookup([{ id: "t-hall", name: "Hall Road" }]);

const lots: ProductPurchaseLotInput[] = [
  {
    source: "stock_in",
    qty_in: 5,
    unit_cost: 10,
    received_at: { toDate: () => new Date(2026, 0, 2) },
  },
  {
    source: "stock_in",
    qty_in: 10,
    unit_cost: 100,
    purchase_source: "Hall Road",
    trader_id: "t-hall",
    received_at: { toDate: () => new Date(2026, 0, 1) },
  },
  {
    source: "opening_balance",
    qty_in: 50,
    unit_cost: 1,
    received_at: { toDate: () => new Date(2025, 11, 1) },
  },
];

const stats = computeProductPurchaseStats(lots, traders);
assert.equal(stats.totalUnitsPurchased, 15);
assert.equal(stats.totalPurchaseValue, 1050);
assert.equal(stats.receiptCount, 2);
assert.equal(stats.recentReceipts.length, 2);
assert.equal(stats.recentReceipts[0].traderName, UNLINKED_TRADER_LABEL);
assert.equal(stats.recentReceipts[0].qty, 5);
assert.equal(stats.recentReceipts[1].traderName, "Hall Road");
assert.equal(stats.recentReceipts[1].traderId, "t-hall");
assert.equal(stats.recentReceipts[1].value, 1000);

const capped = computeProductPurchaseStats(lots, traders, 1);
assert.equal(capped.recentReceipts.length, 1);

const empty = computeProductPurchaseStats([], traders);
assert.equal(empty.totalUnitsPurchased, 0);
assert.equal(empty.receiptCount, 0);
assert.equal(empty.recentReceipts.length, 0);

console.log("productPurchaseStats tests passed");
