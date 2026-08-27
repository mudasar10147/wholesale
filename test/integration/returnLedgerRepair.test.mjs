/**
 * Return ledger repair — the three return shapes, and what repair may touch.
 *
 * Run: npm run test:return-ledger-repair
 *
 * Repair used to be a second copy of the post-time ledger logic, and both copies
 * shared a silent hole: `if (lines.length === 0) return;`. A return whose lines
 * were ALL discarded restocks nothing, produced no ledger lines, and fell out
 * without ever clearing `ledger_status: "pending"`. It stayed under R7 for ever
 * and pressing Repair appeared to succeed while doing nothing.
 *
 * The three shapes now have explicit outcomes, and the all-discard one reaches an
 * honest terminal state rather than being papered over with a fabricated
 * zero-quantity movement.
 */

process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= "AIzaSyDUMMYKEYFORREPAIRTEST00000000";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= "wholesale-rules-test.firebaseapp.com";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= "wholesale-rules-test";
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||= "wholesale-rules-test.appspot.com";
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||= "0";
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= "1:0:web:0";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import { initializeApp as initAdminApp, deleteApp as deleteAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { postInvoice } from "@/lib/firestore/invoices";
import { createReturnDraft, postReturn } from "@/lib/firestore/invoiceReturns";
import { repairReturnLedger } from "@/lib/inventory/repairLedger";

let testEnv, db, adminApp, adminDb;
const t = (ms) => Timestamp.fromMillis(ms);
const OPERATOR = "operator-uid-1";

async function seedPostedSale(invId, itemId, qty) {
  await setDoc(doc(db, "products", "P"), {
    name: "P", cost_price: 10, sale_price: 20, stock_quantity: 100, created_at: t(1),
  });
  await setDoc(doc(db, "stock_lots", "P-L1"), {
    product_id: "P", unit_cost: 10, qty_in: 100, qty_remaining: 100, source: "stock_in",
    trader_id: "t1", warehouse_id: "default", received_at: t(1000), created_at: t(1000), updated_at: t(1000),
  });
  const total = 20 * qty;
  await setDoc(doc(db, "invoices", invId), {
    customer_id: "c1", order_id: invId, status: "draft", payment_status: "unpaid", paid_amount: 0,
    stock_reversal_applied: false, item_ids: [itemId],
    subtotal_amount: total, discount_amount: 0, delivery_charge: 0, total_amount: total,
    created_at: t(1), updated_at: t(1),
  });
  await setDoc(doc(db, "invoice_items", itemId), {
    invoice_id: invId, order_id: invId, customer_id: "c1", product_id: "P", quantity: qty,
    unit_price: 20, line_discount: 0, line_delivery_charge: 0, line_total: total,
    created_at: t(1), updated_at: t(1),
  });
  await postInvoice(db, invId);
}

/** Post a return with the given restock/discard split, then wind its ledger back to STUCK. */
async function stuckReturn(invId, itemId, restock, discard) {
  const { returnId } = await createReturnDraft(db, {
    original_invoice_id: invId,
    lines: [{
      original_invoice_item_id: itemId, product_id: "P",
      quantity_returned: restock + discard, quantity_restock: restock, quantity_discard: discard,
    }],
    settlement_type: "reduce_balance",
  });
  await postReturn(db, returnId);

  // Reproduce the production state: stock settled, ledger never written.
  for (const c of ["inventory_transactions", "inventory_transaction_lines"]) {
    const snap = await adminDb.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await adminDb.collection("invoice_returns").doc(returnId).update({
    ledger_status: "pending",
    inventory_transaction_id: FieldValue.delete(),
  });
  return returnId;
}

const readReturn = async (id) => (await adminDb.collection("invoice_returns").doc(id).get()).data();
const ledgerHeaders = async () => (await adminDb.collection("inventory_transactions").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const ledgerLines = async () => (await adminDb.collection("inventory_transaction_lines").get()).docs.map((d) => d.data());

/** Everything ledger repair must leave completely alone. */
async function untouchableSnapshot() {
  const out = {};
  for (const c of ["products", "stock_lots", "lot_consumptions", "invoice_item_cogs", "cash_entries", "return_lot_restorations", "return_lot_write_offs", "invoice_payments"]) {
    const snap = await adminDb.collection(c).get();
    out[c] = snap.docs.map((d) => `${d.id}:${JSON.stringify(d.data())}`).sort();
  }
  const inv = await adminDb.collection("invoices").get();
  out.invoiceMoney = inv.docs
    .map((d) => {
      const v = d.data();
      return `${d.id}:${v.paid_amount}:${v.cash_received_amount ?? "-"}:${v.credit_applied_amount ?? "-"}:${v.returned_amount ?? "-"}`;
    })
    .sort();
  return JSON.stringify(out);
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run via emulators:exec");
  initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: "wholesale-rules-test.firebaseapp.com",
    projectId: "wholesale-rules-test", storageBucket: "wholesale-rules-test.appspot.com",
    messagingSenderId: "0", appId: "1:0:web:0",
  });
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: {
      rules: "rules_version='2';\nservice cloud.firestore{match /databases/{db}/documents{match /{d=**}{allow read,write:if true;}}}",
      host: "127.0.0.1", port: 8080,
    },
  });
  db = testEnv.unauthenticatedContext().firestore();
  adminApp = initAdminApp({ projectId: "wholesale-rules-test" }, "repair-admin");
  adminDb = getAdminFirestore(adminApp);
});
after(async () => { await deleteAdminApp(adminApp); await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

describe("return ledger repair — the three shapes", () => {
  it("ALL RESTOCK: writes a SALES_RETURN row for the restocked quantity", async () => {
    await seedPostedSale("INV-R1", "item-r1", 10);
    const returnId = await stuckReturn("INV-R1", "item-r1", 4, 0);

    const kind = await repairReturnLedger(db, returnId, OPERATOR);
    assert.equal(kind, "movement");

    const headers = await ledgerHeaders();
    assert.equal(headers.length, 1);
    assert.equal(headers[0].type, "SALES_RETURN");
    assert.equal(headers[0].posted_by_uid, OPERATOR, "G7: the repair is attributed");

    const lines = await ledgerLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].direction, "in");
    assert.equal(lines[0].quantity, 4);

    const ret = await readReturn(returnId);
    assert.equal(ret.ledger_status, "posted");
    assert.ok(ret.inventory_transaction_id);
  });

  it("MIXED: records only the restocked part, not the discarded units", async () => {
    await seedPostedSale("INV-R2", "item-r2", 10);
    const returnId = await stuckReturn("INV-R2", "item-r2", 3, 1);

    assert.equal(await repairReturnLedger(db, returnId, OPERATOR), "movement");

    const lines = await ledgerLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].quantity, 3, "the discarded unit never re-entered stock");
    assert.equal((await readReturn(returnId)).ledger_status, "posted");
  });

  it("ALL DISCARD: writes NO ledger row and reaches an honest terminal state", async () => {
    await seedPostedSale("INV-R3", "item-r3", 10);
    const returnId = await stuckReturn("INV-R3", "item-r3", 0, 4);

    const kind = await repairReturnLedger(db, returnId, OPERATOR);
    assert.equal(kind, "no_movement");

    assert.equal((await ledgerHeaders()).length, 0, "no fabricated movement");
    assert.equal((await ledgerLines()).length, 0, "no fake zero-quantity line");

    const ret = await readReturn(returnId);
    assert.equal(ret.ledger_status, "not_applicable", "honest: there was nothing to record");
    assert.ok(!ret.inventory_transaction_id, "and no ledger id pretending otherwise");
  });

  it("ALL DISCARD reaches not_applicable at POST time too, not only via repair", async () => {
    // The same hole existed in the post-time path, so a newly posted all-discard
    // return would have been born stuck.
    await seedPostedSale("INV-R4", "item-r4", 10);
    const { returnId } = await createReturnDraft(db, {
      original_invoice_id: "INV-R4",
      lines: [{
        original_invoice_item_id: "item-r4", product_id: "P",
        quantity_returned: 2, quantity_restock: 0, quantity_discard: 2,
      }],
      settlement_type: "reduce_balance",
    });
    await postReturn(db, returnId);

    assert.equal((await readReturn(returnId)).ledger_status, "not_applicable");
    // The sale's own SALE header is present; what must NOT exist is a return one.
    const returnHeaders = (await ledgerHeaders()).filter((h) => h.type === "SALES_RETURN");
    assert.equal(returnHeaders.length, 0, "no SALES_RETURN row for a return that restocked nothing");
  });
});

describe("return ledger repair — idempotency and blast radius", () => {
  for (const [label, restock, discard] of [
    ["all restock", 4, 0],
    ["mixed", 3, 1],
    ["all discard", 0, 4],
  ]) {
    it(`repeated repair is idempotent — ${label}`, async () => {
      await seedPostedSale("INV-R5", "item-r5", 10);
      const returnId = await stuckReturn("INV-R5", "item-r5", restock, discard);

      await repairReturnLedger(db, returnId, OPERATOR);
      const afterFirst = {
        ret: await readReturn(returnId),
        headers: (await ledgerHeaders()).map((h) => h.id).sort(),
        lines: (await ledgerLines()).map((l) => `${l.product_id}:${l.quantity}`).sort(),
      };

      await repairReturnLedger(db, returnId, OPERATOR);
      await repairReturnLedger(db, returnId, OPERATOR);

      const afterThird = {
        ret: await readReturn(returnId),
        headers: (await ledgerHeaders()).map((h) => h.id).sort(),
        lines: (await ledgerLines()).map((l) => `${l.product_id}:${l.quantity}`).sort(),
      };
      assert.deepEqual(afterThird.headers, afterFirst.headers, "no duplicate ledger");
      assert.deepEqual(afterThird.lines, afterFirst.lines);
      assert.equal(afterThird.ret.ledger_status, afterFirst.ret.ledger_status);
      assert.equal(afterThird.ret.inventory_transaction_id ?? null, afterFirst.ret.inventory_transaction_id ?? null);
    });
  }

  it("changes no stock, lot, consumption, COGS, restoration, write-off or cash record", async () => {
    await seedPostedSale("INV-R6", "item-r6", 10);
    const returnId = await stuckReturn("INV-R6", "item-r6", 3, 1);

    const before = await untouchableSnapshot();
    await repairReturnLedger(db, returnId, OPERATOR);
    await repairReturnLedger(db, returnId, OPERATOR);
    assert.equal(await untouchableSnapshot(), before, "repair records history, it does not re-do it");
  });

  it("refuses an unattributed repair", async () => {
    await seedPostedSale("INV-R7", "item-r7", 10);
    const returnId = await stuckReturn("INV-R7", "item-r7", 4, 0);
    // No signed-in user in this harness and no explicit uid.
    await assert.rejects(repairReturnLedger(db, returnId), /attributable/);
    assert.equal((await ledgerHeaders()).length, 0, "nothing written without a uid");
  });

  it("refuses to repair a return that is not posted", async () => {
    await seedPostedSale("INV-R8", "item-r8", 10);
    const { returnId } = await createReturnDraft(db, {
      original_invoice_id: "INV-R8",
      lines: [{
        original_invoice_item_id: "item-r8", product_id: "P",
        quantity_returned: 2, quantity_restock: 2, quantity_discard: 0,
      }],
      settlement_type: "reduce_balance",
    });
    await assert.rejects(repairReturnLedger(db, returnId, OPERATOR), /Only posted returns/);
  });

  it("never overwrites a ledger link that already exists", async () => {
    await seedPostedSale("INV-R9", "item-r9", 10);
    const returnId = await stuckReturn("INV-R9", "item-r9", 4, 0);
    await repairReturnLedger(db, returnId, OPERATOR);
    const linked = (await readReturn(returnId)).inventory_transaction_id;

    // An all-discard marking must not be able to clear a real ledger link.
    const { markReturnLedgerNotApplicable } = await import("@/lib/inventory/returnLedger");
    await markReturnLedgerNotApplicable(db, returnId);

    const ret = await readReturn(returnId);
    assert.equal(ret.inventory_transaction_id, linked);
    assert.equal(ret.ledger_status, "posted");
  });
});
