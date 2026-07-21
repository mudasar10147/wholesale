/**
 * Emulator proof for on-demand validation controls (§9.6): the concurrency lock
 * and the rate limits. Run: npm run test:inventory-api
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { triggerValidation } from "@/lib/inventory/validationApi";

let app;
let db;
const D = (iso) => new Date(iso);
const T0 = "2026-06-01T00:00:00Z";
const plus = (min) => new Date(Date.parse(T0) + min * 60_000);

async function clear() {
  for (const c of ["products", "stock_lots", "inventory_validation_runs", "inventory_validation_locks"]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}
async function seedDrift(id) {
  const ts = Timestamp.fromDate(D(T0));
  await db.collection("products").doc(id).set({ name: id, cost_price: 100, sale_price: 120, stock_quantity: 10, created_at: ts });
  await db.collection("stock_lots").doc(`${id}-L1`).set({ product_id: id, unit_cost: 100, qty_in: 100, qty_remaining: 7, source: "stock_in", trader_id: "t1", warehouse_id: "default", received_at: ts, created_at: ts, updated_at: ts });
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run via emulators:exec");
  app = initializeApp({ projectId: "wholesale-rules-test" });
  db = getFirestore(app);
});
after(async () => { await deleteApp(app); });
beforeEach(async () => { await clear(); await seedDrift("A"); });

describe("triggerValidation — rate limits", () => {
  it("refuses a second full run within 15 minutes, then within the hour", async () => {
    const first = await triggerValidation(db, { mode: "full", projectId: "p", uid: "u", now: plus(0) });
    assert.equal(first.status, "started");

    const soon = await triggerValidation(db, { mode: "full", projectId: "p", uid: "u", now: plus(5) });
    assert.equal(soon.status, "rate_limited");

    const laterSameHour = await triggerValidation(db, { mode: "full", projectId: "p", uid: "u", now: plus(20) });
    assert.equal(laterSameHour.status, "rate_limited"); // hourly cap

    const nextHour = await triggerValidation(db, { mode: "full", projectId: "p", uid: "u", now: plus(61) });
    assert.equal(nextHour.status, "started");
  });

  it("refuses a second incremental within 5 minutes", async () => {
    await triggerValidation(db, { mode: "full", projectId: "p", uid: "u", now: plus(0) }); // watermark
    const inc1 = await triggerValidation(db, { mode: "incremental", projectId: "p", uid: "u", now: plus(20) });
    assert.equal(inc1.status, "started");
    const inc2 = await triggerValidation(db, { mode: "incremental", projectId: "p", uid: "u", now: plus(22) });
    assert.equal(inc2.status, "rate_limited");
    const inc3 = await triggerValidation(db, { mode: "incremental", projectId: "p", uid: "u", now: plus(30) });
    assert.equal(inc3.status, "started");
  });
});

describe("triggerValidation — concurrency lock", () => {
  it("returns the in-progress run instead of starting a parallel scan", async () => {
    // Simulate a run in progress by holding a fresh lock.
    await db.collection("inventory_validation_locks").doc("current").set({ acquired_at: Timestamp.fromDate(plus(0)), uid: "other", mode: "full", run_id: "RUN-IN-PROGRESS" });
    const res = await triggerValidation(db, { mode: "incremental", projectId: "p", uid: "u", now: plus(1) });
    assert.equal(res.status, "in_progress");
    assert.equal(res.run_id, "RUN-IN-PROGRESS");
  });

  it("acquires an expired lock (crashed run) and proceeds", async () => {
    await db.collection("inventory_validation_locks").doc("current").set({ acquired_at: Timestamp.fromDate(plus(-40)), uid: "ghost", mode: "full", run_id: "OLD" });
    const res = await triggerValidation(db, { mode: "full", projectId: "p", uid: "u", now: plus(0) });
    assert.equal(res.status, "started");
  });

  it("releases the lock after a run so the next request can proceed", async () => {
    await triggerValidation(db, { mode: "full", projectId: "p", uid: "u", now: plus(0) });
    const lock = await db.collection("inventory_validation_locks").doc("current").get();
    assert.equal(lock.exists, false, "lock must be released after the run");
  });
});
