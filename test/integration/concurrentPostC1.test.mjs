/**
 * C1 — the acceptance test for M2 (§12.4). QUARANTINED: it is EXPECTED TO FAIL
 * against current code, demonstrating the historical stale-snapshot defect (F1 /
 * §2.2 H1). M2's Option A fix (anchor-first, recompute-in-callback) turns it green.
 * Run: npm run test:c1   (NOT in the blocking CI set until M2 lands.)
 *
 * The defect: postInvoice computes its FIFO dirty-estimate and lot snapshot BEFORE
 * runTransaction and never recomputes them on a Firestore retry. So on retry, FIFO
 * spills into a lot the stale estimate did not flag; that lot is written from stale
 * data, silently erasing a concurrent decrement → lotSum > book.
 *
 * Deterministic reproduction (via the postInvoice test seam):
 *   Product P: L1 (older, qty 5) + L2 (newer, qty 10), book 15.
 *   Invoice A needs 8 → FIFO spans L1(5)+L2(3), estimate {L1,L2}.
 *   Invoice B needs 3 → FIFO L1(3), estimate {L1} ONLY.
 *   Pause B after its reads → A commits (L1 0, L2 7, book 7) → release B.
 *   B retries with its STALE estimate {L1} and STALE L2=10, writes L2=7 (erasing
 *   A's L2 consumption), book 4. Result: L1 0 + L2 7 = lotSum 7 != book 4.
 *
 * C1 asserts P1 (book == Σ lot qty). It FAILS now (drift +3); it PASSES after M2.
 */

// Dummy client config so getAuthClient() (used only for an optional token) does
// not throw; currentUser stays null, so postInvoice's auth branches are skipped.
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= "test-api-key";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= "wholesale-rules-test.firebaseapp.com";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= "wholesale-rules-test";
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||= "wholesale-rules-test.appspot.com";
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||= "0";
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= "1:0:web:0";

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, setDoc, Timestamp } from "firebase/firestore";
import { postInvoice, __setPostInvoiceConcurrencyHook } from "@/lib/firestore/invoices";

let testEnv;
let db;

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function seed() {
  const t = (ms) => Timestamp.fromMillis(ms);
  await setDoc(doc(db, "products", "P"), { name: "P", cost_price: 10, sale_price: 20, stock_quantity: 15, created_at: t(1) });
  await setDoc(doc(db, "stock_lots", "L1"), { product_id: "P", unit_cost: 10, qty_in: 5, qty_remaining: 5, source: "stock_in", warehouse_id: "default", received_at: t(1000), created_at: t(1000), updated_at: t(1000) });
  await setDoc(doc(db, "stock_lots", "L2"), { product_id: "P", unit_cost: 10, qty_in: 10, qty_remaining: 10, source: "stock_in", warehouse_id: "default", received_at: t(2000), created_at: t(2000), updated_at: t(2000) });

  const draft = (order, qty, itemId) => ({
    customer_id: "c1", order_id: order, status: "draft", payment_status: "unpaid", paid_amount: 0,
    stock_reversal_applied: false, item_ids: [itemId], subtotal_amount: 20 * qty, discount_amount: 0,
    delivery_charge: 0, total_amount: 20 * qty, created_at: t(1), updated_at: t(1),
  });
  const item = (order, qty) => ({
    invoice_id: undefined, order_id: order, customer_id: "c1", product_id: "P", quantity: qty,
    unit_price: 20, line_discount: 0, line_delivery_charge: 0, line_total: 20 * qty, created_at: t(1), updated_at: t(1),
  });
  await setDoc(doc(db, "invoices", "INV-A"), draft("INV-A", 8, "A-ITEM"));
  await setDoc(doc(db, "invoice_items", "A-ITEM"), { ...item("INV-A", 8), invoice_id: "INV-A" });
  await setDoc(doc(db, "invoices", "INV-B"), draft("INV-B", 3, "B-ITEM"));
  await setDoc(doc(db, "invoice_items", "B-ITEM"), { ...item("INV-B", 3), invoice_id: "INV-B" });
}

async function bookAndLotSum() {
  const p = await getDocs(collection(db, "products"));
  const book = p.docs.find((d) => d.id === "P").data().stock_quantity;
  const lots = await getDocs(collection(db, "stock_lots"));
  const lotSum = lots.docs.filter((d) => d.data().product_id === "P").reduce((s, d) => s + (d.data().qty_remaining ?? 0), 0);
  return { book, lotSum };
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run via emulators:exec");
  // Create the DEFAULT app first (valid config) so getFirebaseApp() -> getApps()[0]
  // resolves to it rather than rules-unit-testing's keyless app. getAuthClient()
  // then initialises offline with currentUser null (postInvoice's auth is skipped).
  initializeApp({
    apiKey: "AIzaSyDUMMYKEYFORC1EMULATORTESTINGONLY000",
    authDomain: "wholesale-rules-test.firebaseapp.com",
    projectId: "wholesale-rules-test",
    storageBucket: "wholesale-rules-test.appspot.com",
    messagingSenderId: "0",
    appId: "1:0:web:0",
  });
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: {
      rules: "rules_version='2';\nservice cloud.firestore{match /databases/{db}/documents{match /{d=**}{allow read,write:if true;}}}",
      host: "127.0.0.1",
      port: 8080,
    },
  });
  db = testEnv.unauthenticatedContext().firestore();
});
after(async () => { __setPostInvoiceConcurrencyHook(null); await testEnv.cleanup(); });

describe("C1 — concurrent posts, FIFO spill, stale snapshot (QUARANTINED, expected FAIL pre-M2)", () => {
  it("keeps P1 (book == Σ lot qty) under two concurrent posts", async () => {
    await testEnv.clearFirestore();
    await seed();

    const bRead = deferred();
    const aCommitted = deferred();
    // Pause invoice B after its reads on attempt 1, until A has committed.
    __setPostInvoiceConcurrencyHook(async ({ invoiceId, attempt }) => {
      if (invoiceId === "INV-B" && attempt === 1) {
        bRead.resolve();
        await aCommitted.promise;
      }
    });

    const pB = postInvoice(db, "INV-B"); // pauses mid-transaction
    await bRead.promise;
    await postInvoice(db, "INV-A");      // commits: L1 0, L2 7, book 7
    aCommitted.resolve();
    await pB;                             // B retries with stale estimate/snapshot

    const { book, lotSum } = await bookAndLotSum();
    // This assertion FAILS against current code (book 4, lotSum 7 — phantom +3),
    // and PASSES once M2 recomputes the FIFO set inside the transaction.
    assert.equal(lotSum, book, `P1 violated: book ${book} != lotSum ${lotSum} (phantom ${lotSum - book})`);
  });
});
