/**
 * One payment spread across a customer's invoices, driven through the REAL
 * recordCustomerPayment against the REAL firestore.rules.
 * Run: npm run test:customer-payment-emulator   (boots the Firestore emulator, so it needs Java)
 *
 * The allocation maths is covered by lib/invoices/customerPaymentAllocation.test.ts. This
 * proves the parts that only exist in Firestore: every write passes the posted-invoice
 * payment rule, the whole payment is one all-or-nothing transaction, and a clerk cannot
 * record one.
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { PaymentSplitChangedError, recordCustomerPayment } from "@/lib/firestore/customerPayments";

let testEnv;

const t = (iso) => Timestamp.fromDate(new Date(iso));

function adminDb() {
  return testEnv.authenticatedContext("admin-user", { admin: true }).firestore();
}
function clerkDb() {
  return testEnv.authenticatedContext("clerk-user", { role: "clerk" }).firestore();
}

/** A posted invoice in the exact shape postInvoice leaves behind. */
function postedInvoice(orderId, customerId, total, postedAt, extra = {}) {
  return {
    customer_id: customerId,
    order_id: orderId,
    status: "posted",
    payment_status: "unpaid",
    paid_amount: 0,
    stock_reversal_applied: false,
    item_ids: [`${orderId}-ITEM`],
    subtotal_amount: total,
    discount_amount: 0,
    delivery_charge: 0,
    total_amount: total,
    posted_subtotal_amount: total,
    posted_discount_amount: 0,
    posted_delivery_charge: 0,
    posted_total_amount: total,
    posted_cogs_amount: total / 2,
    posted_at: t(postedAt),
    created_at: t(postedAt),
    updated_at: t(postedAt),
    ...extra,
  };
}

async function seed(invoices) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, data] of Object.entries(invoices)) {
      await setDoc(doc(db, "invoices", id), data);
    }
  });
}

async function readInvoice(id) {
  let data;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), "invoices", id))).data();
  });
  return data;
}

async function paidAmounts(ids) {
  const out = {};
  for (const id of ids) {
    const inv = await readInvoice(id);
    out[id] = [inv.paid_amount, inv.payment_status];
  }
  return out;
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run via emulators:exec");
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(async () => {
  await testEnv.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed({
    "INV-OLD": postedInvoice("INV-OLD", "c1", 2500, "2026-09-01T10:00:00Z"),
    "INV-NEW": postedInvoice("INV-NEW", "c1", 4000, "2026-09-05T10:00:00Z"),
    "INV-DRAFT": {
      ...postedInvoice("INV-DRAFT", "c1", 900, "2026-08-01T10:00:00Z"),
      status: "draft",
      posted_at: null,
    },
    "INV-OTHER": postedInvoice("INV-OTHER", "c2", 700, "2026-08-01T10:00:00Z"),
  });
});

const ALL = ["INV-OLD", "INV-NEW", "INV-DRAFT", "INV-OTHER"];
const UNTOUCHED = {
  "INV-OLD": [0, "unpaid"],
  "INV-NEW": [0, "unpaid"],
  "INV-DRAFT": [0, "unpaid"],
  "INV-OTHER": [0, "unpaid"],
};

describe("recordCustomerPayment against the real rules", () => {
  it("settles the oldest invoice and carries the rest to the next", async () => {
    const plan = await recordCustomerPayment(adminDb(), { customerId: "c1", amount: 5000 });

    assert.equal(plan.dueAfter, 1500);
    assert.deepEqual(await paidAmounts(ALL), {
      "INV-OLD": [2500, "paid"],
      "INV-NEW": [2500, "partial"],
      "INV-DRAFT": [0, "unpaid"],
      "INV-OTHER": [0, "unpaid"],
    });
  });

  it("a second payment continues from where the first left off", async () => {
    await recordCustomerPayment(adminDb(), { customerId: "c1", amount: 5000 });
    await recordCustomerPayment(adminDb(), { customerId: "c1", amount: 1500 });

    assert.deepEqual((await paidAmounts(["INV-OLD", "INV-NEW"]))["INV-NEW"], [4000, "paid"]);
  });

  it("refuses more than the customer owes and writes nothing", async () => {
    await assert.rejects(
      recordCustomerPayment(adminDb(), { customerId: "c1", amount: 7000 }),
      /more than this customer owes/,
    );
    assert.deepEqual(await paidAmounts(ALL), UNTOUCHED);
  });

  it("refuses when balances moved since the preview the admin confirmed", async () => {
    await assert.rejects(
      recordCustomerPayment(adminDb(), {
        customerId: "c1",
        amount: 5000,
        expectedSplit: [{ invoiceId: "INV-OLD", applied: 5000 }],
      }),
      PaymentSplitChangedError,
    );
    assert.deepEqual(await paidAmounts(ALL), UNTOUCHED);
  });

  it("a clerk cannot record a payment", async () => {
    await assertFails(recordCustomerPayment(clerkDb(), { customerId: "c1", amount: 1000 }));
    assert.deepEqual(await paidAmounts(ALL), UNTOUCHED);
  });
});
