/**
 * Run: npm run test:stock-summary
 *
 * Covers the archive exclusion: an archived product must vanish from every
 * headline figure while its still-real stock is reported separately, so the
 * dashboard can explain why it disagrees with the inventory validator.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeStockSummary } from "./stockSummary.ts";
import type { ProductDoc, StockLotDoc } from "../types/firestore.ts";

function product(
  id: string,
  fields: { stock: number; cost: number; sale: number; is_active?: boolean },
): { id: string; data: ProductDoc } {
  return {
    id,
    data: {
      name: id,
      cost_price: fields.cost,
      sale_price: fields.sale,
      stock_quantity: fields.stock,
      ...(fields.is_active === undefined ? {} : { is_active: fields.is_active }),
    } as ProductDoc,
  };
}

function lot(productId: string, qtyRemaining: number, unitCost: number): StockLotDoc {
  return { product_id: productId, qty_remaining: qtyRemaining, unit_cost: unitCost } as StockLotDoc;
}

test("products with no is_active field are still counted", () => {
  const summary = computeStockSummary(
    [product("legacy", { stock: 10, cost: 2, sale: 3 })],
    [lot("legacy", 10, 2)],
  );

  assert.equal(summary.productCount, 1);
  assert.equal(summary.totalUnits, 10);
  assert.equal(summary.totalValueAtLotCost, 20);
  assert.equal(summary.archivedProductCount, 0);
  assert.equal(summary.archivedValueAtLotCost, 0);
});

test("an archived product leaves units, cost and retail value", () => {
  const products = [
    product("live", { stock: 10, cost: 2, sale: 5 }),
    product("retired", { stock: 40, cost: 3, sale: 7, is_active: false }),
  ];

  const summary = computeStockSummary(products, []);

  assert.equal(summary.productCount, 1);
  assert.equal(summary.totalUnits, 10);
  assert.equal(summary.totalValueAtCost, 20);
  assert.equal(summary.totalValueAtRetail, 50);
  assert.equal(summary.archivedProductCount, 1);
  assert.equal(summary.archivedUnits, 40);
});

test("lots belonging to an archived product move to archivedValueAtLotCost", () => {
  const products = [
    product("live", { stock: 10, cost: 2, sale: 5 }),
    product("retired", { stock: 40, cost: 3, sale: 7, is_active: false }),
  ];
  const lots = [lot("live", 10, 2), lot("retired", 40, 3), lot("retired", 5, 1)];

  const summary = computeStockSummary(products, lots);

  assert.equal(summary.totalValueAtLotCost, 20);
  assert.equal(summary.archivedValueAtLotCost, 125);
  // The two together still account for every open lot — nothing is lost, just split.
  assert.equal(summary.totalValueAtLotCost + summary.archivedValueAtLotCost, 145);
});

test("unrealized profit ignores archived stock on both sides", () => {
  const products = [
    product("live", { stock: 10, cost: 2, sale: 5 }),
    product("retired", { stock: 100, cost: 3, sale: 50, is_active: false }),
  ];

  const summary = computeStockSummary(products, [lot("live", 10, 2), lot("retired", 100, 3)]);

  // retail 50 − lot cost 20, with the archived product contributing to neither.
  assert.equal(summary.totalValueAtRetail, 50);
  assert.equal(summary.unrealizedGrossProfit, 30);
  assert.equal(summary.inventoryMarginPct, 60);
});

test("an archived product never appears in low stock, reorder or out-of-stock", () => {
  const products = [
    product("live", { stock: 50, cost: 2, sale: 5 }),
    product("retired-low", { stock: 1, cost: 3, sale: 7, is_active: false }),
    product("retired-empty", { stock: 0, cost: 3, sale: 7, is_active: false }),
  ];

  const summary = computeStockSummary(products, []);

  assert.deepEqual(summary.lowStockItems, []);
  assert.equal(summary.reorderCount, 0);
  assert.equal(summary.outOfStockCount, 0);
  assert.equal(summary.archivedProductCount, 2);
});

test("restoring is just the absence of the flag — figures come back", () => {
  const archived = computeStockSummary(
    [product("p", { stock: 10, cost: 2, sale: 5, is_active: false })],
    [lot("p", 10, 2)],
  );
  const restored = computeStockSummary(
    [product("p", { stock: 10, cost: 2, sale: 5, is_active: true })],
    [lot("p", 10, 2)],
  );

  assert.equal(archived.totalUnits, 0);
  assert.equal(restored.totalUnits, 10);
  assert.equal(restored.totalValueAtLotCost, 20);
  assert.equal(restored.archivedValueAtLotCost, 0);
});
