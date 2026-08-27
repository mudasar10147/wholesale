/**
 * Firestore rules for return ledger bookkeeping.
 *
 * Run: npm run test:rules:return-ledger
 *
 * `not_applicable` is the terminal ledger state for a posted return that
 * restocked nothing — every line discarded. The bookkeeping rule has to admit
 * it, or the honest outcome is unwritable and the only way to clear the "posted
 * return missing its ledger" finding would be to fabricate a movement that never
 * happened.
 */

import { after, before, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

let testEnv;
const RETURN_ID = "ret-ledger-1";

function adminDb() {
  return testEnv.authenticatedContext("admin-user", { admin: true }).firestore();
}
function clerkDb() {
  return testEnv.authenticatedContext("clerk-user", { role: "clerk" }).firestore();
}

async function seedPostedReturn() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`invoice_returns/${RETURN_ID}`).set({
      return_number: "RET-20260827-0001",
      original_invoice_id: "INV-20260827-0001",
      order_id: "INV-20260827-0001",
      customer_id: "c1",
      status: "posted",
      settlement_type: "reduce_balance",
      item_ids: ["ri1"],
      subtotal_amount: 100,
      total_amount: 100,
      refund_amount: 0,
      ledger_status: "pending",
      posted_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "wholesale-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
beforeEach(async () => { await testEnv.clearFirestore(); });
after(async () => { await testEnv.cleanup(); });

describe("invoice_returns ledger bookkeeping statuses", () => {
  it("ACCEPTS not_applicable on a posted return", async () => {
    await seedPostedReturn();
    await assertSucceeds(
      updateDoc(doc(adminDb(), "invoice_returns", RETURN_ID), {
        ledger_status: "not_applicable",
        ledger_error: null,
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("ACCEPTS the ordinary posted transition with a ledger id", async () => {
    await seedPostedReturn();
    await assertSucceeds(
      updateDoc(doc(adminDb(), "invoice_returns", RETURN_ID), {
        ledger_status: "posted",
        inventory_transaction_id: "ldg_SALES_RETURN__invoice_return__ret-ledger-1",
        ledger_error: null,
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("ACCEPTS marking a failure", async () => {
    await seedPostedReturn();
    await assertSucceeds(
      updateDoc(doc(adminDb(), "invoice_returns", RETURN_ID), {
        ledger_status: "failed",
        ledger_error: "network",
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("DENIES an invented ledger status", async () => {
    await seedPostedReturn();
    await assertFails(
      updateDoc(doc(adminDb(), "invoice_returns", RETURN_ID), {
        ledger_status: "skipped",
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("DENIES smuggling other fields through the bookkeeping path", async () => {
    await seedPostedReturn();
    await assertFails(
      updateDoc(doc(adminDb(), "invoice_returns", RETURN_ID), {
        ledger_status: "not_applicable",
        total_amount: 1,
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("DENIES a clerk writing ledger bookkeeping", async () => {
    await seedPostedReturn();
    await assertFails(
      updateDoc(doc(clerkDb(), "invoice_returns", RETURN_ID), {
        ledger_status: "not_applicable",
        updated_at: serverTimestamp(),
      }),
    );
  });
});
