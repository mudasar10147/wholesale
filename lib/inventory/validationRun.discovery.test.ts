/**
 * Incremental discovery coverage — every stock-affecting workflow must surface
 * its affected product in the next incremental run (§9.2), proven per workflow.
 * Run: npm run test:inventory-discovery
 *
 * Each case isolates ONE discovery source: the product's static docs are OLD
 * (before the watermark) and only the workflow's own footprint is NEW, so a pass
 * proves that source catches the workflow independently — discovery never relies
 * on stock_lots.updated_at alone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverChangedProducts, entityOf, issueKey } from "./validationRun.ts";
import type { ValidationInput } from "./validationContext.ts";

const OLD = "2026-01-01T00:00:00Z";
const NEW = "2026-06-02T00:00:00Z";
const SINCE = Date.parse("2026-06-01T00:00:00Z");
const ts = (iso: string) => ({ toMillis: () => Date.parse(iso) }) as never;

/** Product P with only OLD footprint — must NOT be discovered on its own. */
function base(): ValidationInput {
  return {
    products: [{ id: "P", data: { name: "P", cost_price: 1, sale_price: 2, stock_quantity: 5, created_at: ts(OLD) } }],
    lots: [{ id: "P-old", data: { product_id: "P", unit_cost: 1, qty_in: 5, qty_remaining: 5, source: "stock_in", trader_id: "t", received_at: ts(OLD), created_at: ts(OLD), updated_at: ts(OLD) } as never }],
    consumptions: [],
    invoices: [],
    itemCogs: [],
  };
}

function discovered(mut: (i: ValidationInput) => void): Set<string> {
  const input = base();
  mut(input);
  return discoverChangedProducts(input, SINCE).productIds;
}

function affects(name: string, mut: (i: ValidationInput) => void) {
  test(`discovery: ${name} surfaces the affected product`, () => {
    assert.ok(discovered(mut).has("P"), `${name} did not surface product P`);
  });
}

test("control: a product with only pre-watermark footprint is NOT discovered", () => {
  assert.equal(discoverChangedProducts(base(), SINCE).productIds.has("P"), false);
});

// 1. stock-in / lot creation — a new lot carries a fresh updated_at.
affects("stock-in / lot creation", (i) => {
  i.lots.push({ id: "P-new", data: { product_id: "P", unit_cost: 1, qty_in: 3, qty_remaining: 3, source: "stock_in", trader_id: "t", received_at: ts(NEW), created_at: ts(NEW), updated_at: ts(NEW) } as never });
});

// 2. invoice posting — a new consumption.
affects("invoice posting", (i) => {
  i.consumptions.push({ id: "c1", data: { invoice_id: "INV-1", order_id: "INV-1", invoice_item_id: "it1", product_id: "P", lot_id: "P-old", quantity: 1, unit_cost: 1, cogs_amount: 1, created_at: ts(NEW) } as never });
});

// 3. invoice voiding — consumption already existed (OLD); the SALE_VOID ledger
//    line is the fresh footprint (lot deliberately left OLD to isolate the source).
affects("invoice voiding (via SALE_VOID ledger line)", (i) => {
  i.consumptions.push({ id: "c1", data: { invoice_id: "INV-1", order_id: "INV-1", invoice_item_id: "it1", product_id: "P", lot_id: "P-old", quantity: 1, unit_cost: 1, cogs_amount: 1, created_at: ts(OLD), reversed_at: ts(NEW) } as never });
  i.inventoryTransactionLines = [{ id: "vl1", data: { transaction_id: "vtx1", product_id: "P", warehouse_id: "default", direction: "in", quantity: 1, unit_cost: 1, total_cost: 1, created_at: ts(NEW) } as never }];
});

// 4/5. returns / lot restorations — a new restoration row.
affects("returns / lot restorations", (i) => {
  i.returnLotRestorations = [{ id: "rr1", data: { return_id: "R1", consumption_id: "c1", lot_id: "P-old", product_id: "P", invoice_id: "INV-1", invoice_item_id: "it1", quantity: 1, unit_cost: 1, cogs_amount: 1, created_at: ts(NEW) } as never }];
});

// 6. return write-offs — audit only, NO lot change; caught by its own collection.
affects("return write-offs (no lot change)", (i) => {
  i.returnLotWriteOffs = [{ id: "wo1", data: { return_id: "R1", consumption_id: "c1", lot_id: "P-old", product_id: "P", invoice_id: "INV-1", invoice_item_id: "it1", quantity: 1, unit_cost: 1, cogs_amount: 1, created_at: ts(NEW) } as never }];
});

// 7. discards — a new discard lot allocation.
affects("discards", (i) => {
  i.inventoryDiscardLots = [{ id: "dl1", data: { discard_id: "d1", discard_item_id: "di1", lot_id: "P-old", product_id: "P", quantity: 1, unit_cost: 1, cogs_amount: 1, created_at: ts(NEW) } as never }];
});

// 8. adjustments — an ADJUSTMENT ledger line.
affects("adjustments (via ADJUSTMENT ledger line)", (i) => {
  i.inventoryTransactionLines = [{ id: "al1", data: { transaction_id: "atx1", product_id: "P", warehouse_id: "default", direction: "out", quantity: 1, unit_cost: 1, total_cost: 1, created_at: ts(NEW) } as never }];
});

// 9. reconciliations — book-only correction touches NO lot; caught by the
//    RECONCILIATION ledger header's product_id.
affects("reconciliations (book-only, via RECONCILIATION header)", (i) => {
  i.inventoryTransactions = [{ id: "rtx1", data: { transaction_number: "RECON", type: "RECONCILIATION", status: "posted", warehouse_id: "default", item_ids: [], movement: false, product_id: "P", posted_by_uid: "u", created_at: ts(NEW), updated_at: ts(NEW) } as never }];
});

// 10a. stuck invoice ledger (regardless of time).
affects("stuck invoice ledger", (i) => {
  i.invoices.push({ id: "INV-1", data: { customer_id: "c", order_id: "INV-1", status: "posted", payment_status: "unpaid", paid_amount: 0, stock_reversal_applied: false, item_ids: ["it1"], subtotal_amount: 1, discount_amount: 0, delivery_charge: 0, total_amount: 1, ledger_status: "pending", created_at: ts(OLD), updated_at: ts(OLD) } as never });
  i.itemCogs.push({ id: "it1", data: { invoice_id: "INV-1", order_id: "INV-1", customer_id: "c", invoice_item_id: "it1", product_id: "P", quantity: 1, unit_sale_price: 2, unit_cost_snapshot: 1, line_subtotal: 1, line_discount: 0, line_delivery_charge: 0, cogs_amount: 1, line_total: 1, created_at: ts(OLD) } as never });
});

// 10b. stuck counter-sale (returns_post_status pending).
affects("stuck counter-sale (returns_post_status pending)", (i) => {
  i.invoices.push({ id: "INV-2", data: { customer_id: "c", order_id: "INV-2", status: "posted", payment_status: "unpaid", paid_amount: 0, stock_reversal_applied: false, item_ids: ["it2"], subtotal_amount: 1, discount_amount: 0, delivery_charge: 0, total_amount: 1, returns_post_status: "pending", created_at: ts(OLD), updated_at: ts(OLD) } as never });
  i.itemCogs.push({ id: "it2", data: { invoice_id: "INV-2", order_id: "INV-2", customer_id: "c", invoice_item_id: "it2", product_id: "P", quantity: 1, unit_sale_price: 2, unit_cost_snapshot: 1, line_subtotal: 1, line_discount: 0, line_delivery_charge: 0, cogs_amount: 1, line_total: 1, created_at: ts(OLD) } as never });
});

// 10c. stuck return ledger.
affects("stuck return ledger", (i) => {
  i.invoiceReturns = [{ id: "RET-1", data: { return_number: "RET-1", original_invoice_id: "INV-1", order_id: "INV-1", customer_id: "c", status: "posted", settlement_type: "refund", ledger_status: "failed", item_ids: ["ri1"], subtotal_amount: 1, total_amount: 1, refund_amount: 1, created_at: ts(OLD), updated_at: ts(OLD) } as never }];
  i.invoiceReturnItems = [{ id: "ri1", data: { return_id: "RET-1", original_invoice_id: "INV-1", original_invoice_item_id: "it1", customer_id: "c", order_id: "INV-1", product_id: "P", quantity_returned: 1, quantity_restock: 1, quantity_discard: 0, unit_price: 2, line_discount: 0, line_delivery_charge: 0, line_total: 2, cogs_amount: 1 } as never }];
});

// 10d. stuck discard ledger.
affects("stuck discard ledger", (i) => {
  i.inventoryDiscards = [{ id: "D-1", data: { discard_number: "D-1", total_quantity: 1, total_cogs_amount: 1, item_ids: ["di1"], ledger_status: "pending", created_at: ts(OLD) } as never }];
  i.inventoryDiscardItems = [{ id: "di1", data: { discard_id: "D-1", product_id: "P", quantity: 1, cogs_amount: 1, created_at: ts(OLD) } as never }];
});

// ── first_seen_at stable identity: invariant + entity type + entity id ────────

test("issue identity is invariant + entity_type + entity_id (no incorrect merge)", () => {
  const key = (i: Parameters<typeof entityOf>[0] & { invariant_id: string }) => {
    const e = entityOf(i);
    return issueKey({ invariant_id: i.invariant_id, entity_type: e.type, entity_id: e.id });
  };
  const p1a = key({ invariant_id: "P1", product_id: "A" });
  const p1b = key({ invariant_id: "P1", product_id: "B" });
  const p2a = key({ invariant_id: "P2", product_id: "A" });
  const lotA = key({ invariant_id: "L1", lot_id: "A", product_id: "A" });

  // Same invariant, different entity → different identity.
  assert.notEqual(p1a, p1b);
  // Same entity, different invariant → different identity.
  assert.notEqual(p1a, p2a);
  // Different entity type on the same product id → different identity.
  assert.notEqual(p1a, lotA);
  // Stable and repeatable.
  assert.equal(p1a, key({ invariant_id: "P1", product_id: "A" }));
});

test("entityOf picks the most specific entity", () => {
  assert.deepEqual(entityOf({ lot_id: "L", product_id: "P" }), { type: "lot", id: "L" });
  assert.deepEqual(entityOf({ invoice_id: "I", product_id: "P" }), { type: "invoice", id: "I" });
  assert.deepEqual(entityOf({ product_id: "P" }), { type: "product", id: "P" });
  assert.deepEqual(entityOf({}), { type: "global", id: "-" });
});
