/**
 * Run: npm run test:delivery-balance
 */
import assert from "node:assert/strict";
import {
  buildDeliveryBalanceList,
  buildDeliveryBalanceRow,
  getDeliveryBalanceDue,
  invoiceHasRemainingBalance,
  sumDeliveryBalanceDue,
  type DeliveryBalanceInvoiceInput,
} from "./deliveryBalanceList.ts";

const invoices: DeliveryBalanceInvoiceInput[] = [
  {
    id: "draft-1",
    customer_id: "c1",
    order_id: "ORD-100",
    status: "draft",
    total_amount: 5000,
    item_ids: ["a", "b"],
    paid_amount: 0,
    payment_status: "unpaid",
  },
  {
    id: "posted-unpaid",
    customer_id: "c2",
    order_id: "ORD-200",
    status: "posted",
    total_amount: 3000,
    posted_total_amount: 3000,
    item_ids: ["x"],
    paid_amount: 0,
    payment_status: "unpaid",
  },
  {
    id: "posted-partial",
    customer_id: "c1",
    order_id: "ORD-150",
    status: "posted",
    total_amount: 4000,
    posted_total_amount: 4000,
    item_ids: ["y"],
    paid_amount: 1000,
    payment_status: "partial",
  },
  {
    id: "posted-paid",
    customer_id: "c3",
    order_id: "ORD-300",
    status: "posted",
    total_amount: 2000,
    posted_total_amount: 2000,
    item_ids: ["z"],
    paid_amount: 2000,
    payment_status: "paid",
  },
  {
    id: "void-1",
    customer_id: "c1",
    order_id: "ORD-000",
    status: "void",
    total_amount: 1000,
    item_ids: [],
    paid_amount: 0,
    payment_status: "unpaid",
  },
];

assert.equal(invoiceHasRemainingBalance(invoices[0]), true);
assert.equal(invoiceHasRemainingBalance(invoices[3]), false);
assert.equal(invoiceHasRemainingBalance(invoices[4]), false);
assert.equal(getDeliveryBalanceDue(invoices[0]), 5000);
assert.equal(getDeliveryBalanceDue(invoices[2]), 3000);

const customers = new Map([
  ["c1", { name: "Alpha Co", phone: "111", address: "Street 1" }],
  ["c2", { name: "Beta Co", phone: "222" }],
]);

const rows = buildDeliveryBalanceList(invoices, customers);
assert.equal(rows.length, 3);
assert.equal(rows[0].customerName, "Alpha Co");
assert.equal(rows[0].orderId, "ORD-100");
assert.equal(rows[0].balanceDue, 5000);
assert.equal(rows[1].orderId, "ORD-150");
assert.equal(rows[1].balanceDue, 3000);
assert.equal(rows[2].customerName, "Beta Co");
assert.equal(sumDeliveryBalanceDue(rows), 11000);

const partialRow = buildDeliveryBalanceRow(invoices[2], customers.get("c1"));
assert.equal(partialRow.statusLabel, "Partial paid");
assert.equal(partialRow.paidAmount, 1000);

console.log("deliveryBalanceList.test.ts: all assertions passed");
