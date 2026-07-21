/**
 * Integration foundation (§12.3): drive a REAL inventory operation against the
 * emulator and assert the ENTIRE register after it via assertAllInvariants.
 * Run: npm run test:integration
 *
 * This is the harness the per-operation tests grow into: a new operation cannot
 * break an old invariant without this failing, even absent a bespoke test.
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { assertAllInvariants } from "@/test/helpers/assertAllInvariants";
import { reconcileProduct } from "@/lib/inventory/reconcileMismatch";

let app;
let db;
const ts = () => Timestamp.now();

async function clear() {
  for (const c of ["products", "stock_lots", "inventory_transactions", "inventory_transaction_lines", "inventory_repairs", "lot_consumptions"]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

async function seedClean(id) {
  await db.collection("products").doc(id).set({ name: id, cost_price: 5, sale_price: 8, stock_quantity: 10, created_at: ts() });
  await db.collection("stock_lots").doc(`${id}-L1`).set({ product_id: id, unit_cost: 5, qty_in: 10, qty_remaining: 10, source: "stock_in", trader_id: "t1", warehouse_id: "default", received_at: ts(), created_at: ts(), updated_at: ts() });
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "run via emulators:exec");
  app = initializeApp({ projectId: "wholesale-rules-test" });
  db = getFirestore(app);
});
after(async () => { await deleteApp(app); });
beforeEach(clear);

describe("integration: assertAllInvariants over real state", () => {
  it("passes for a clean seeded product", async () => {
    await seedClean("A");
    await assertAllInvariants(db); // must not throw
  });

  it("catches a broken invariant (P1) introduced directly", async () => {
    await seedClean("A");
    await db.collection("products").doc("A").update({ stock_quantity: 12 }); // book != lots
    await assert.rejects(assertAllInvariants(db), /P1/);
  });

  it("a real reconcile operation restores every invariant", async () => {
    await seedClean("A");
    await db.collection("products").doc("A").update({ stock_quantity: 12 }); // drift
    await assert.rejects(assertAllInvariants(db), /P1/);

    await reconcileProduct(db, {
      productId: "A",
      authorityCategory: "consumption_history",
      reasonDetail: "integration test",
      validationRunId: "itest-run",
      actedByUid: "itest",
      dryRun: false,
    });

    await assertAllInvariants(db); // clean again — the whole register, after a real op
  });
});
