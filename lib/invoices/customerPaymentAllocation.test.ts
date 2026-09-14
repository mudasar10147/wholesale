/**
 * Run: npm run test:customer-payment
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appliedLines,
  paymentPlanProblem,
  planCustomerPayment,
  samePaymentSplit,
  type PaymentAllocationInvoice,
} from "./customerPaymentAllocation.ts";

function at(iso: string) {
  return { toMillis: () => new Date(iso).getTime() };
}

function posted(
  id: string,
  total: number,
  postedAt: string,
  extra: Partial<PaymentAllocationInvoice> = {},
): PaymentAllocationInvoice {
  return {
    id,
    order_id: id,
    status: "posted",
    total_amount: total,
    posted_total_amount: total,
    paid_amount: 0,
    posted_at: at(postedAt),
    created_at: at(postedAt),
    ...extra,
  };
}

test("settles the oldest invoice first and carries the rest to the next", () => {
  const plan = planCustomerPayment(
    [posted("INV-B", 4000, "2026-09-05"), posted("INV-A", 2500, "2026-09-01")],
    5000,
  );

  assert.equal(paymentPlanProblem(plan), null);
  assert.equal(plan.totalDue, 6500);
  assert.equal(plan.excess, 0);
  assert.equal(plan.dueAfter, 1500);
  assert.deepEqual(
    plan.lines.map((l) => [l.orderId, l.applied, l.dueAfter, l.paymentStatusAfter]),
    [
      ["INV-A", 2500, 0, "paid"],
      ["INV-B", 2500, 1500, "partial"],
    ],
  );
});

test("a payment larger than everything owed is refused, not partly recorded", () => {
  const plan = planCustomerPayment([posted("INV-A", 2500, "2026-09-01")], 5000);

  assert.equal(paymentPlanProblem(plan), "exceeds_due");
  assert.equal(plan.totalDue, 2500);
  assert.equal(plan.excess, 2500);
});

test("the payment stops at the invoice it runs out on; later invoices are untouched", () => {
  const plan = planCustomerPayment(
    [
      posted("INV-A", 1000, "2026-09-01"),
      posted("INV-B", 1000, "2026-09-02"),
      posted("INV-C", 1000, "2026-09-03"),
    ],
    1500,
  );

  assert.deepEqual(
    plan.lines.map((l) => [l.orderId, l.applied]),
    [
      ["INV-A", 1000],
      ["INV-B", 500],
      ["INV-C", 0],
    ],
  );
  assert.deepEqual(
    appliedLines(plan).map((l) => l.orderId),
    ["INV-A", "INV-B"],
  );
  assert.equal(plan.lines[2]!.paymentStatusAfter, "unpaid");
});

test("orders by posting date, falls back to creation date, and breaks ties by order id", () => {
  const plan = planCustomerPayment(
    [
      posted("INV-3", 100, "2026-09-03"),
      posted("INV-2b", 100, "2026-09-02"),
      posted("INV-2a", 100, "2026-09-02"),
      { ...posted("INV-1", 100, "2026-01-01"), posted_at: null, created_at: at("2026-09-01") },
    ],
    400,
  );

  assert.deepEqual(
    plan.lines.map((l) => l.orderId),
    ["INV-1", "INV-2a", "INV-2b", "INV-3"],
  );
});

test("only posted invoices with a balance take part", () => {
  const plan = planCustomerPayment(
    [
      { ...posted("DRAFT", 900, "2026-09-01"), status: "draft" },
      { ...posted("VOID", 900, "2026-09-01"), status: "void" },
      posted("PAID", 900, "2026-09-01", { paid_amount: 900 }),
      posted("OPEN", 900, "2026-09-02"),
    ],
    900,
  );

  assert.deepEqual(
    plan.lines.map((l) => l.orderId),
    ["OPEN"],
  );
  assert.equal(plan.totalDue, 900);
});

test("starts from what is already paid and what was returned", () => {
  const plan = planCustomerPayment(
    [
      posted("PART", 3000, "2026-09-01", { paid_amount: 500 }),
      posted("RETURNED", 3000, "2026-09-02", { returned_amount: 1000 }),
    ],
    4500,
  );

  assert.equal(plan.totalDue, 4500);
  assert.deepEqual(
    plan.lines.map((l) => [l.orderId, l.paidBefore, l.dueBefore, l.applied, l.paidAfter, l.paymentStatusAfter]),
    [
      ["PART", 500, 2500, 2500, 3000, "paid"],
      ["RETURNED", 0, 2000, 2000, 2000, "paid"],
    ],
  );
  assert.equal(plan.dueAfter, 0);
});

test("holds back invoices whose counter-sale returns are still finalizing", () => {
  const plan = planCustomerPayment(
    [
      posted("PENDING", 800, "2026-09-01", { returns_post_status: "pending" }),
      posted("OPEN", 500, "2026-09-02"),
    ],
    500,
  );

  assert.deepEqual(
    plan.held.map((h) => [h.orderId, h.amountDue, h.reason]),
    [["PENDING", 800, "returns_pending"]],
  );
  assert.deepEqual(
    plan.lines.map((l) => l.orderId),
    ["OPEN"],
  );
  assert.equal(plan.totalDue, 500);
  assert.equal(paymentPlanProblem(plan), null);
});

test("splits in whole cents, so the parts add back to the payment exactly", () => {
  const plan = planCustomerPayment(
    [
      posted("A", 33.33, "2026-09-01"),
      posted("B", 33.33, "2026-09-02"),
      posted("C", 33.34, "2026-09-03"),
    ],
    100,
  );

  const appliedCents = plan.lines.reduce((sum, l) => sum + Math.round(l.applied * 100), 0);
  assert.equal(appliedCents, 10000);
  assert.ok(plan.lines.every((l) => l.paymentStatusAfter === "paid"));
  assert.equal(plan.excess, 0);
  assert.equal(plan.dueAfter, 0);
});

test("a leftover of a cent or less counts as settled, like the single-invoice payment", () => {
  const plan = planCustomerPayment([posted("DUST", 100, "2026-09-01", { paid_amount: 99.99 })], 5);

  assert.equal(paymentPlanProblem(plan), "nothing_due");
  assert.equal(plan.lines.length, 0);
});

test("rejects amounts that are not a positive number", () => {
  const invoices = [posted("A", 100, "2026-09-01")];
  for (const amount of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(paymentPlanProblem(planCustomerPayment(invoices, amount)), "invalid_amount", String(amount));
  }
});

test("reports nothing due when the customer owes nothing on posted invoices", () => {
  const plan = planCustomerPayment([{ ...posted("DRAFT", 900, "2026-09-01"), status: "draft" }], 100);
  assert.equal(paymentPlanProblem(plan), "nothing_due");
});

test("samePaymentSplit compares invoices and amounts to the cent", () => {
  const a = [
    { invoiceId: "A", applied: 2500 },
    { invoiceId: "B", applied: 2500 },
  ];
  assert.equal(samePaymentSplit(a, [...a]), true);
  assert.equal(samePaymentSplit(a, [{ invoiceId: "A", applied: 2500 }]), false);
  assert.equal(
    samePaymentSplit(a, [
      { invoiceId: "A", applied: 2500 },
      { invoiceId: "B", applied: 2499.99 },
    ]),
    false,
  );
  assert.equal(
    samePaymentSplit(a, [
      { invoiceId: "B", applied: 2500 },
      { invoiceId: "A", applied: 2500 },
    ]),
    false,
  );
});
