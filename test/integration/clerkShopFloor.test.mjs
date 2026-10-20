/**
 * What a clerk can actually do, driven through the REAL app functions against the
 * REAL firestore.rules.
 * Run: npm run test:clerk-shop-floor-emulator   (boots the Firestore emulator, needs Java)
 *
 * Opening the shop floor to clerks was a rules change across a dozen collections, and
 * posting an invoice writes to five of them inside ONE transaction — invoices, products,
 * stock_lots, lot_consumptions and invoice_item_cogs, plus a sales row. Miss any single
 * one and the whole post fails with permission-denied. A page-by-page click-through would
 * not prove that; this does.
 *
 * The other half matters just as much: the money the shop holds, and who may use the app,
 * stay with the admin. Those denials are asserted in test/rules/roles.rules.test.mjs.
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, Timestamp } from "firebase/firestore";
import { postInvoice, recordInvoicePayment, voidInvoice } from "@/lib/firestore/invoices";
import { updateProductSalePrice } from "@/lib/firestore/products";

let testEnv;
const t = (ms) => Timestamp.fromMillis(ms);

const clerkDb = () =>
  testEnv.authenticatedContext("clerk-user", { role: "clerk" }).firestore();
const socialDb = () =>
  testEnv.authenticatedContext("social-user", { role: "social" }).firestore();

/**
 * Order ids are at least 6 characters — several rule validators insist on it
 * (`order_id.size() >= 6`), so a tidy "INV-1" seed is refused by the rules and looks
 * exactly like a missing permission.
 */
async function seedShop() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "customers", "c1"), { name: "Big Buyer", is_active: true });
    await setDoc(doc(db, "products", "P"), {
      name: "Widget", cost_price: 10, sale_price: 20, stock_quantity: 15, created_at: t(1),
    });
    await setDoc(doc(db, "stock_lots", "L1"), {
      product_id: "P", unit_cost: 10, qty_in: 15, qty_remaining: 15, source: "stock_in",
      trader_id: "t1", warehouse_id: "default", received_at: t(1), created_at: t(1), updated_at: t(1),
    });
    await setDoc(doc(db, "invoices", "INV-100001"), {
      customer_id: "c1", order_id: "INV-100001", status: "draft", payment_status: "unpaid",
      paid_amount: 0, stock_reversal_applied: false, item_ids: ["ITEM-100001"],
      subtotal_amount: 80, discount_amount: 0, delivery_charge: 0, total_amount: 80,
      created_at: t(1), updated_at: t(1),
    });
    await setDoc(doc(db, "invoice_items", "ITEM-100001"), {
      invoice_id: "INV-100001", order_id: "INV-100001", customer_id: "c1", product_id: "P", quantity: 4,
      unit_price: 20, line_discount: 0, line_delivery_charge: 0, line_total: 80,
      created_at: t(1), updated_at: t(1),
    });
  });
}

/** Read back with the clerk's own credentials — reading the result is part of the job. */
async function readAs(db, collectionName, id) {
  return (await getDoc(doc(db, collectionName, id))).data();
}
async function countWhere(db, collectionName, predicate) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.filter((d) => predicate(d.data())).length;
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run via emulators:exec");
  // postInvoice pre-warms the ID token, so the client SDK needs an app to exist.
  initializeApp({
    apiKey: "fake-api-key", authDomain: "wholesale-rules-test.firebaseapp.com",
    projectId: "wholesale-rules-test", storageBucket: "wholesale-rules-test.appspot.com",
    messagingSenderId: "0", appId: "1:0:web:0",
  });
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); await seedShop(); });

describe("a clerk can run the shop floor", () => {
  it("posts an invoice: stock moves, the lot is consumed, COGS is written", async () => {
    const db = clerkDb();

    await postInvoice(db, "INV-100001");

    const invoice = await readAs(db, "invoices", "INV-100001");
    assert.equal(invoice.status, "posted");
    assert.equal(invoice.posted_total_amount, 80);
    assert.equal(invoice.posted_cogs_amount, 40); // 4 units at cost 10

    assert.equal((await readAs(db, "products", "P")).stock_quantity, 11);
    assert.equal((await readAs(db, "stock_lots", "L1")).qty_remaining, 11);
    assert.equal(await countWhere(db, "lot_consumptions", (d) => d.invoice_id === "INV-100001"), 1);
    assert.equal((await readAs(db, "invoice_item_cogs", "ITEM-100001")).cogs_amount, 40);
    assert.equal(await countWhere(db, "sales", (d) => d.order_id === "INV-100001"), 1);
  });

  it("records a payment against what it just posted", async () => {
    const db = clerkDb();
    await postInvoice(db, "INV-100001");

    await recordInvoicePayment(db, "INV-100001", 50);

    const invoice = await readAs(db, "invoices", "INV-100001");
    assert.equal(invoice.paid_amount, 50);
    assert.equal(invoice.payment_status, "partial");
  });

  it("settles the few rupees left when the customer rounds down", async () => {
    const db = clerkDb();
    await postInvoice(db, "INV-100001");

    const result = await recordInvoicePayment(db, "INV-100001", 75, { settleRemainder: true });

    assert.equal(result.settledAmount, 5);
    const invoice = await readAs(db, "invoices", "INV-100001");
    assert.equal(invoice.payment_status, "paid");
    assert.equal(invoice.discount_amount, 5);
  });

  it("voids a posted invoice, putting the stock back", async () => {
    const db = clerkDb();
    await postInvoice(db, "INV-100001");

    await voidInvoice(db, "INV-100001");

    assert.equal((await readAs(db, "invoices", "INV-100001")).status, "void");
    assert.equal((await readAs(db, "products", "P")).stock_quantity, 15);
    assert.equal((await readAs(db, "stock_lots", "L1")).qty_remaining, 15);
  });

  it("re-prices a product without buying anything", async () => {
    const db = clerkDb();

    await updateProductSalePrice(db, "P", 24);

    assert.equal((await readAs(db, "products", "P")).sale_price, 24);
  });

  it("but a social user is still nowhere near any of it", async () => {
    await assertFails(getDoc(doc(socialDb(), "invoices", "INV-100001")));
    await assertFails(postInvoice(socialDb(), "INV-100001"));
  });
});
