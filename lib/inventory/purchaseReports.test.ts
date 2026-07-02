/**
 * Run: npm run test:purchase-reports
 */
import assert from "node:assert/strict";
import {
  aggregatePurchasesByDay,
  aggregatePurchasesByMonth,
  aggregatePurchasesByTrader,
  aggregatePurchasesByWeek,
  aggregateStockInByProductForPeriod,
  computePurchaseKpis,
  filterPurchaseLotsByRange,
  filterStockInLotsInPeriod,
  UNLINKED_TRADER_KEY,
  UNLINKED_TRADER_LABEL,
  type PurchaseLotInput,
  type StockInDetailLotInput,
} from "./purchaseReports.ts";
import { buildTraderLookup } from "./traderLookup.ts";

function ts(date: Date): { toDate(): Date } {
  return { toDate: () => date };
}

const traders = buildTraderLookup([
  { id: "t-hall", name: "Hall Road", city: "Lahore", phone: "0300" },
  { id: "t-other", name: "Other Market" },
]);

const lots: PurchaseLotInput[] = [
  {
    source: "stock_in",
    qty_in: 10,
    unit_cost: 100,
    purchase_source: "Hall Road",
    trader_id: "t-hall",
    received_at: ts(new Date(2026, 5, 9, 14, 30)),
  },
  {
    source: "stock_in",
    qty_in: 5,
    unit_cost: 50,
    purchase_source: "Hall Road",
    trader_id: "t-hall",
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
    trader_id: "t-other",
    received_at: ts(new Date(2026, 4, 1)),
  },
];

const byTrader = aggregatePurchasesByTrader(lots, traders);
const hallRoad = byTrader.find((r) => r.key === "t-hall");
assert.ok(hallRoad);
assert.equal(hallRoad.label, "Hall Road");
assert.equal(hallRoad.city, "Lahore");
assert.equal(hallRoad.totalQty, 15);
assert.equal(hallRoad.totalValue, 1250);
assert.equal(hallRoad.receiptCount, 2);

const unlinked = byTrader.find((r) => r.key === UNLINKED_TRADER_KEY);
assert.ok(unlinked);
assert.equal(unlinked.label, UNLINKED_TRADER_LABEL);
assert.equal(unlinked.totalQty, 3);
assert.equal(unlinked.totalValue, 60);

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

const byWeek = aggregatePurchasesByWeek(lots);
assert.ok(byWeek.some((r) => r.totalQty === 18));

const byMonth = aggregatePurchasesByMonth(lots);
const june2026 = byMonth.find((r) => r.key === "2026-06");
assert.ok(june2026);
assert.equal(june2026.totalQty, 18);

const todayOnly = filterStockInLotsInPeriod(
  lots,
  new Date(2026, 5, 9),
  new Date(2026, 5, 9),
);
assert.equal(todayOnly.length, 2);

const detailLots: StockInDetailLotInput[] = [
  {
    product_id: "rice",
    source: "stock_in",
    qty_in: 10,
    unit_cost: 100,
    received_at: ts(new Date(2026, 5, 9, 14, 30)),
  },
  {
    product_id: "rice",
    source: "stock_in",
    qty_in: 5,
    unit_cost: 50,
    received_at: ts(new Date(2026, 5, 9, 16, 0)),
  },
  {
    product_id: "oil",
    source: "stock_in",
    qty_in: 3,
    unit_cost: 20,
    received_at: ts(new Date(2026, 5, 9, 12, 0)),
  },
];

const june9Products = aggregateStockInByProductForPeriod(detailLots, "2026-06-09", "day");
assert.equal(june9Products.length, 2);
const riceLine = june9Products.find((r) => r.productId === "rice");
assert.ok(riceLine);
assert.equal(riceLine.totalQty, 15);
assert.equal(riceLine.receiptCount, 2);

console.log("purchaseReports tests passed");
