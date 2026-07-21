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

// Originally-ported checks (mapped from the legacy validator to register ids).
detects("P1", (i) => { i.products[0]!.data.stock_quantity = 12; });
detects("P2", (i) => { i.products[0]!.data.stock_quantity = -1; });
detects("P3", (i) => { i.products[0]!.data.stock_quantity = 8.5; });
detects("L1", (i) => { i.lots[0]!.data.qty_remaining = 999; }); // > qty_in
detects("L5", (i) => { i.lots.push({ id: "orphan", data: { product_id: "ghost", unit_cost: 1, qty_in: 1, qty_remaining: 1, source: "adjustment", received_at: TS, created_at: TS, updated_at: TS } as never }); });
detects("L6", (i) => { i.lots[0]!.data.qty_remaining = 9; }); // 10 - 2 consumed = 8, not 9
detects("C3", (i) => { i.consumptions.push({ id: "c2", data: { invoice_id: "INV-1", order_id: "INV-1", invoice_item_id: "item1", product_id: "p1", lot_id: "ghostlot", quantity: 1, unit_cost: 100, cogs_amount: 100, created_at: TS } as never }); });
detects("C8", (i) => { i.consumptions.push({ id: "c-dup", data: { ...i.consumptions[0]!.data } as never }); });
detects("I6", (i) => { i.itemCogs[0]!.data.cogs_amount = 999; });
detects("G1", (i) => {
  const h = { transaction_number: "T", status: "posted", warehouse_id: "default", item_ids: ["ln"], source_document_type: "invoice", source_document_id: "INV-1", type: "SALE", posted_by_uid: "u", created_at: TS, updated_at: TS };
  i.inventoryTransactions = [{ id: "t1", data: { ...h } as never }, { id: "t2", data: { ...h } as never }];
  i.inventoryTransactionLines = [{ id: "ln", data: { transaction_id: "t1", product_id: "p1", warehouse_id: "default", direction: "out", quantity: 1, unit_cost: 100, total_cost: 100, created_at: TS } as never }];
});
detects("G2", (i) => { i.invoices[0]!.data.ledger_status = "pending"; });
detects("G5", (i) => { i.inventoryTransactions = []; i.inventoryTransactionLines = [{ id: "ln", data: { transaction_id: "ghosttxn", product_id: "p1", warehouse_id: "default", direction: "out", quantity: 1, unit_cost: 100, total_cost: 100, created_at: TS } as never }]; });
detects("G1b", (i) => { i.inventoryTransactionLines = [{ id: "ln", data: { transaction_id: "t1", product_id: "p1", warehouse_id: "default", direction: "out", quantity: 2, unit_cost: 100, total_cost: 999, created_at: TS } as never }]; });
detects("D4", (i) => { i.inventoryDiscards = [{ id: "d1", data: { discard_number: "D-1", total_quantity: 1, total_cogs_amount: 1, item_ids: [], ledger_status: "pending", created_at: TS } as never }]; });

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

// Returns / discards / sales — exercise the expanded ValidationInput.

detects("L6", (i) => {
  // A discard allocation on l1 breaks the full identity (10 − 2 − 1 ≠ 8).
  i.inventoryDiscardLots = [{ id: "dl1", data: { discard_id: "d1", discard_item_id: "di1", lot_id: "l1", product_id: "p1", quantity: 1, unit_cost: 100, cogs_amount: 100, created_at: TS } as never }];
});
detects("I7", (i) => {
  i.sales = [{ id: "s1", data: { invoice_id: "INV-1", sale_type: "sale", product_id: "p1", quantity: 5, sale_price: 120, total_amount: 600 } as never }];
});
detects("R1", (i) => {
  i.invoiceReturnItems = [{ id: "ri1", data: { return_id: "R1", original_invoice_id: "INV-1", original_invoice_item_id: "item1", product_id: "p1", quantity_returned: 5, quantity_restock: 5, quantity_discard: 0, unit_price: 120, line_discount: 0, line_delivery_charge: 0, line_total: 600, cogs_amount: 500 } as never }];
});
detects("R2", (i) => {
  i.returnLotRestorations = [{ id: "rr1", data: { return_id: "R1", consumption_id: "c1", lot_id: "l1", product_id: "p1", invoice_id: "INV-1", invoice_item_id: "item1", quantity: 5, unit_cost: 100, cogs_amount: 500, created_at: TS } as never }];
});
detects("R3", (i) => {
  i.returnLotRestorations = [{ id: "rr1", data: { return_id: "R1", consumption_id: "c1", lot_id: "l1", product_id: "p1", invoice_id: "INV-1", invoice_item_id: "item1", quantity: 1, unit_cost: 100, cogs_amount: 100, created_at: TS } as never }];
  i.returnLotWriteOffs = [{ id: "wo1", data: { return_id: "R1", consumption_id: "c1", lot_id: "l1", product_id: "p1", invoice_id: "INV-1", invoice_item_id: "item1", quantity: 2, unit_cost: 100, cogs_amount: 200, created_at: TS } as never }];
});
detects("R4", (i) => {
  i.returnLotRestorations = [{ id: "rr1", data: { return_id: "R1", consumption_id: "c1", lot_id: "OTHER", product_id: "p1", invoice_id: "INV-1", invoice_item_id: "item1", quantity: 1, unit_cost: 100, cogs_amount: 100, created_at: TS } as never }];
});
detects("R7", (i) => {
  i.invoiceReturns = [{ id: "ret1", data: { return_number: "RET-1", original_invoice_id: "INV-1", order_id: "INV-1", customer_id: "cust1", status: "posted", settlement_type: "refund", ledger_status: "pending", item_ids: [], subtotal_amount: 100, total_amount: 100, refund_amount: 100, created_at: TS, updated_at: TS } as never }];
});
detects("R9", (i) => {
  i.invoices[0]!.data.status = "void";
  i.invoices[0]!.data.stock_reversal_applied = true;
  i.invoiceReturns = [{ id: "ret1", data: { return_number: "RET-1", original_invoice_id: "INV-1", order_id: "INV-1", customer_id: "cust1", status: "posted", settlement_type: "refund", inventory_transaction_id: "t9", item_ids: [], subtotal_amount: 100, total_amount: 100, refund_amount: 100, created_at: TS, updated_at: TS } as never }];
});
detects("D1", (i) => {
  i.inventoryDiscardItems = [{ id: "di1", data: { discard_id: "d1", product_id: "p1", quantity: 5, cogs_amount: 300, created_at: TS } as never }];
  i.inventoryDiscardLots = [{ id: "dl1", data: { discard_id: "d1", discard_item_id: "di1", lot_id: "l1", product_id: "p1", quantity: 3, unit_cost: 100, cogs_amount: 300, created_at: TS } as never }];
});
detects("D3", (i) => {
  i.inventoryDiscardLots = [{ id: "dl1", data: { discard_id: "d1", discard_item_id: "di1", lot_id: "l1", product_id: "p1", quantity: 3, unit_cost: 100, cogs_amount: 999, created_at: TS } as never }];
});
