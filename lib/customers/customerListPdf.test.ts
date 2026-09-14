/**
 * Run: npm run test:customer-pdf
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerPdfRows,
  customerCellValue,
  customerTotalsRow,
  type CustomerPdfInput,
  type CustomerPdfInvoice,
} from "./customerListPdf.ts";

const NOW = new Date("2026-09-02T00:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function customer(over: Partial<CustomerPdfInput> & { id: string; name: string }): CustomerPdfInput {
  return { isActive: true, createdAt: day(400), ...over };
}

function invoice(over: Partial<CustomerPdfInvoice> & { customerId: string }): CustomerPdfInvoice {
  return {
    orderDate: day(5),
    effectiveTotal: 1000,
    paid: 1000,
    unpaid: 0,
    discount: 0,
    delivery: 0,
    ...over,
  };
}

test("totals every invoice against the right customer", () => {
  const rows = buildCustomerPdfRows(
    [customer({ id: "a", name: "Ahmed" }), customer({ id: "b", name: "Bilal" })],
    [
      invoice({ customerId: "a", effectiveTotal: 1000, paid: 600, unpaid: 400, discount: 50, delivery: 20 }),
      invoice({ customerId: "a", effectiveTotal: 500, paid: 500, unpaid: 0 }),
      invoice({ customerId: "b", effectiveTotal: 300, paid: 0, unpaid: 300 }),
    ],
    { now: NOW },
  );

  const ahmed = rows.find((r) => r.id === "a")!;
  assert.equal(ahmed.orders, 2);
  assert.equal(ahmed.totalPurchased, 1500);
  assert.equal(ahmed.paid, 1100);
  assert.equal(ahmed.unpaid, 400);
  assert.equal(ahmed.discount, 50);
  assert.equal(ahmed.delivery, 20);
});

test("keeps customers who have never ordered, with zeroes", () => {
  const rows = buildCustomerPdfRows([customer({ id: "new", name: "New Shop" })], [], { now: NOW });
  assert.equal(rows.length, 1, "a customer list must not silently drop new customers");
  assert.equal(rows[0]!.orders, 0);
  assert.equal(rows[0]!.totalPurchased, 0);
  assert.equal(rows[0]!.tier, "none");
  assert.equal(rows[0]!.lastOrder, null);
});

test("archived customers are excluded unless asked for", () => {
  const customers = [
    customer({ id: "a", name: "Active" }),
    customer({ id: "z", name: "Gone", isActive: false }),
  ];
  assert.deepEqual(
    buildCustomerPdfRows(customers, [], { now: NOW }).map((r) => r.id),
    ["a"],
  );
  assert.deepEqual(
    buildCustomerPdfRows(customers, [], { now: NOW, includeArchived: true }).map((r) => r.id).sort(),
    ["a", "z"],
  );
});

test("onlyUnpaid keeps just the customers who still owe", () => {
  const rows = buildCustomerPdfRows(
    [customer({ id: "owes", name: "Owes" }), customer({ id: "clear", name: "Clear" })],
    [
      invoice({ customerId: "owes", paid: 0, unpaid: 900 }),
      invoice({ customerId: "clear", paid: 1000, unpaid: 0 }),
    ],
    { now: NOW, onlyUnpaid: true },
  );
  assert.deepEqual(rows.map((r) => r.id), ["owes"]);
});

test("rows come out sorted by name", () => {
  const rows = buildCustomerPdfRows(
    [
      customer({ id: "3", name: "Zubair" }),
      customer({ id: "1", name: "Ahmed" }),
      customer({ id: "2", name: "Mehmood" }),
    ],
    [],
    { now: NOW },
  );
  assert.deepEqual(rows.map((r) => r.name), ["Ahmed", "Mehmood", "Zubair"]);
});

test("last order date is the most recent invoice, not the last one listed", () => {
  const rows = buildCustomerPdfRows(
    [customer({ id: "a", name: "Ahmed" })],
    [
      invoice({ customerId: "a", orderDate: day(30) }),
      invoice({ customerId: "a", orderDate: day(2) }),
      invoice({ customerId: "a", orderDate: day(11) }),
    ],
    { now: NOW },
  );
  assert.equal(rows[0]!.lastOrder?.getTime(), day(2).getTime());
});

test("empty contact fields print as a dash rather than blank", () => {
  const rows = buildCustomerPdfRows([customer({ id: "a", name: "Ahmed" })], [], { now: NOW });
  assert.equal(customerCellValue(rows[0]!, "phone"), "—");
  assert.equal(customerCellValue(rows[0]!, "address"), "—");
  assert.equal(customerCellValue(rows[0]!, "status"), "Active");
});

test("totals row sums the money columns and leaves text columns blank", () => {
  const rows = buildCustomerPdfRows(
    [customer({ id: "a", name: "Ahmed" }), customer({ id: "b", name: "Bilal" })],
    [
      invoice({ customerId: "a", effectiveTotal: 1000, paid: 600, unpaid: 400 }),
      invoice({ customerId: "b", effectiveTotal: 500, paid: 500, unpaid: 0 }),
    ],
    { now: NOW },
  );

  const totals = customerTotalsRow(rows, ["phone", "totalPurchased", "unpaid"]);
  assert.equal(totals[0], "Total — 2 customers");
  assert.equal(totals[1], "", "phone has nothing to total");
  assert.equal(totals[2], "1,500");
  assert.equal(totals[3], "400");
});

test("a single customer is described in the singular", () => {
  const rows = buildCustomerPdfRows([customer({ id: "a", name: "Ahmed" })], [], { now: NOW });
  assert.equal(customerTotalsRow(rows, [])[0], "Total — 1 customer");
});
