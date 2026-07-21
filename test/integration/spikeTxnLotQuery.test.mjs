/**
 * M1.5-S — transactional lot-query feasibility spike (§19 M1.5-S, §2.2b, §11.2.1).
 * Run: npm run test:spike
 *
 * The client Web SDK has NO transaction.get(query) overload, so M2's freshness
 * fix rests on Option A: a non-transactional getDocs INSIDE the callback + the
 * product anchor. This spike settles the load-bearing assumptions by MEASUREMENT,
 * against the emulator, using deterministic barriers (stronger than sampling N
 * random iterations — the exact interleaving is forced, not hoped for):
 *
 *   S1  — getDocs inside a retried callback returns FRESH data on attempt 2.
 *   S2b — anchor-first ORDER aborts+retries on a concurrent new lot (safe);
 *         query-first ORDER commits stale (corrupts). If query-first did NOT
 *         corrupt, our model of Firestore preconditions would be wrong.
 *
 * Findings + go/no-go: docs/inventory/SPIKE_TXN_LOT_QUERY.md.
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDocs,
  increment,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

let testEnv;
let db;

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const PID = "P";
function productRef() { return doc(db, "products", PID); }
function activeLotsQuery() {
  return query(collection(db, "stock_lots"), where("product_id", "==", PID), where("qty_remaining", ">", 0));
}
async function seedProduct() {
  await setDoc(productRef(), { stock_quantity: 10, version: 0 });
  await setDoc(doc(db, "stock_lots", "L1"), { product_id: PID, qty_in: 10, qty_remaining: 10, received_at: 1 });
}
/** Concurrent stock-in: a NEW lot for P plus the co-write of P's anchor doc. */
async function concurrentStockIn() {
  await setDoc(doc(db, "stock_lots", "L2"), { product_id: PID, qty_in: 5, qty_remaining: 5, received_at: 2 });
  await updateDoc(productRef(), { version: increment(1) }); // co-writes the anchor (§11.1)
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: {
      // Permissive — this spike tests SDK transaction mechanics, not rules.
      rules: "rules_version='2';\nservice cloud.firestore{match /databases/{db}/documents{match /{d=**}{allow read,write:if true;}}}",
      host: "127.0.0.1",
      port: 8080,
    },
  });
  db = testEnv.unauthenticatedContext().firestore();
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); await seedProduct(); });

describe("S1 — getDocs inside a retried transaction is fresh per attempt", () => {
  it("attempt 2 observes a lot created after attempt 1 read", async () => {
    const seen = [];
    const attempt1Read = deferred();
    const concurrentCommitted = deferred();
    let attempt = 0;

    const txn = runTransaction(db, async (tx) => {
      attempt += 1;
      const mine = attempt;
      const prod = await tx.get(productRef());          // ANCHOR first
      const lots = await getDocs(activeLotsQuery());     // fresh, non-transactional
      seen.push({ attempt: mine, lotCount: lots.size });
      if (mine === 1) {
        attempt1Read.resolve();
        await concurrentCommitted.promise;               // pause mid-callback
      }
      tx.update(productRef(), { stock_quantity: (prod.data().stock_quantity ?? 0) }); // write → precondition checked
    });

    await attempt1Read.promise;
    await concurrentStockIn();       // bumps product version → attempt 1 precondition fails
    concurrentCommitted.resolve();
    await txn;

    assert.ok(seen.length >= 2, `expected a retry, saw attempts: ${JSON.stringify(seen)}`);
    assert.equal(seen[0].lotCount, 1, "attempt 1 saw the original single lot");
    assert.equal(seen[seen.length - 1].lotCount, 2, "the retry's getDocs saw the newly-created lot — FRESH");
  });
});

describe("S2b — read ordering: anchor-first is safe, query-first corrupts", () => {
  it("ANCHOR-FIRST aborts and retries when a new lot is created concurrently", async () => {
    const seen = [];
    const anchorRead = deferred();
    const concurrentCommitted = deferred();
    let attempt = 0;

    const txn = runTransaction(db, async (tx) => {
      attempt += 1;
      const mine = attempt;
      await tx.get(productRef());                     // anchor FIRST
      const lots = await getDocs(activeLotsQuery());   // then query
      seen.push({ attempt: mine, lotCount: lots.size });
      if (mine === 1) { anchorRead.resolve(); await concurrentCommitted.promise; }
      tx.update(productRef(), { touched: mine });
    });

    await anchorRead.promise;
    await concurrentStockIn();
    concurrentCommitted.resolve();
    await txn;

    assert.ok(seen.length >= 2, "anchor-first must retry on the concurrent lot");
    assert.equal(seen[seen.length - 1].lotCount, 2, "retry observes the new lot — the anchor covered the query");
  });

  it("QUERY-FIRST commits with a STALE lot view (demonstrates the corruption)", async () => {
    const seen = [];
    const queryRead = deferred();
    const concurrentCommitted = deferred();
    let attempt = 0;

    const txn = runTransaction(db, async (tx) => {
      attempt += 1;
      const mine = attempt;
      const lots = await getDocs(activeLotsQuery());   // query FIRST
      seen.push({ attempt: mine, lotCount: lots.size });
      if (mine === 1) { queryRead.resolve(); await concurrentCommitted.promise; }
      await tx.get(productRef());                     // anchor AFTER — reads the already-updated value
      tx.update(productRef(), { touched: mine });
    });

    await queryRead.promise;
    await concurrentStockIn();       // lands BETWEEN the query and the anchor read
    concurrentCommitted.resolve();
    await txn;

    // The anchor was read AFTER the competing write, so its precondition holds and
    // the transaction commits without retry — using the stale 1-lot view.
    assert.equal(seen.length, 1, "query-first did NOT retry");
    assert.equal(seen[0].lotCount, 1, "committed against a stale lot set missing the new lot — CORRUPTION");
  });
});

describe("spike deliverable", () => {
  it("SPIKE_TXN_LOT_QUERY.md records a go/no-go on Option A", () => {
    const md = readFileSync("docs/inventory/SPIKE_TXN_LOT_QUERY.md", "utf8");
    assert.match(md, /Option A/);
    assert.match(md, /\bGO\b|\bNO-GO\b/);
  });
});
