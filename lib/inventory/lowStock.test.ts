/**
 * Run: npm run test:low-stock
 */
import assert from "node:assert/strict";
import {
  applyLowStockListFilters,
  computeLowStockKpis,
  filterLowStockProducts,
  normalizeThreshold,
  parseThresholdFromUrl,
  type LowStockProductInput,
} from "./lowStock.ts";

const sampleProducts: LowStockProductInput[] = [
  {
    id: "a",
    name: "Apple",
    category: "Fruit",
    stock_quantity: 0,
    cost_price: 10,
    sale_price: 15,
  },
  {
    id: "b",
    name: "Banana",
    category: "Fruit",
    stock_quantity: 3,
    cost_price: 5,
    sale_price: 8,
  },
  {
    id: "c",
    name: "Carrot",
    category: "Veg",
    stock_quantity: 7,
    cost_price: 2,
    sale_price: 4,
  },
  {
    id: "d",
    name: "Dates",
    category: "Fruit",
    stock_quantity: 12,
    cost_price: 20,
    sale_price: 30,
  },
];

assert.equal(normalizeThreshold(-3), 0);
assert.equal(normalizeThreshold(5.9), 5);
assert.equal(parseThresholdFromUrl(null), 5);
assert.equal(parseThresholdFromUrl("10"), 10);
assert.equal(parseThresholdFromUrl("bad"), 5);

const atFive = filterLowStockProducts(sampleProducts, 5);
assert.equal(atFive.length, 2);
assert.equal(atFive[0]?.id, "a");
assert.equal(atFive[1]?.id, "b");

const atTen = filterLowStockProducts(sampleProducts, 10);
assert.equal(atTen.length, 3);
assert.deepEqual(
  atTen.map((row) => row.id),
  ["a", "b", "c"],
);

const outOfStockOnly = filterLowStockProducts(sampleProducts, 10, {
  status: "out_of_stock",
});
assert.equal(outOfStockOnly.length, 1);
assert.equal(outOfStockOnly[0]?.status, "out_of_stock");

const needReorderOnly = filterLowStockProducts(sampleProducts, 10, {
  status: "need_reorder",
});
assert.equal(needReorderOnly.length, 2);
assert.equal(needReorderOnly.every((row) => row.status === "need_reorder"), true);

const searchFiltered = applyLowStockListFilters(atTen, {
  search: "car",
  category: "",
  status: "all",
});
assert.equal(searchFiltered.length, 1);
assert.equal(searchFiltered[0]?.name, "Carrot");

const kpis = computeLowStockKpis(atFive);
assert.equal(kpis.matchingCount, 2);
assert.equal(kpis.outOfStockCount, 1);
assert.equal(kpis.reorderCount, 1);
assert.equal(kpis.totalUnitsAtRisk, 3);
assert.equal(kpis.totalValueAtCost, 15);

console.log("lowStock tests passed");
