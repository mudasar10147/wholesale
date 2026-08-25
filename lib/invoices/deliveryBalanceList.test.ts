/**
 * Run: npm run test:delivery-balance
 */
import assert from "node:assert/strict";
import {
  buildDeliveryBalanceGroups,
  buildDeliveryBalanceList,
  buildDeliveryBalanceRow,
  countGroupInvoices,
  getDeliveryBalanceDue,
  getDraftReturnCredit,
  groupDeliveryBalanceRows,
  invoiceHasRemainingBalance,
  sumDeliveryBalanceDue,
  sumGroupsBalanceDue,
  type DeliveryBalanceInvoiceInput,
  type DeliveryReturnLine,
} from "./deliveryBalanceList.ts";

function ts(iso: string) {
  return { toDate: () => new Date(iso) };
}

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
    created_at: ts("2026-01-10T00:00:00Z"),
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
    created_at: ts("2026-01-12T00:00:00Z"),
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
    created_at: ts("2026-01-05T00:00:00Z"),
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
    created_at: ts("2026-01-02T00:00:00Z"),
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
// Inside a shop the oldest invoice comes first, not the lowest order id.
assert.equal(rows[0].customerName, "Alpha Co");
assert.equal(rows[0].orderId, "ORD-150");
assert.equal(rows[0].balanceDue, 3000);
assert.equal(rows[1].orderId, "ORD-100");
assert.equal(rows[1].balanceDue, 5000);
assert.equal(rows[2].customerName, "Beta Co");
assert.equal(sumDeliveryBalanceDue(rows), 11000);

const partialRow = buildDeliveryBalanceRow(invoices[2], customers.get("c1"));
assert.equal(partialRow.statusLabel, "Partial paid");
assert.equal(partialRow.paidAmount, 1000);
assert.equal(partialRow.customerId, "c1");
assert.equal(partialRow.customerAddress, "Street 1");
// A missing address falls back to a printable dash, not an empty cell.
assert.equal(buildDeliveryBalanceRow(invoices[1], customers.get("c2")).customerAddress, "-");

// --- returns split gross total from the amount still owed -------------------
const returnedInvoice: DeliveryBalanceInvoiceInput = {
  id: "posted-returned",
  customer_id: "c1",
  order_id: "ORD-160",
  status: "posted",
  total_amount: 10000,
  posted_total_amount: 10000,
  returned_amount: 2500,
  item_ids: ["p", "q"],
  paid_amount: 3000,
  payment_status: "partial",
  created_at: ts("2026-01-20T00:00:00Z"),
};
const returnedRow = buildDeliveryBalanceRow(returnedInvoice, customers.get("c1"));
assert.equal(returnedRow.invoiceTotal, 10000);
assert.equal(returnedRow.returnedAmount, 2500);
assert.equal(returnedRow.netTotal, 7500);
assert.equal(returnedRow.paidAmount, 3000);
assert.equal(returnedRow.balanceDue, 4500);
assert.equal(
  returnedRow.invoiceTotal - returnedRow.returnedAmount - returnedRow.paidAmount,
  returnedRow.balanceDue,
);

// --- a draft's inline counter-sale credit reduces what is owed --------------
const counterSaleDraft: DeliveryBalanceInvoiceInput = {
  id: "draft-counter",
  customer_id: "c2",
  order_id: "ORD-210",
  status: "draft",
  total_amount: 6000,
  returns_credit_amount: 2000,
  item_ids: ["m"],
  paid_amount: 0,
  payment_status: "unpaid",
  created_at: ts("2026-01-22T00:00:00Z"),
};
assert.equal(getDraftReturnCredit(counterSaleDraft), 2000);
assert.equal(getDeliveryBalanceDue(counterSaleDraft), 4000);
const counterRow = buildDeliveryBalanceRow(counterSaleDraft, customers.get("c2"));
assert.equal(counterRow.invoiceTotal, 6000);
assert.equal(counterRow.returnedAmount, 2000);
assert.equal(counterRow.balanceDue, 4000);

// Credit beyond the sale total is refunded in cash, so it never drives the balance below 0.
const overCredited: DeliveryBalanceInvoiceInput = {
  ...counterSaleDraft,
  id: "draft-over",
  order_id: "ORD-211",
  total_amount: 1500,
  returns_credit_amount: 4000,
};
assert.equal(getDraftReturnCredit(overCredited), 1500);
assert.equal(getDeliveryBalanceDue(overCredited), 0);
assert.equal(invoiceHasRemainingBalance(overCredited), false);

// --- grouping: one block per shop, customer details once --------------------
const returnLines = new Map<string, DeliveryReturnLine[]>([
  [
    "posted-returned",
    [
      {
        productId: "p1",
        productName: "Ghee 5L",
        quantityReturned: 3,
        quantityRestock: 2,
        quantityDiscard: 1,
        creditAmount: 2500,
        reducesBalance: true,
      },
    ],
  ],
]);

const groups = buildDeliveryBalanceGroups(
  [...invoices, returnedInvoice, counterSaleDraft],
  customers,
  returnLines,
);

assert.equal(groups.length, 2);
assert.equal(groups[0].customerName, "Alpha Co");
assert.equal(groups[0].invoiceCount, 3);
assert.deepEqual(
  groups[0].rows.map((row) => row.orderId),
  ["ORD-150", "ORD-100", "ORD-160"],
);
assert.equal(groups[0].totalInvoiced, 19000);
assert.equal(groups[0].totalReturned, 2500);
assert.equal(groups[0].totalPaid, 4000);
assert.equal(groups[0].totalDue, 12500);
assert.equal(groups[0].rows[2].returnLines.length, 1);
assert.equal(groups[0].rows[2].returnLines[0].quantityDiscard, 1);

assert.equal(groups[1].customerName, "Beta Co");
assert.equal(groups[1].invoiceCount, 2);
assert.equal(groups[1].totalDue, 7000);

assert.equal(countGroupInvoices(groups), 5);
assert.equal(sumGroupsBalanceDue(groups), 19500);
assert.equal(
  sumGroupsBalanceDue(groups),
  sumDeliveryBalanceDue(groups.flatMap((group) => group.rows)),
);

// Invoices whose customer doc is missing still group together under one block.
const orphanRows = buildDeliveryBalanceList(
  [
    { ...invoices[0], id: "o1", customer_id: "gone", order_id: "ORD-900" },
    { ...invoices[0], id: "o2", customer_id: "gone", order_id: "ORD-901" },
  ],
  new Map(),
);
const orphanGroups = groupDeliveryBalanceRows(orphanRows);
assert.equal(orphanGroups.length, 1);
assert.equal(orphanGroups[0].customerName, "Unknown customer");
assert.equal(orphanGroups[0].invoiceCount, 2);

console.log("deliveryBalanceList.test.ts: all assertions passed");
