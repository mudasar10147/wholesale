/**
 * Run: npm run test:dashboard
 *
 * `computeDashboard` replaced five independent loaders that each fetched their
 * own inputs. These tests pin the behaviour that refactor had to preserve:
 * period windowing, void-invoice exclusion, and the fact that every figure is
 * derived from one shared set of documents.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { computeCashSnapshot, computeDashboard, countActiveCustomers, type DashboardRaw } from "./dashboardData.ts";

/** Minimal stand-in for a Firestore Timestamp — only `toMillis` is read. */
function ts(iso: string) {
  const ms = new Date(iso).getTime();
  return { toMillis: () => ms } as unknown as import("firebase/firestore").Timestamp;
}

const NOW = new Date("2026-08-13T12:00:00");

function emptyRaw(): DashboardRaw {
  return {
    products: [],
    invoices: [],
    sales: [],
    expenses: [],
    stockLots: [],
    cashEntries: [],
    customers: [],
    invoiceReturns: [],
    inventoryDiscards: [],
    cashSettings: null,
  };
}

function sampleRaw(): DashboardRaw {
  return {
    ...emptyRaw(),
    products: [
      // 10 units @ cost 50, sells for 80 → in stock, not low.
      { id: "p1", data: { name: "Widget", stock_quantity: 10, cost_price: 50, sale_price: 80 } },
      // Out of stock.
      { id: "p2", data: { name: "Gadget", stock_quantity: 0, cost_price: 20, sale_price: 35 } },
      // Low stock (needs reorder).
      { id: "p3", data: { name: "Doodad", stock_quantity: 2, cost_price: 10, sale_price: 18 } },
    ] as DashboardRaw["products"],
    invoices: [
      { id: "INV-1", data: { status: "posted", paid_amount: 300 } },
      { id: "INV-VOID", data: { status: "void", paid_amount: 999 } },
    ] as DashboardRaw["invoices"],
    sales: [
      // In period (today), good invoice.
      { invoice_id: "INV-1", product_id: "p1", quantity: 2, total_amount: 300, cogs_amount: 100, date: ts("2026-08-13T09:00:00") },
      // In period but belongs to a VOID invoice → must be excluded everywhere.
      { invoice_id: "INV-VOID", product_id: "p1", quantity: 5, total_amount: 999, cogs_amount: 500, date: ts("2026-08-13T10:00:00") },
      // Earlier this year — outside today, inside YTD.
      { invoice_id: "INV-1", product_id: "p1", quantity: 1, total_amount: 150, cogs_amount: 50, date: ts("2026-03-02T09:00:00") },
      // Walk-in (no invoice_id) — counts as cash.
      { product_id: "p3", quantity: 1, total_amount: 40, cogs_amount: 10, date: ts("2026-08-13T11:00:00") },
    ] as unknown as DashboardRaw["sales"],
    expenses: [
      { amount: 60, date: ts("2026-08-13T08:00:00") },
      { amount: 500, date: ts("2026-01-15T08:00:00") },
    ] as unknown as DashboardRaw["expenses"],
    stockLots: [
      { source: "stock_in", unit_cost: 50, qty_in: 10, qty_remaining: 10 },
    ] as unknown as DashboardRaw["stockLots"],
    cashEntries: [
      { amount: 1000, entry_type: "add" },
      { amount: 250, entry_type: "remove" },
    ] as unknown as DashboardRaw["cashEntries"],
    customers: [
      { name: "A", is_active: true },
      { name: "B", is_active: false },
      { name: "C" },
    ] as unknown as DashboardRaw["customers"],
  };
}

const TODAY = {
  start: new Date("2026-08-13T00:00:00"),
  end: new Date("2026-08-13T23:59:59.999"),
};

test("period profit counts only sales inside the window", () => {
  const d = computeDashboard(sampleRaw(), TODAY, NOW);
  // Today: 300 (INV-1) + 40 (walk-in). The 150 from March is outside the window,
  // and the 999 void row is excluded.
  assert.equal(d.profit.totalSales, 340);
  assert.equal(d.profit.totalExpenses, 60);
});

test("sales on void invoices are excluded from profit and COGS", () => {
  const raw = sampleRaw();
  const withVoid = computeDashboard(raw, TODAY, NOW);

  // Drop the void invoice: its sale row is no longer suppressed, so totals jump.
  const voidGone: DashboardRaw = {
    ...raw,
    invoices: raw.invoices.filter((i) => i.id !== "INV-VOID"),
  };
  const withoutVoid = computeDashboard(voidGone, TODAY, NOW);

  assert.equal(withVoid.profit.totalSales, 340);
  assert.equal(withoutVoid.profit.totalSales, 1339);
  assert.ok(withoutVoid.profit.cogs > withVoid.profit.cogs);
});

test("stock summary is derived from the same products array", () => {
  const d = computeDashboard(sampleRaw(), TODAY, NOW);
  assert.equal(d.stock.productCount, 3);
  assert.equal(d.stock.totalUnits, 12);
  // 10×50 + 0×20 + 2×10 = 520
  assert.equal(d.stock.totalValueAtCost, 520);
  assert.equal(d.stock.outOfStockCount, 1);
  assert.equal(d.stock.reorderCount, 1);
});

test("YTD sales span the year while the period stays narrow", () => {
  const d = computeDashboard(sampleRaw(), TODAY, NOW);
  // 300 + 150 + 40 across the year, void row excluded.
  assert.equal(d.ytdWeeklySales.totalSales, 490);
  assert.equal(d.ytdWeeklySales.year, 2026);
  assert.ok(d.ytdWeeklySales.avgWeeklySales !== null);
});

test("active customers treat a missing is_active as active", () => {
  assert.equal(countActiveCustomers(sampleRaw().customers), 2);
  assert.equal(countActiveCustomers([]), 0);
});

test("cash is derivable without a period, and matches the full computation", () => {
  const raw = sampleRaw();
  const cashOnly = computeCashSnapshot(raw);
  const full = computeDashboard(raw, TODAY, NOW);
  assert.deepEqual(cashOnly, full.cash);

  // Walk-in 40 + invoice payments 300 (void's 999 ignored) − expenses 560
  // − stock purchases 500 = −720; +1000 added −250 removed = 30.
  assert.equal(cashOnly.cashWalkInSales, 40);
  assert.equal(cashOnly.cashInvoicePayments, 300);
  assert.equal(cashOnly.totalExpenses, 560);
  assert.equal(cashOnly.stockPurchasesCash, 500);
  assert.equal(cashOnly.totalCashInHand, 30);
});

test("empty data produces zeroes rather than throwing", () => {
  const d = computeDashboard(emptyRaw(), TODAY, NOW);
  assert.equal(d.profit.totalSales, 0);
  assert.equal(d.stock.productCount, 0);
  assert.equal(d.activeCustomerCount, 0);
  assert.equal(d.ytdWeeklySales.avgWeeklySales, null);
  assert.equal(d.cash.totalCashInHand, 0);
});

test("archiving a product removes it from stock but never rewrites past profit", () => {
  const range = { start: new Date("2026-08-13T00:00:00"), end: new Date("2026-08-13T23:59:59") };

  const before = computeDashboard(sampleRaw(), range, NOW);

  // Retire p1 — the product every in-period sale was made against.
  const raw = sampleRaw();
  raw.products = raw.products.map((row) =>
    row.id === "p1" ? { ...row, data: { ...row.data, is_active: false } } : row,
  ) as DashboardRaw["products"];
  const after = computeDashboard(raw, range, NOW);

  // Profit is history: it must be identical. buildCostMap still sees the product.
  assert.deepEqual(after.profit, before.profit);

  // Stock is "what we hold now": p1 and its 10 units drop out, and are reported
  // separately so the dashboard can explain the gap to the inventory validator.
  assert.equal(before.stock.productCount, 3);
  assert.equal(after.stock.productCount, 2);
  assert.equal(after.stock.totalUnits, before.stock.totalUnits - 10);
  assert.equal(after.stock.totalValueAtCost, before.stock.totalValueAtCost - 10 * 50);
  assert.equal(after.stock.archivedProductCount, 1);
  assert.equal(after.stock.archivedUnits, 10);
});
