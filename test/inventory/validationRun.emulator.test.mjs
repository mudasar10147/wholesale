/**
 * Emulator proof for the validation run orchestrator (§8.3, §9).
 * Run: npm run test:inventory-run   (boots the Firestore emulator, needs Java)
 *
 * Covers: full run persists a record; first_seen_at carries forward across runs;
 * incremental discovers only changed products; a missing/stale watermark falls
 * back to full; the watermark advances only on a complete run.
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { runValidation } from "@/lib/inventory/validationRun";

let app;
let db;

const D = (iso) => new Date(iso);

async function clear() {
  for (const c of ["products", "stock_lots", "inventory_validation_runs", "lot_consumptions", "invoice_item_cogs", "invoices"]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

/** Seed a product with P1 drift (stock != Σ lot qty), lot updated_at controllable. */
async function seedDrift(id, { stock, lotQty, lotUpdatedAt }) {
  const ts = Timestamp.fromDate(D(lotUpdatedAt));
  await db.collection("products").doc(id).set({ name: id, cost_price: 100, sale_price: 120, stock_quantity: stock, created_at: ts });
  await db.collection("stock_lots").doc(`${id}-L1`).set({
    product_id: id, unit_cost: 100, qty_in: 100, qty_remaining: lotQty,
    source: "stock_in", trader_id: "t1", warehouse_id: "default",
    received_at: ts, created_at: ts, updated_at: ts,
  });
}

async function runsCount() {
  return (await db.collection("inventory_validation_runs").get()).size;
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run via emulators:exec");
  app = initializeApp({ projectId: "wholesale-rules-test" });
  db = getFirestore(app);
});
after(async () => { await deleteApp(app); });
beforeEach(clear);

describe("runValidation — full mode + persistence", () => {
  it("persists a run record with verdict, counts and redacted issue metadata", async () => {
    await seedDrift("A", { stock: 10, lotQty: 7, lotUpdatedAt: "2026-01-01T00:00:00Z" });
    const { record } = await runValidation(db, { mode: "full", projectId: "wholesale-rules-test", asOf: D("2026-06-01T00:00:00Z") });

    assert.equal(record.mode, "full");
    assert.equal(record.complete, true);
    assert.equal(record.verdict, "FAIL"); // P1 is CRITICAL
    assert.equal(record.summary.critical, 1);
    assert.equal(record.counts.products, 1);
    assert.equal(record.issues.length, 1);
    const issue = record.issues[0];
    assert.equal(issue.invariant_id, "P1");
    assert.equal(issue.entity_type, "product");
    assert.equal(issue.entity_id, "A");
    assert.ok(issue.first_seen_at, "issue carries first_seen_at");
    // Redaction: no message / monetary delta persisted.
    assert.equal(issue.message, undefined);
    assert.equal(issue.delta, undefined);
    assert.equal(await runsCount(), 1);
  });
});

describe("runValidation — first_seen_at carry-forward", () => {
  it("keeps the original first_seen_at when the same issue persists across runs", async () => {
    await seedDrift("A", { stock: 10, lotQty: 7, lotUpdatedAt: "2026-01-01T00:00:00Z" });
    const first = await runValidation(db, { mode: "full", projectId: "p", asOf: D("2026-06-01T00:00:00Z") });
    const firstSeen = first.record.issues[0].first_seen_at.toMillis();

    const second = await runValidation(db, { mode: "full", projectId: "p", asOf: D("2026-06-02T00:00:00Z") });
    const carried = second.record.issues[0].first_seen_at.toMillis();

    assert.equal(carried, firstSeen, "first_seen_at must be carried, not reset to the new run time");
    assert.notEqual(second.record.started_at.toMillis(), firstSeen, "started_at is the new run time");
  });
});

describe("runValidation — incremental discovery", () => {
  it("discovers only products whose lots changed since the watermark", async () => {
    // Both drifted; full run at T1 records both.
    await seedDrift("A", { stock: 10, lotQty: 7, lotUpdatedAt: "2026-01-01T00:00:00Z" });
    await seedDrift("B", { stock: 20, lotQty: 15, lotUpdatedAt: "2026-01-01T00:00:00Z" });
    await runValidation(db, { mode: "full", projectId: "p", asOf: D("2026-06-01T00:00:00Z") });

    // Only A's lot is touched after the watermark.
    await db.collection("stock_lots").doc("A-L1").update({ updated_at: Timestamp.fromDate(D("2026-06-01T00:10:00Z")) });

    const inc = await runValidation(db, { mode: "incremental", projectId: "p", asOf: D("2026-06-01T00:15:00Z") });
    assert.equal(inc.record.mode, "incremental");
    assert.equal(inc.fellBackToFull, false);
    assert.deepEqual(inc.record.scope.product_ids.sort(), ["A"]);
    // Reported issues are scoped to A; B is not re-reported.
    const products = new Set(inc.record.issues.map((i) => i.entity_id));
    assert.ok(products.has("A"));
    assert.ok(!products.has("B"));
  });
});

describe("runValidation — a discovered product runs the COMPLETE invariant set", () => {
  it("reports every invariant a discovered product violates, not just the trigger", async () => {
    // A drifted product (P1) whose lot ALSO lacks trader_id (L8) and received_at (L4).
    await db.collection("products").doc("A").set({ name: "A", cost_price: 100, sale_price: 120, stock_quantity: 10, created_at: Timestamp.fromDate(D("2026-01-01T00:00:00Z")) });
    await db.collection("stock_lots").doc("A-L1").set({
      product_id: "A", unit_cost: 100, qty_in: 100, qty_remaining: 7, source: "stock_in",
      warehouse_id: "default", received_at: null, created_at: Timestamp.fromDate(D("2026-01-01T00:00:00Z")), updated_at: Timestamp.fromDate(D("2026-01-01T00:00:00Z")),
    });
    await runValidation(db, { mode: "full", projectId: "p", asOf: D("2026-06-01T00:00:00Z") });

    // Touch the lot so A is discovered incrementally.
    await db.collection("stock_lots").doc("A-L1").update({ updated_at: Timestamp.fromDate(D("2026-06-01T00:10:00Z")) });
    const inc = await runValidation(db, { mode: "incremental", projectId: "p", asOf: D("2026-06-01T00:15:00Z") });

    assert.equal(inc.record.mode, "incremental");
    const invariants = new Set(inc.record.issues.map((i) => i.invariant_id));
    assert.ok(invariants.has("P1"), "P1 (the trigger) reported");
    assert.ok(invariants.has("L4"), "L4 also reported — full check set ran for the discovered product");
    assert.ok(invariants.has("L8"), "L8 also reported — checks are not narrowed, only products are");
  });
});

describe("runValidation — fallback and watermark", () => {
  it("an incremental run with no prior complete run falls back to full", async () => {
    await seedDrift("A", { stock: 10, lotQty: 7, lotUpdatedAt: "2026-01-01T00:00:00Z" });
    const res = await runValidation(db, { mode: "incremental", projectId: "p", asOf: D("2026-06-01T00:00:00Z") });
    assert.equal(res.fellBackToFull, true);
    assert.equal(res.record.mode, "full");
  });

  it("an incremental run older than 48h from the watermark falls back to full", async () => {
    await seedDrift("A", { stock: 10, lotQty: 7, lotUpdatedAt: "2026-01-01T00:00:00Z" });
    await runValidation(db, { mode: "full", projectId: "p", asOf: D("2026-06-01T00:00:00Z") });
    const stale = await runValidation(db, { mode: "incremental", projectId: "p", asOf: D("2026-06-05T00:00:00Z") });
    assert.equal(stale.fellBackToFull, true);
    assert.equal(stale.record.mode, "full");
  });
});
