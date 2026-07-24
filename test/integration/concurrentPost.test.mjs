/**
 * Concurrency suite for the real postInvoice (§12.4). Proves M2's Option A fix:
 * the FIFO working set is recomputed from fresh lot data on every transaction
 * attempt (anchor-first), so concurrent operations never drift P1 / L6.
 * Run: npm run test:concurrency  (blocking CI — no longer quarantined).
 *
 *   C1  — two concurrent posts, FIFO spilling into a second lot (the historical F1).
 *   C2  — invoice posting vs a concurrent stock-in.
 *   C9  — a forced retry reads FRESH lot state (not the pre-retry snapshot).
 *   C11 — ten concurrent invoice posts.
 *
 * The complete invariant register is asserted after every mutation. P1 (book ==
 * Σ lot qty) and L6 (consumption chain) must stay green. A few LEDGER/attribution
 * findings are tolerated because this harness has no signed-in user and does not
 * run the M5 dispatcher — never P1/L6/stock findings.
 */

// Dummy client config so getAuthClient() initialises offline (currentUser null).
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= "AIzaSyDUMMYKEYFORC1EMULATORTESTINGONLY000";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= "wholesale-rules-test.firebaseapp.com";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= "wholesale-rules-test";
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||= "wholesale-rules-test.appspot.com";
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||= "0";
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= "1:0:web:0";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import { initializeApp as initAdminApp, deleteApp as deleteAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, runTransaction, setDoc, Timestamp } from "firebase/firestore";
import { postInvoice, __setPostInvoiceConcurrencyHook } from "@/lib/firestore/invoices";
import { validateInventoryData } from "@/lib/inventory/validateInventory";
import { loadAllInventory } from "@/lib/inventory/validationRun";

let testEnv;
let db; // client (rules-unit-testing) — drives postInvoice
let adminApp;
let adminDb; // firebase-admin — reads state for the full register assertion

const t = (ms) => Timestamp.fromMillis(ms);

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Ledger/attribution findings expected from an auth-less harness that doesn't run
// the M5 dispatcher. Stock invariants (P1/L6/L*/C*/I*) are NEVER allowed.
const ALLOW = new Set(["G2", "G6", "G7"]);

async function assertAllInvariants(label) {
  const report = validateInventoryData(await loadAllInventory(adminDb));
  const blocking = report.issues.filter(
    (i) => (i.severity === "CRITICAL" || i.severity === "ERROR") && !ALLOW.has(i.invariant_id),
  );
  assert.equal(blocking.length, 0, `${label}: unexpected blocking — ${blocking.map((i) => `${i.invariant_id} ${i.message}`).join(" | ")}`);
  assert.equal(report.issues.filter((i) => i.invariant_id === "P1").length, 0, `${label}: P1 not green`);
  assert.equal(report.issues.filter((i) => i.invariant_id === "L6").length, 0, `${label}: L6 not green`);
}

async function seedProduct(pid, book, lots) {
  await setDoc(doc(db, "products", pid), { name: pid, cost_price: 10, sale_price: 20, stock_quantity: book, created_at: t(1) });
  for (const l of lots) {
    await setDoc(doc(db, "stock_lots", l.id), {
      product_id: pid, unit_cost: 10, qty_in: l.qty_in, qty_remaining: l.qty, source: "stock_in",
      trader_id: "t1", warehouse_id: "default", received_at: t(l.r), created_at: t(l.r), updated_at: t(l.r),
    });
  }
}
async function seedDraft(invId, itemId, pid, qty) {
  await setDoc(doc(db, "invoices", invId), {
    customer_id: "c1", order_id: invId, status: "draft", payment_status: "unpaid", paid_amount: 0,
    stock_reversal_applied: false, item_ids: [itemId], subtotal_amount: 20 * qty, discount_amount: 0,
    delivery_charge: 0, total_amount: 20 * qty, created_at: t(1), updated_at: t(1),
  });
  await setDoc(doc(db, "invoice_items", itemId), {
    invoice_id: invId, order_id: invId, customer_id: "c1", product_id: pid, quantity: qty,
    unit_price: 20, line_discount: 0, line_delivery_charge: 0, line_total: 20 * qty, created_at: t(1), updated_at: t(1),
  });
}
/** A concurrent stock-in: co-writes the product anchor + appends a lot (like applyStockInInTransaction). */
async function concurrentStockIn(pid, lotId, qty, receivedMs) {
  await runTransaction(db, async (tx) => {
    const p = await tx.get(doc(db, "products", pid));
    const book = p.data().stock_quantity ?? 0;
    tx.set(doc(db, "stock_lots", lotId), {
      product_id: pid, unit_cost: 10, qty_in: qty, qty_remaining: qty, source: "stock_in",
      trader_id: "t1", warehouse_id: "default", received_at: t(receivedMs), created_at: t(receivedMs), updated_at: t(receivedMs),
    });
    tx.update(doc(db, "products", pid), { stock_quantity: book + qty });
  });
}
async function bookAndLotSum(pid) {
  const p = (await getDocs(collection(db, "products"))).docs.find((d) => d.id === pid).data();
  const lots = (await getDocs(collection(db, "stock_lots"))).docs.filter((d) => d.data().product_id === pid);
  return { book: p.stock_quantity, lotSum: lots.reduce((s, d) => s + (d.data().qty_remaining ?? 0), 0) };
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run via emulators:exec");
  initializeApp({ apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: "wholesale-rules-test.firebaseapp.com", projectId: "wholesale-rules-test", storageBucket: "wholesale-rules-test.appspot.com", messagingSenderId: "0", appId: "1:0:web:0" });
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: { rules: "rules_version='2';\nservice cloud.firestore{match /databases/{db}/documents{match /{d=**}{allow read,write:if true;}}}", host: "127.0.0.1", port: 8080 },
  });
  db = testEnv.unauthenticatedContext().firestore();
  adminApp = initAdminApp({ projectId: "wholesale-rules-test" }, "c-admin");
  adminDb = getAdminFirestore(adminApp);
});
after(async () => { __setPostInvoiceConcurrencyHook(null); await deleteAdminApp(adminApp); await testEnv.cleanup(); });
beforeEach(async () => { __setPostInvoiceConcurrencyHook(null); await testEnv.clearFirestore(); });

describe("C1 — concurrent posts, FIFO spill, stale snapshot (the historical F1)", () => {
  it("keeps P1 under two concurrent posts where one FIFO-spills into a second lot", async () => {
    await seedProduct("P", 15, [{ id: "L1", qty_in: 5, qty: 5, r: 1000 }, { id: "L2", qty_in: 10, qty: 10, r: 2000 }]);
    await seedDraft("INV-A", "A-ITEM", "P", 8);
    await seedDraft("INV-B", "B-ITEM", "P", 3);

    const bRead = deferred();
    const aCommitted = deferred();
    __setPostInvoiceConcurrencyHook(async ({ invoiceId, attempt }) => {
      if (invoiceId === "INV-B" && attempt === 1) { bRead.resolve(); await aCommitted.promise; }
    });

    const pB = postInvoice(db, "INV-B");
    await bRead.promise;
    await postInvoice(db, "INV-A");
    aCommitted.resolve();
    await pB;

    const { book, lotSum } = await bookAndLotSum("P");
    assert.equal(lotSum, book, `P1 violated: book ${book} != lotSum ${lotSum}`);
    await assertAllInvariants("C1");
  });
});

describe("C2 — invoice posting versus concurrent stock-in", () => {
  it("both succeed; the post's retry sees the new lot and P1/L6 hold", async () => {
    await seedProduct("P", 5, [{ id: "L1", qty_in: 5, qty: 5, r: 1000 }]);
    await seedDraft("INV-C", "C-ITEM", "P", 4);

    const cRead = deferred();
    const stockInDone = deferred();
    __setPostInvoiceConcurrencyHook(async ({ invoiceId, attempt }) => {
      if (invoiceId === "INV-C" && attempt === 1) { cRead.resolve(); await stockInDone.promise; }
    });

    const pC = postInvoice(db, "INV-C");
    await cRead.promise;
    await concurrentStockIn("P", "L2", 10, 3000); // book 5 -> 15, appends L2
    stockInDone.resolve();
    await pC; // retries: sees book 15 + L1,L2; consumes 4 from L1

    const { book, lotSum } = await bookAndLotSum("P");
    assert.equal(book, 11);
    assert.equal(lotSum, 11);
    await assertAllInvariants("C2");
  });
});

describe("C9 — a forced retry reads FRESH lot state", () => {
  it("the retrying post consumes from fresh lots, not the pre-retry snapshot", async () => {
    await seedProduct("P", 8, [{ id: "L1", qty_in: 8, qty: 8, r: 1000 }]);
    await seedDraft("INV-D", "D-ITEM", "P", 3);
    await seedDraft("INV-E", "E-ITEM", "P", 3);

    const eRead = deferred();
    const dCommitted = deferred();
    let eMaxAttempt = 0;
    __setPostInvoiceConcurrencyHook(async ({ invoiceId, attempt }) => {
      if (invoiceId === "INV-E") eMaxAttempt = Math.max(eMaxAttempt, attempt);
      if (invoiceId === "INV-E" && attempt === 1) { eRead.resolve(); await dCommitted.promise; }
    });

    const pE = postInvoice(db, "INV-E");
    await eRead.promise;
    await postInvoice(db, "INV-D"); // L1 8->5, book 8->5
    dCommitted.resolve();
    await pE; // must RETRY and read L1=5 fresh (stale L1=8 would drift)

    assert.ok(eMaxAttempt >= 2, `expected a retry; max attempt was ${eMaxAttempt}`);
    const { book, lotSum } = await bookAndLotSum("P");
    assert.equal(book, 2);
    assert.equal(lotSum, 2);
    await assertAllInvariants("C9");
  });
});

describe("C11 — ten concurrent invoice posts", () => {
  it("all ten commit and P1/L6 hold", async () => {
    await seedProduct("P", 100, [{ id: "L1", qty_in: 40, qty: 40, r: 1000 }, { id: "L2", qty_in: 60, qty: 60, r: 2000 }]);
    for (let i = 0; i < 10; i++) await seedDraft(`INV-${i}`, `ITEM-${i}`, "P", 5);

    await Promise.all(Array.from({ length: 10 }, (_, i) => postInvoice(db, `INV-${i}`)));

    const { book, lotSum } = await bookAndLotSum("P");
    assert.equal(book, 50, "book should be 100 - 10*5");
    assert.equal(lotSum, 50);
    await assertAllInvariants("C11");
  });
});
