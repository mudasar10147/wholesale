/**
 * Detection tests: each newly-implemented invariant is deliberately violated and
 * the validator must report it by invariant_id (§12.5 discipline).
 * Run: npm run test:inventory-detection
 *
 * `clean()` returns a fully-valid snapshot (zero findings). Each test mutates one
 * aspect and asserts the target invariant_id appears — it need not be the only one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateInventoryData, type ValidationInput } from "./validateInventory.ts";

const TS = { toMillis: () => 1_000 } as never;

function clean(): ValidationInput {
  return {
    products: [
      { id: "p1", data: { name: "Widget", cost_price: 100, sale_price: 120, stock_quantity: 8, created_at: TS } },
    ],
    lots: [
      {
        id: "l1",
        data: {
          product_id: "p1",
          unit_cost: 100,
          qty_in: 10,
          qty_remaining: 8,
          source: "stock_in",
          trader_id: "t1",
          received_at: TS,
          created_at: TS,
          updated_at: TS,
        },
      },
    ],
    consumptions: [
      {
        id: "c1",
        data: {
          invoice_id: "INV-1",
          order_id: "INV-1",
          invoice_item_id: "item1",
          product_id: "p1",
          lot_id: "l1",
          quantity: 2,
          unit_cost: 100,
          cogs_amount: 200,
          created_at: TS,
        },
      },
    ],
    invoices: [
      {
        id: "INV-1",
        data: {
          customer_id: "cust1",
          order_id: "INV-1",
          status: "posted",
          payment_status: "unpaid",
          paid_amount: 0,
          stock_reversal_applied: false,
          item_ids: ["item1"],
          subtotal_amount: 240,
          discount_amount: 0,
          delivery_charge: 0,
          total_amount: 240,
          posted_subtotal_amount: 240,
          posted_discount_amount: 0,
          posted_delivery_charge: 0,
          posted_total_amount: 240,
          posted_cogs_amount: 200,
          posted_at: TS,
          created_at: TS,
          updated_at: TS,
        },
      },
    ],
    itemCogs: [
      {
        id: "item1",
        data: {
          invoice_id: "INV-1",
          order_id: "INV-1",
          customer_id: "cust1",
          invoice_item_id: "item1",
          product_id: "p1",
          quantity: 2,
          unit_sale_price: 120,
          unit_cost_snapshot: 100,
          line_subtotal: 240,
          line_discount: 0,
          line_delivery_charge: 0,
          cogs_amount: 200,
          line_total: 240,
          created_at: TS,
        },
      },
    ],
  };
}

function ids(input: ValidationInput): Set<string> {
  return new Set(validateInventoryData(input).issues.map((i) => i.invariant_id));
}

function detects(id: string, mutate: (i: ValidationInput) => void) {
  test(`${id} is detected`, () => {
    const input = clean();
    mutate(input);
    assert.ok(ids(input).has(id), `expected ${id} to be reported`);
  });
}

test("clean snapshot has zero findings", () => {
  const report = validateInventoryData(clean());
  assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
  assert.equal(report.verdict, "PASS");
});

detects("P4", (i) => { i.products[0]!.data.cost_price = -1; });
detects("P5", (i) => { i.products[0]!.data.cost_price = 55; });
detects("P6", (i) => { i.consumptions[0]!.data.product_id = "ghost"; });
detects("L2", (i) => { i.lots[0]!.data.qty_in = 0; });
detects("L3", (i) => { i.lots[0]!.data.unit_cost = -5; });
detects("L4", (i) => { (i.lots[0]!.data as { received_at: unknown }).received_at = null; });
detects("L8", (i) => { i.lots[0]!.data.trader_id = ""; });
detects("C1", (i) => { i.itemCogs[0]!.data.quantity = 5; });
detects("C2", (i) => { i.consumptions[0]!.data.quantity = 0; });
detects("C4", (i) => { i.consumptions[0]!.data.cogs_amount = 1; });
detects("C5", (i) => { i.consumptions[0]!.data.unit_cost = 999; });
detects("C6", (i) => { i.invoices[0]!.data.status = "void"; i.invoices[0]!.data.stock_reversal_applied = true; });
detects("C7", (i) => { i.invoices[0]!.data.status = "draft"; });
detects("I1", (i) => { delete i.invoices[0]!.data.posted_at; });
detects("I2", (i) => { i.consumptions = []; });
detects("I3", (i) => { i.invoices[0]!.data.status = "draft"; });
detects("I4", (i) => { i.invoices[0]!.data.item_ids = ["nope"]; });
detects("I5", (i) => { i.invoices[0]!.data.posted_cogs_amount = 999; });
detects("I9", (i) => { i.invoices[0]!.data.status = "void"; });
detects("I10", (i) => {
  i.invoices.push({ ...i.invoices[0]!, id: "INV-2" });
});
detects("K1", (i) => { i.invoices[0]!.data.paid_amount = -5; });
detects("K2", (i) => { i.invoices[0]!.data.paid_amount = 99999; });

detects("A1", (i) => {
  i.inventoryTransactions = [{ id: "adj1", data: { transaction_number: "A", type: "ADJUSTMENT", status: "posted", warehouse_id: "default", item_ids: [], posted_by_uid: "u1", created_at: TS, updated_at: TS } as never }];
});
detects("A2", (i) => {
  i.inventoryTransactions = [{ id: "adj1", data: { transaction_number: "A", type: "ADJUSTMENT", status: "posted", warehouse_id: "default", item_ids: [], reason: "shrink", created_at: TS, updated_at: TS } as never }];
});
detects("A3", (i) => {
  i.inventoryTransactions = [{ id: "adj1", data: { transaction_number: "A", type: "ADJUSTMENT", status: "posted", warehouse_id: "default", item_ids: ["ln1"], reason: "s", posted_by_uid: "u1", created_at: TS, updated_at: TS } as never }];
  i.inventoryTransactionLines = [{ id: "ln1", data: { transaction_id: "adj1", product_id: "p1", warehouse_id: "default", direction: "out", quantity: 1, unit_cost: 100, total_cost: 100, created_at: TS } as never }];
});
detects("G7", (i) => {
  i.inventoryTransactions = [{ id: "t1", data: { transaction_number: "T", type: "SALE", status: "posted", warehouse_id: "default", item_ids: [], created_at: TS, updated_at: TS } as never }];
});
detects("G8", (i) => {
  i.inventoryTransactions = [{ id: "r1", data: { transaction_number: "R", type: "RECONCILIATION", status: "posted", warehouse_id: "default", item_ids: [], movement: true, posted_by_uid: "u1", created_at: TS, updated_at: TS } as never }];
});
