/**
 * Run: npm run test:purchase-reports
 */
import assert from "node:assert/strict";
import {
  aggregatePurchasesByDay,
  aggregatePurchasesByShop,
  computePurchaseKpis,
  filterPurchaseLotsByRange,
  UNSPECIFIED_PURCHASE_SOURCE,
  type PurchaseLotInput,
} from "./purchaseReports.ts";

function ts(date: Date): { toDate(): Date } {
  return { toDate: () => date };
}

const lots: PurchaseLotInput[] = [
  {
    source: "stock_in",
    qty_in: 10,
    unit_cost: 100,
    purchase_source: "Hall Road",
    received_at: ts(new Date(2026, 5, 9, 14, 30)),
  },
  {
    source: "stock_in",
    qty_in: 5,
    unit_cost: 50,
    purchase_source: "Hall Road",
    received_at: ts(new Date(2026, 5, 9, 16, 0)),
  },
  {
    source: "stock_in",
    qty_in: 3,
    unit_cost: 20,
    received_at: ts(new Date(2026, 5, 8, 10, 0)),
  },
  {
    source: "opening_balance",
    qty_in: 100,
    unit_cost: 1,
    received_at: ts(new Date(2026, 0, 1)),
  },
  {
    source: "stock_in",
    qty_in: 2,
    unit_cost: 10,
    purchase_source: "Other Market",
    received_at: ts(new Date(2026, 4, 1)),
  },
];

const byShop = aggregatePurchasesByShop(lots);
const hallRoad = byShop.find((r) => r.key === "Hall Road");
assert.ok(hallRoad);
assert.equal(hallRoad.totalQty, 15);
assert.equal(hallRoad.totalValue, 1250);
assert.equal(hallRoad.receiptCount, 2);

const unspecified = byShop.find((r) => r.key === UNSPECIFIED_PURCHASE_SOURCE);
assert.ok(unspecified);
assert.equal(unspecified.totalQty, 3);
assert.equal(unspecified.totalValue, 60);

const byDay = aggregatePurchasesByDay(lots);
const june9 = byDay.find((r) => r.key === "2026-06-09");
assert.ok(june9);
assert.equal(june9.totalQty, 15);
assert.equal(june9.totalValue, 1250);
assert.equal(june9.receiptCount, 2);

const kpis = computePurchaseKpis(lots);
assert.equal(kpis.totalQty, 20);
assert.equal(kpis.totalValue, 1330);
assert.equal(kpis.receiptCount, 4);

const filtered = filterPurchaseLotsByRange(lots, "7", new Date(2026, 5, 9));
assert.equal(filtered.length, 3);

const filtered30 = filterPurchaseLotsByRange(lots, "30", new Date(2026, 5, 9));
assert.equal(filtered30.length, 3);

console.log("purchaseReports tests passed");
