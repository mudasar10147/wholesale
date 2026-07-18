/**
 * Run: npm run test:inventory-validation
 */
import assert from "node:assert/strict";
import {
  formatValidationSummary,
  validateInventoryData,
  type ValidationInput,
} from "./validateInventory.ts";

const baseline: ValidationInput = {
  products: [
    {
      id: "p1",
      data: {
        name: "Widget",
        cost_price: 100,
        sale_price: 120,
        stock_quantity: 15,
        created_at: {} as never,
      },
    },
    {
      id: "p2",
      data: {
        name: "Gadget",
        cost_price: 50,
        sale_price: 70,
        stock_quantity: 10,
        created_at: {} as never,
      },
    },
  ],
  lots: [
    {
      id: "l1",
      data: {
        product_id: "p1",
        unit_cost: 100,
        qty_in: 10,
        qty_remaining: 10,
        source: "stock_in",
        received_at: {} as never,
        created_at: {} as never,
        updated_at: {} as never,
      },
    },
    {
      id: "l2",
      data: {
        product_id: "p1",
        unit_cost: 100,
        qty_in: 5,
        qty_remaining: 5,
        source: "stock_in",
        received_at: {} as never,
        created_at: {} as never,
        updated_at: {} as never,
      },
    },
    {
      id: "l3",
      data: {
        product_id: "p2",
        unit_cost: 50,
        qty_in: 10,
        qty_remaining: 10,
        source: "stock_in",
        received_at: {} as never,
        created_at: {} as never,
        updated_at: {} as never,
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
        created_at: {} as never,
      },
    },
  ],
  invoices: [
    {
      id: "INV-1",
      data: {
        customer_id: "c1",
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
        created_at: {} as never,
        updated_at: {} as never,
      },
    },
  ],
  itemCogs: [
    {
      id: "item1",
      data: {
        invoice_id: "INV-1",
        order_id: "INV-1",
        customer_id: "c1",
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
        created_at: {} as never,
      },
    },
  ],
};

const okReport = validateInventoryData(baseline, "test");
assert.equal(okReport.summary.errors, 0, formatValidationSummary(okReport));

const mismatch = validateInventoryData(
  {
    ...baseline,
    products: [
      {
        id: "p1",
        data: { ...baseline.products[0]!.data, stock_quantity: 20 },
      },
      baseline.products[1]!,
    ],
  },
  "test",
);
assert.equal(mismatch.summary.errors, 1);
assert.equal(mismatch.issues[0]?.code, "STOCK_LOT_MISMATCH");
assert.equal(mismatch.issues[0]?.delta, -5);

const orphanLot = validateInventoryData(
  {
    ...baseline,
    lots: [
      ...baseline.lots,
      {
        id: "orphan",
        data: {
          product_id: "missing",
          unit_cost: 1,
          qty_in: 1,
          qty_remaining: 1,
          source: "adjustment",
          received_at: {} as never,
          created_at: {} as never,
          updated_at: {} as never,
        },
      },
    ],
  },
  "test",
);
assert.ok(orphanLot.issues.some((i) => i.code === "ORPHANED_LOT"));

console.log("validateInventory.test.ts: all assertions passed");
