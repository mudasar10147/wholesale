/**
 * Emulator proof for the M0.5 reconciliation tool (§19.0.5-M).
 * Run: npm run test:inventory-reconcile   (boots the Firestore emulator, needs Java)
 *
 * Exercises the REAL reconcileProduct against the emulator via the Admin SDK (the
 * production identity for this script-only tool). Covers:
 *   - the canonical B=100, L=103 → 100/100 proof with L6 green and honest ledger
 *   - RECONCILIATION ledger honesty (movement:false, derived lot corrections)
 *   - idempotency (re-run is a no-op; no duplicate ledger/repair rows)
 *   - concurrency (two parallel runs converge to one repair, one ledger row)
 *   - separation of RECONCILIATION (movement:false) from physical ADJUSTMENT (movement:true)
 *   - refusal on broken history (no writes)
 *   - dry-run default writes nothing
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { reconcileProduct } from "@/lib/inventory/reconcileMismatch";

let app;
let db;
let counter = 0;

/** Unique product id per test so tests are isolated without clearing the emulator. */
function uid(prefix) {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function seedProduct(id, spec) {
  const now = Timestamp.now();
  await db.collection("products").doc(id).set({
    name: `Product ${id}`,
    cost_price: 10,
    sale_price: 20,
    stock_quantity: spec.book,
    created_at: now,
  });
  for (const lot of spec.lots ?? []) {
    await db.collection("stock_lots").doc(lot.id).set({
      product_id: id,
      unit_cost: lot.unit_cost ?? 10,
      qty_in: lot.qty_in,
      qty_remaining: lot.qty_remaining,
      source: lot.source ?? "stock_in",
      warehouse_id: "default",
      received_at: lot.received_at ?? now,
      created_at: now,
      updated_at: now,
    });
  }
  let cIdx = 0;
  for (const c of spec.consumptions ?? []) {
    cIdx += 1;
    await db.collection("lot_consumptions").doc(`${id}-cons-${cIdx}`).set({
      invoice_id: c.invoice_id ?? "inv1",
      order_id: "o1",
      invoice_item_id: c.invoice_item_id ?? "ii1",
      product_id: id,
      lot_id: c.lot_id,
      quantity: c.quantity,
      unit_cost: 10,
      cogs_amount: 10 * c.quantity,
      created_at: now,
      ...(c.reversed ? { reversed_at: now } : {}),
    });
  }
  let dIdx = 0;
  for (const d of spec.discards ?? []) {
    dIdx += 1;
    await db.collection("inventory_discard_lots").doc(`${id}-disc-${dIdx}`).set({
      discard_id: "d1",
      discard_item_id: "di1",
      lot_id: d.lot_id,
      product_id: id,
      quantity: d.quantity,
      unit_cost: 10,
      cogs_amount: 10 * d.quantity,
      created_at: now,
    });
  }
  let rIdx = 0;
  for (const r of spec.restorations ?? []) {
    rIdx += 1;
    await db.collection("return_lot_restorations").doc(`${id}-rest-${rIdx}`).set({
      return_id: "r1",
      consumption_id: "c1",
      lot_id: r.lot_id,
      product_id: id,
      invoice_id: "inv1",
      invoice_item_id: "ii1",
      quantity: r.quantity,
      unit_cost: 10,
      cogs_amount: 10 * r.quantity,
      created_at: now,
    });
  }
}

async function productStock(id) {
  const snap = await db.collection("products").doc(id).get();
  return snap.data().stock_quantity;
}

async function lotSum(id) {
  const snap = await db.collection("stock_lots").where("product_id", "==", id).get();
  return snap.docs.reduce((s, d) => s + (d.data().qty_remaining ?? 0), 0);
}

async function ledgerRows(productId) {
  const snap = await db.collection("inventory_transactions").where("product_id", "==", productId).get();
  return snap.docs.map((d) => d.data());
}

/** ADJUSTMENT rows for a product (they carry no product_id header field, so join via lines). */
async function adjustmentRowsFor(productId) {
  const lines = await db.collection("inventory_transaction_lines").where("product_id", "==", productId).get();
  const txnIds = [...new Set(lines.docs.map((d) => d.data().transaction_id))];
  const out = [];
  for (const tid of txnIds) {
    const t = await db.collection("inventory_transactions").doc(tid).get();
    if (t.exists) out.push({ id: t.id, ...t.data() });
  }
  return out;
}

async function repairRecords(productId) {
  const snap = await db.collection("inventory_repairs").where("product_id", "==", productId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function baseParams(over) {
  return {
    authorityCategory: "consumption_history",
    reasonDetail: "M0 baseline remediation test",
    validationRunId: over.validationRunId,
    actedByUid: "repair-bot",
    dryRun: false,
    ...over,
  };
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST must be set (run via emulators:exec)");
  app = initializeApp({ projectId: "wholesale-rules-test" });
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

describe("reconcileProduct — the 100/103 proof", () => {
  it("takes B=100, L=103 to B=L=100 with L6 green and an honest RECONCILIATION row", async () => {
    const id = uid("p");
    const runId = uid("run");
    // Lot has qty_in 103, but 3 were consumed — so history-implied remaining is 100.
    // qty_remaining is stored as 103 (the phantom drift), book is 100.
    await seedProduct(id, {
      book: 100,
      lots: [{ id: `${id}-L1`, qty_in: 103, qty_remaining: 103 }],
      consumptions: [{ lot_id: `${id}-L1`, quantity: 3 }],
    });

    const res = await reconcileProduct(db, baseParams({ productId: id, validationRunId: runId, physicalCount: 100 }));

    assert.equal(res.status, "applied");
    assert.equal(await productStock(id), 100); // P1: book
    assert.equal(await lotSum(id), 100); // P1: lots == book
    // L6 by construction: qty_remaining (100) == qty_in (103) − consumptions (3)
    const lot = (await db.collection("stock_lots").doc(`${id}-L1`).get()).data();
    assert.equal(lot.qty_remaining, 100);

    const rows = await ledgerRows(id);
    assert.equal(rows.length, 1);
    const recon = rows[0];
    assert.equal(recon.type, "RECONCILIATION");
    assert.equal(recon.movement, false);
    assert.equal(recon.book_before, 100);
    assert.equal(recon.book_after, 100);
    assert.equal(recon.lot_total_before, 103);
    assert.equal(recon.lot_total_after, 100);
    assert.equal(recon.lot_corrections.length, 1);
    assert.equal(recon.lot_corrections[0].delta, -3);
    assert.equal(recon.lot_corrections[0].history_implied, 100);

    const repairs = await repairRecords(id);
    assert.equal(repairs.length, 1);
    assert.equal(repairs[0].ledger_transaction_id, res.reconciliationLedgerId);
    assert.ok(repairs[0].ledger_transaction_id, "a repair must carry a ledger transaction id");
  });

  it("book-wrong case: B=100, lots correct at 103 → 103/103 via book reconciliation only", async () => {
    const id = uid("p");
    const runId = uid("run");
    await seedProduct(id, {
      book: 100,
      lots: [{ id: `${id}-L1`, qty_in: 103, qty_remaining: 103 }],
    });

    const res = await reconcileProduct(db, baseParams({ productId: id, validationRunId: runId, physicalCount: 103 }));
    assert.equal(res.status, "applied");
    assert.equal(await productStock(id), 103);
    assert.equal(await lotSum(id), 103);
    const recon = (await ledgerRows(id))[0];
    assert.equal(recon.lot_corrections.length, 0); // lots untouched
    assert.equal(recon.book_before, 100);
    assert.equal(recon.book_after, 103);
  });
});

describe("reconcileProduct — idempotency", () => {
  it("re-running a repaired product is a no-op with no duplicate ledger or repair rows", async () => {
    const id = uid("p");
    const runId = uid("run");
    await seedProduct(id, {
      book: 100,
      lots: [{ id: `${id}-L1`, qty_in: 103, qty_remaining: 103 }],
      consumptions: [{ lot_id: `${id}-L1`, quantity: 3 }],
    });

    const first = await reconcileProduct(db, baseParams({ productId: id, validationRunId: runId }));
    assert.equal(first.status, "applied");
    const second = await reconcileProduct(db, baseParams({ productId: id, validationRunId: runId }));
    assert.equal(second.status, "already_repaired");

    assert.equal((await ledgerRows(id)).length, 1);
    assert.equal((await repairRecords(id)).length, 1);
    assert.equal(await productStock(id), 100);
    assert.equal(await lotSum(id), 100);
  });
});

describe("reconcileProduct — concurrency", () => {
  it("two parallel runs converge to one repair and one RECONCILIATION row", async () => {
    const id = uid("p");
    const runId = uid("run");
    await seedProduct(id, {
      book: 100,
      lots: [{ id: `${id}-L1`, qty_in: 103, qty_remaining: 103 }],
      consumptions: [{ lot_id: `${id}-L1`, quantity: 3 }],
    });

    const [a, b] = await Promise.all([
      reconcileProduct(db, baseParams({ productId: id, validationRunId: runId })),
      reconcileProduct(db, baseParams({ productId: id, validationRunId: runId })),
    ]);
    const statuses = [a.status, b.status].sort();
    // Exactly one applies; the other sees the completed repair.
    assert.deepEqual(statuses, ["already_repaired", "applied"]);

    assert.equal((await ledgerRows(id)).length, 1, "deterministic ledger id => single row");
    assert.equal((await repairRecords(id)).length, 1, "create() => single repair record");
    assert.equal(await productStock(id), 100);
    assert.equal(await lotSum(id), 100);
  });
});

describe("reconcileProduct — separation of RECONCILIATION and physical ADJUSTMENT", () => {
  it("phantom 3 reconciled (movement:false), real 2 shrinkage adjusted (movement:true)", async () => {
    const id = uid("p");
    const runId = uid("run");
    // B=100, L=103, history-implied lHist=100, verified physical count 98.
    await seedProduct(id, {
      book: 100,
      lots: [{ id: `${id}-L1`, qty_in: 103, qty_remaining: 103 }],
      consumptions: [{ lot_id: `${id}-L1`, quantity: 3 }],
    });

    const res = await reconcileProduct(
      db,
      baseParams({ productId: id, validationRunId: runId, physicalCount: 98, authorityCategory: "physical_count" }),
    );
    assert.equal(res.status, "applied");
    assert.equal(await productStock(id), 98);
    assert.equal(await lotSum(id), 98);

    const rows = await ledgerRows(id);
    const recon = rows.find((r) => r.type === "RECONCILIATION");
    assert.ok(recon, "a RECONCILIATION row exists");
    assert.equal(recon.movement, false);
    assert.equal(recon.lot_corrections[0].delta, -3); // the phantom units

    const adjustments = (await adjustmentRowsFor(id)).filter((r) => r.type === "ADJUSTMENT");
    assert.equal(adjustments.length, 1, "one physical ADJUSTMENT for the real shrinkage");
    assert.equal(adjustments[0].movement, true);

    const repair = (await repairRecords(id))[0];
    assert.equal(repair.physical_count, 98);
    assert.ok(repair.physical_adjustment_transaction_id, "repair links the physical adjustment row");
    assert.notEqual(repair.ledger_transaction_id, repair.physical_adjustment_transaction_id);
  });
});

describe("reconcileProduct — refusal and dry-run write nothing", () => {
  it("refuses broken history (consumption exceeds intake) and writes nothing", async () => {
    const id = uid("p");
    const runId = uid("run");
    await seedProduct(id, {
      book: 100,
      lots: [{ id: `${id}-L1`, qty_in: 100, qty_remaining: 100 }],
      consumptions: [{ lot_id: `${id}-L1`, quantity: 103 }],
    });

    const res = await reconcileProduct(db, baseParams({ productId: id, validationRunId: runId }));
    assert.equal(res.status, "refused");
    assert.ok(res.refusalReasons.some((r) => r.includes("< 0")));
    assert.equal(await productStock(id), 100); // unchanged
    assert.equal((await ledgerRows(id)).length, 0);
    assert.equal((await repairRecords(id)).length, 0);
  });

  it("dry-run (default) computes a plan but writes nothing", async () => {
    const id = uid("p");
    const runId = uid("run");
    await seedProduct(id, {
      book: 100,
      lots: [{ id: `${id}-L1`, qty_in: 103, qty_remaining: 103 }],
      consumptions: [{ lot_id: `${id}-L1`, quantity: 3 }],
    });

    const res = await reconcileProduct(db, baseParams({ productId: id, validationRunId: runId, dryRun: true }));
    assert.equal(res.status, "dry_run");
    assert.equal(res.plan.lHist, 100);
    assert.equal(res.plan.lotCorrections[0].delta, -3);
    assert.equal(await productStock(id), 100);
    assert.equal(await lotSum(id), 103); // untouched
    assert.equal((await ledgerRows(id)).length, 0);
    assert.equal((await repairRecords(id)).length, 0);
  });

  it("administrative authority without a second approver is refused", async () => {
    const id = uid("p");
    const runId = uid("run");
    await seedProduct(id, {
      book: 100,
      lots: [{ id: `${id}-L1`, qty_in: 103, qty_remaining: 103 }],
      consumptions: [{ lot_id: `${id}-L1`, quantity: 3 }],
    });

    const res = await reconcileProduct(
      db,
      baseParams({ productId: id, validationRunId: runId, authorityCategory: "administrative" }),
    );
    assert.equal(res.status, "refused");
    assert.ok(res.refusalReasons.some((r) => r.includes("approved_by_uid")));
    assert.equal((await ledgerRows(id)).length, 0);
  });
});
