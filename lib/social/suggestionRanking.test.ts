import assert from "node:assert/strict";
import test from "node:test";
import {
  netUnitsByProduct,
  rankAgingStock,
  rankBestSellers,
  rankNewArrivals,
  rankOverstock,
  type LotLine,
  type SaleLine,
  type SuggestionProduct,
} from "./suggestionRanking.ts";

const NOW = new Date("2026-07-12T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function product(id: string, overrides: Partial<SuggestionProduct> = {}): SuggestionProduct {
  return {
    id,
    name: id,
    salePrice: 100,
    stockQuantity: 10,
    createdAt: daysAgo(200),
    ...overrides,
  };
}

function sale(productId: string, quantity: number, isReturn = false): SaleLine {
  return { productId, quantity, isReturn };
}

function lot(productId: string, overrides: Partial<LotLine> = {}): LotLine {
  return {
    productId,
    qtyRemaining: 5,
    receivedAt: daysAgo(10),
    isStockIn: true,
    ...overrides,
  };
}

test("returns subtract units — a return row stores a POSITIVE quantity", () => {
  // The trap: sales and returns both write quantity: 5. Summing naively gives 10.
  const units = netUnitsByProduct([sale("a", 5), sale("a", 5, true)]);
  assert.equal(units.get("a"), 0);
});

test("a heavily-returned product does not rank as a best seller", () => {
  const products = [product("returned"), product("solid")];
  const sales = [
    sale("returned", 50),
    sale("returned", 48, true),
    sale("solid", 20),
  ];

  const ranked = rankBestSellers(products, sales, 30);

  assert.deepEqual(
    ranked.map((row) => row.id),
    ["solid", "returned"],
  );
  assert.equal(ranked[0]?.metricLabel, "20 sold in 30d");
  assert.equal(ranked[1]?.metricValue, 2);
});

test("best sellers exclude products that net zero or fewer units", () => {
  const sales = [sale("a", 3), sale("a", 3, true), sale("b", 1)];
  const ranked = rankBestSellers([product("a"), product("b")], sales, 7);
  assert.deepEqual(ranked.map((row) => row.id), ["b"]);
});

test("aging stock lists in-stock products with no sale, oldest lot first", () => {
  const products = [product("old"), product("fresh"), product("selling")];
  const sales = [sale("selling", 4)];
  const lots = [
    lot("old", { receivedAt: daysAgo(120) }),
    lot("old", { receivedAt: daysAgo(200), qtyRemaining: 0 }), // fully sold, must be ignored
    lot("fresh", { receivedAt: daysAgo(9) }),
    lot("selling", { receivedAt: daysAgo(300) }),
  ];

  const ranked = rankAgingStock(products, sales, lots, 30, NOW);

  assert.deepEqual(ranked.map((row) => row.id), ["old", "fresh"]);
  assert.equal(ranked[0]?.metricValue, 120);
  assert.equal(ranked[0]?.metricLabel, "120 days in stock, no sale in 30d");
});

test("aging stock ignores products with no stock on hand", () => {
  const products = [product("empty", { stockQuantity: 0 })];
  const ranked = rankAgingStock(products, [], [lot("empty", { receivedAt: daysAgo(90) })], 30, NOW);
  assert.deepEqual(ranked, []);
});

test("aging stock falls back to the product's own age when it has no lot on file", () => {
  const products = [product("legacy", { createdAt: daysAgo(75) })];
  const ranked = rankAgingStock(products, [], [], 30, NOW);
  assert.equal(ranked[0]?.metricValue, 75);
});

test("new arrivals rank by created_at and ignore restocking", () => {
  const products = [
    product("restocked", { createdAt: daysAgo(400) }),
    product("brand-new", { createdAt: daysAgo(2) }),
  ];

  const ranked = rankNewArrivals(products, 30, NOW);

  // A 400-day-old SKU is never a new arrival, no matter how recently it was restocked.
  assert.deepEqual(ranked.map((row) => row.id), ["brand-new"]);
  assert.equal(ranked[0]?.metricLabel, "Added 2 days ago");
});

test("new arrivals exclude products created before the window", () => {
  const products = [product("stale", { createdAt: daysAgo(60) })];
  assert.deepEqual(rankNewArrivals(products, 30, NOW), []);
});

test("new arrivals exclude products with no creation date", () => {
  const products = [product("legacy", { createdAt: null })];
  assert.deepEqual(rankNewArrivals(products, 30, NOW), []);
});

test("overstock ranks by weeks of cover and excludes products with zero sales", () => {
  const products = [
    product("slow", { stockQuantity: 400 }), // 400 on hand, ~1/week
    product("brisk", { stockQuantity: 40 }), // 40 on hand, ~10/week
    product("dead", { stockQuantity: 900 }), // no sales at all
  ];
  const sales = [sale("slow", 4), sale("brisk", 40)];

  const ranked = rankOverstock(products, sales, 28);

  // "dead" belongs to the aging lens; including it here would swamp the list.
  assert.deepEqual(ranked.map((row) => row.id), ["slow", "brisk"]);
  assert.equal(ranked[0]?.metricLabel, "400 weeks of stock left at current pace");
  assert.equal(ranked[1]?.metricLabel, "4 weeks of stock left at current pace");
});

test("suggestion rows never carry cost, customer, or supplier fields", () => {
  const ranked = rankBestSellers([product("a")], [sale("a", 5)], 30);
  const keys = Object.keys(ranked[0] ?? {});
  for (const leaked of ["cost_price", "costPrice", "unit_cost", "customer_id", "trader_id"]) {
    assert.ok(!keys.includes(leaked), `SuggestionRow must not expose ${leaked}`);
  }
});
