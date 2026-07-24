/**
 * Firestore rules tests for the inventory ledger (`inventory_transactions` /
 * `inventory_transaction_lines`).
 *
 * Run: npm run test:rules:inventory   (boots the Firestore emulator, needs Java)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE §2.7 BLOCKING QUESTION (PHASE1_INTEGRITY_ARCHITECTURE_V2.md §2.7)
 * ─────────────────────────────────────────────────────────────────────────────
 * `recordInventoryTransactionInTx` (lib/inventory/inventoryTransactionService.ts)
 * writes a ledger header with `tx.set(txnRef, header)` and then, in the SAME
 * transaction, `tx.update(txnRef, { item_ids })` — against a collection whose rule
 * is `allow create: if isAdmin(); allow update, delete: if false;`.
 *
 * If Firestore evaluates that `set`+`update` pair as create-THEN-update, the
 * `update: if false` clause rejects the whole commit and EVERY ledger write is
 * silently failing — which would present exactly as "stock moved, ledger missing".
 * If it evaluates the pair as a single create (typed by the doc not existing
 * before the commit), the ledger write is fine.
 *
 * §2.7 requires this be settled by an emulator test rather than by argument,
 * because the answer changes what all downstream ledger work IS. This file is
 * that test. `set-then-update in one transaction is accepted` is the load-bearing
 * assertion: if it ever fails, halt the milestone sequence and follow §2.7's
 * escalation (ship the `item_ids` fold as a standalone hotfix, re-plan M5).
 */

import { after, before, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

let testEnv;
let seq = 0;

/** Unique doc id per call so tests don't collide within a run. */
function nextId(prefix) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function adminDb() {
  return testEnv.authenticatedContext("admin-user", { admin: true }).firestore();
}
function clerkDb() {
  return testEnv.authenticatedContext("clerk-user", { role: "clerk" }).firestore();
}

/** A ledger header shaped like recordInventoryTransactionInTx builds it. */
function ledgerHeader(overrides = {}) {
  return {
    transaction_number: "ITX-STO-20260721-0001",
    type: "STOCK_IN",
    status: "posted",
    warehouse_id: "default",
    item_ids: [],
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    posted_at: serverTimestamp(),
    posted_by_uid: "admin-user",
    ...overrides,
  };
}

function ledgerLine(transactionId, overrides = {}) {
  return {
    transaction_id: transactionId,
    product_id: "p1",
    warehouse_id: "default",
    direction: "in",
    quantity: 5,
    unit_cost: 40,
    total_cost: 200,
    created_at: serverTimestamp(),
    ...overrides,
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

describe("inventory ledger rules — §2.7 set-then-update", () => {
  it("ACCEPTS set-header + set-lines + update(item_ids) in one transaction (admin)", async () => {
    // This is the exact production pattern. It MUST succeed, or every ledger
    // write is failing. See the §2.7 note at the top of this file.
    const db = adminDb();
    const txnId = nextId("itx");

    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const txnRef = doc(db, "inventory_transactions", txnId);
        const lineRef = doc(collection(db, "inventory_transaction_lines"));
        tx.set(txnRef, ledgerHeader());
        tx.set(lineRef, ledgerLine(txnId));
        tx.update(txnRef, { item_ids: [lineRef.id] });
      }),
    );
  });

  it("ACCEPTS a plain create with the final item_ids already set (the fold, admin)", async () => {
    // The §2.7 fix folds item_ids into the initial set. Prove that also passes,
    // so the fix is a safe drop-in whichever way the question resolved.
    const db = adminDb();
    const txnId = nextId("itx");
    const lineRef = doc(collection(db, "inventory_transaction_lines"));

    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const txnRef = doc(db, "inventory_transactions", txnId);
        tx.set(txnRef, ledgerHeader({ item_ids: [lineRef.id] }));
        tx.set(lineRef, ledgerLine(txnId));
      }),
    );
  });
});

describe("inventory ledger rules — append-only guardrail (G3)", () => {
  it("DENIES a standalone update of an existing ledger header (admin)", async () => {
    // The set-then-update acceptance must NOT come at the cost of losing
    // append-only. A genuine post-hoc update in its own commit must still fail.
    const txnId = nextId("itx");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "inventory_transactions", txnId),
        ledgerHeader(),
      );
    });

    const db = adminDb();
    await assertFails(
      updateDoc(doc(db, "inventory_transactions", txnId), { status: "voided" }),
    );
  });

  it("DENIES deleting a ledger header (admin)", async () => {
    const txnId = nextId("itx");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "inventory_transactions", txnId),
        ledgerHeader(),
      );
    });

    const db = adminDb();
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(
      deleteDoc(doc(db, "inventory_transactions", txnId)),
    );
  });
});

describe("inventory ledger rules — authorization", () => {
  it("DENIES a clerk creating a ledger header", async () => {
    const db = clerkDb();
    await assertFails(
      setDoc(doc(db, "inventory_transactions", nextId("itx")), ledgerHeader()),
    );
  });

  it("DENIES a clerk creating a ledger line", async () => {
    const db = clerkDb();
    await assertFails(
      setDoc(
        doc(db, "inventory_transaction_lines", nextId("line")),
        ledgerLine("itx-x"),
      ),
    );
  });
});

describe("inventory_repairs rules — append-only audit (M0.5)", () => {
  function repairRecord() {
    return {
      validation_run_id: "run1",
      product_id: "p1",
      invariant_id: "P1",
      before_book_stock: 100,
      before_lot_total: 103,
      approved_final_quantity: 100,
      adjustment_delta: 0,
      authority_category: "consumption_history",
      reason_detail: "baseline",
      related_document_ids: [],
      acted_by_uid: "admin-user",
      created_at: serverTimestamp(),
      ledger_transaction_id: "RECON-run1-p1",
    };
  }

  it("DENIES a clerk creating a repair record", async () => {
    const db = clerkDb();
    await assertFails(setDoc(doc(db, "inventory_repairs", nextId("rep")), repairRecord()));
  });

  it("DENIES updating an existing repair record (admin)", async () => {
    const id = nextId("rep");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "inventory_repairs", id), repairRecord());
    });
    const db = adminDb();
    await assertFails(updateDoc(doc(db, "inventory_repairs", id), { reason_detail: "tampered" }));
  });

  it("DENIES deleting a repair record (admin)", async () => {
    const id = nextId("rep");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "inventory_repairs", id), repairRecord());
    });
    const db = adminDb();
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(deleteDoc(doc(db, "inventory_repairs", id)));
  });

  it("ALLOWS an admin to read repair history", async () => {
    const id = nextId("rep");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "inventory_repairs", id), repairRecord());
    });
    const db = adminDb();
    await assertSucceeds(getDoc(doc(db, "inventory_repairs", id)));
  });
});
