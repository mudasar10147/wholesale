/**
 * Settling the few rupees left when a bill is rounded down at the counter, driven
 * through the REAL recordInvoicePayment against the REAL firestore.rules.
 * Run: npm run test:invoice-settlement-emulator   (boots the Firestore emulator, needs Java)
 *
 * The offer logic is covered by lib/invoices/paymentSettlement.test.ts. This proves the
 * parts that only exist in Firestore: the payment and the settlement are two separate
 * writes (the rules refuse one write that both raises paid_amount and changes the
 * discount), both pass the posted-invoice rules, and a failed settlement still leaves
 * the payment recorded.
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { recordInvoicePayment, settleInvoiceRemainder } from "@/lib/firestore/invoices";

let testEnv;
const t = (iso) => Timestamp.fromDate(new Date(iso));
const adminDb = () => testEnv.authenticatedContext("admin-user", { admin: true }).firestore();
const clerkDb = () => testEnv.authenticatedContext("clerk-user", { role: "clerk" }).firestore();

/** A posted invoice shaped the way postInvoice leaves it. */
function postedInvoice({ orderId, subtotal, delivery = 0, discount = 0, paid = 0 }) {
  const total = subtotal - discount + delivery;
  return {
    customer_id: "c1",
    order_id: orderId,
    status: "posted",
    payment_status: paid <= 0 ? "unpaid" : paid >= total ? "paid" : "partial",
    paid_amount: paid,
    stock_reversal_applied: false,
    item_ids: [`${orderId}-ITEM`],
    subtotal_amount: subtotal,
    discount_amount: discount,
    delivery_charge: delivery,
    total_amount: total,
    posted_subtotal_amount: subtotal,
    posted_discount_amount: discount,
    posted_delivery_charge: delivery,
    posted_total_amount: total,
    posted_cogs_amount: subtotal * 0.8,
    posted_at: t("2026-09-10T10:00:00Z"),
    created_at: t("2026-09-10T10:00:00Z"),
    updated_at: t("2026-09-10T10:00:00Z"),
  };
}

async function seed(id, invoice) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "invoices", id), invoice);
  });
}

async function read(id) {
  let data;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), "invoices", id))).data();
  });
  return data;
}

const money = (inv) => ({
  paid: inv.paid_amount,
  status: inv.payment_status,
  discount: inv.discount_amount,
  total: inv.total_amount,
  postedTotal: inv.posted_total_amount,
  postedDiscount: inv.posted_discount_amount,
});

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run via emulators:exec");
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

describe("settling a rounded-down payment, against the real rules", () => {
  it("1,600 paid on a 1,630 bill closes it, with 30 booked as a discount", async () => {
    await seed("INV-1630", postedInvoice({ orderId: "INV-1630", subtotal: 1630 }));

    const result = await recordInvoicePayment(adminDb(), "INV-1630", 1600, { settleRemainder: true });

    assert.equal(result.settledAmount, 30);
    assert.deepEqual(money(await read("INV-1630")), {
      paid: 1600,
      status: "paid",
      discount: 30,
      total: 1600,
      postedTotal: 1600,
      postedDiscount: 30,
    });
  });

  it("keeps the delivery charge intact when the total is rebuilt", async () => {
    await seed("INV-DELIV", postedInvoice({ orderId: "INV-DELIV", subtotal: 1600, delivery: 30 }));

    await recordInvoicePayment(adminDb(), "INV-DELIV", 1600, { settleRemainder: true });

    const inv = await read("INV-DELIV");
    assert.equal(inv.delivery_charge, 30);
    assert.deepEqual(money(inv), {
      paid: 1600, status: "paid", discount: 30, total: 1600, postedTotal: 1600, postedDiscount: 30,
    });
  });

  it("adds to a discount the invoice already carries", async () => {
    await seed("INV-DISC", postedInvoice({ orderId: "INV-DISC", subtotal: 1700, discount: 70 }));

    await recordInvoicePayment(adminDb(), "INV-DISC", 1600, { settleRemainder: true });

    assert.deepEqual(money(await read("INV-DISC")), {
      paid: 1600, status: "paid", discount: 100, total: 1600, postedTotal: 1600, postedDiscount: 100,
    });
  });

  it("settles what is left after an earlier part payment", async () => {
    await seed("INV-PART", postedInvoice({ orderId: "INV-PART", subtotal: 1630, paid: 1000 }));

    await recordInvoicePayment(adminDb(), "INV-PART", 600, { settleRemainder: true });

    assert.deepEqual(money(await read("INV-PART")), {
      paid: 1600, status: "paid", discount: 30, total: 1600, postedTotal: 1600, postedDiscount: 30,
    });
  });

  it("without the option, the remainder simply stays due", async () => {
    await seed("INV-KEEP", postedInvoice({ orderId: "INV-KEEP", subtotal: 1630 }));

    const result = await recordInvoicePayment(adminDb(), "INV-KEEP", 1600);

    assert.equal(result.settledAmount, 0);
    assert.deepEqual(money(await read("INV-KEEP")), {
      paid: 1600, status: "partial", discount: 0, total: 1630, postedTotal: 1630, postedDiscount: 0,
    });
  });

  it("refuses more than the cap, and the payment still stands", async () => {
    await seed("INV-BIG", postedInvoice({ orderId: "INV-BIG", subtotal: 1630 }));

    await assert.rejects(
      recordInvoicePayment(adminDb(), "INV-BIG", 1400, { settleRemainder: true }),
      /more than the 100 that can be settled[\s\S]*Apply discount/,
    );
    assert.deepEqual(money(await read("INV-BIG")), {
      paid: 1400, status: "partial", discount: 0, total: 1630, postedTotal: 1630, postedDiscount: 0,
    });
  });

  it("a clerk cannot settle a remainder", async () => {
    await seed("INV-CLERK", postedInvoice({ orderId: "INV-CLERK", subtotal: 1630, paid: 1600 }));

    await assertFails(settleInvoiceRemainder(clerkDb(), "INV-CLERK"));
    assert.deepEqual(money(await read("INV-CLERK")), {
      paid: 1600, status: "partial", discount: 0, total: 1630, postedTotal: 1630, postedDiscount: 0,
    });
  });

  it("settling an invoice that owes nothing changes nothing", async () => {
    await seed("INV-PAID", postedInvoice({ orderId: "INV-PAID", subtotal: 1630, paid: 1630 }));

    assert.equal(await settleInvoiceRemainder(adminDb(), "INV-PAID"), 0);
    assert.deepEqual(money(await read("INV-PAID")), {
      paid: 1630, status: "paid", discount: 0, total: 1630, postedTotal: 1630, postedDiscount: 0,
    });
  });
});
