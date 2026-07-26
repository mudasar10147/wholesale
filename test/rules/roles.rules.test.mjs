/**
 * Firestore rules tests for the `salesman` role and the clerk's read surface.
 *
 * Run: npm run test:rules:roles   (boots the Firestore emulator, so it needs Java)
 *
 * The salesman exists so the sales catalog can stop being a world-readable page. They
 * get exactly one collection — `products` — and nothing else in the business. The clerk
 * half of this file is a regression guard: every collection the clerk-facing pages
 * (Sales, Expenses, Customers) actually read must stay readable for `role: clerk`.
 */

import { after, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

let testEnv;

function salesmanDb() {
  return testEnv.authenticatedContext("salesman-user", { role: "salesman" }).firestore();
}
function clerkDb() {
  return testEnv.authenticatedContext("clerk-user", { role: "clerk" }).firestore();
}
function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
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

  // Seed with the admin bypass so denials are real denials, not empty-collection passes.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "products", "p1"), { name: "Widget", sale_price: 100, cost_price: 40 });
    await setDoc(doc(db, "sales", "s1"), { total_amount: 500, date: new Date() });
    await setDoc(doc(db, "customers", "c1"), { name: "Big Buyer" });
    await setDoc(doc(db, "invoices", "i1"), { total_amount: 500 });
    await setDoc(doc(db, "invoice_items", "ii1"), { unit_price: 100, customer_id: "c1" });
    await setDoc(doc(db, "invoice_returns", "r1"), { total_amount: 50 });
    await setDoc(doc(db, "invoice_return_items", "ri1"), { quantity_returned: 1 });
    await setDoc(doc(db, "expenses", "e1"), { amount: 100 });
    await setDoc(doc(db, "cash_entries", "ce1"), { amount: 1000 });
    await setDoc(doc(db, "stock_lots", "l1"), { product_id: "p1", unit_cost: 40 });
    await setDoc(doc(db, "traders", "t1"), { name: "Acme Supplies" });
    await setDoc(doc(db, "invoice_item_cogs", "ic1"), { cogs_amount: 40 });
    await setDoc(doc(db, "settings", "cash"), { opening_balance: 5000 });
    await setDoc(doc(db, "settings", "customer_engagement"), { rolling_window_days: 90 });
    await setDoc(doc(db, "settings", "new_arrival"), { threshold_days: 30 });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

describe("salesman role", () => {
  it("can read products (the sales catalog)", async () => {
    await assertSucceeds(getDoc(doc(salesmanDb(), "products", "p1")));
  });

  it("cannot write products", async () => {
    await assertFails(setDoc(doc(salesmanDb(), "products", "p1"), { name: "Tampered" }));
  });

  // One collection, and one only. Everything below is the business the salesman never sees.
  for (const [collectionName, docId] of [
    ["sales", "s1"],
    ["customers", "c1"],
    ["invoices", "i1"],
    ["invoice_items", "ii1"],
    ["invoice_returns", "r1"],
    ["expenses", "e1"],
    ["cash_entries", "ce1"],
    ["stock_lots", "l1"],
    ["traders", "t1"],
    ["invoice_item_cogs", "ic1"],
  ]) {
    it(`cannot read ${collectionName}`, async () => {
      await assertFails(getDoc(doc(salesmanDb(), collectionName, docId)));
    });
  }

  it("cannot read settings/cash", async () => {
    await assertFails(getDoc(doc(salesmanDb(), "settings", "cash")));
  });
});

describe("the catalog is no longer public", () => {
  it("an unauthenticated visitor cannot read products", async () => {
    await assertFails(getDoc(doc(anonDb(), "products", "p1")));
  });
});

describe("clerk keeps every read its pages depend on", () => {
  // Sales page: invoices + returns + customers. Sales detail: invoice items.
  // Customers page: customers + invoices + the engagement tier thresholds.
  for (const [collectionName, docId] of [
    ["products", "p1"],
    ["customers", "c1"],
    ["invoices", "i1"],
    ["invoice_items", "ii1"],
    ["invoice_returns", "r1"],
    ["invoice_return_items", "ri1"],
    ["expenses", "e1"],
  ]) {
    it(`can read ${collectionName}`, async () => {
      await assertSucceeds(getDoc(doc(clerkDb(), collectionName, docId)));
    });
  }

  for (const settingsDoc of ["customer_engagement", "new_arrival"]) {
    it(`can read settings/${settingsDoc}`, async () => {
      await assertSucceeds(getDoc(doc(clerkDb(), "settings", settingsDoc)));
    });
  }

  it("still cannot read settings/cash", async () => {
    await assertFails(getDoc(doc(clerkDb(), "settings", "cash")));
  });

  it("still cannot read stock_lots or cash_entries", async () => {
    await assertFails(getDoc(doc(clerkDb(), "stock_lots", "l1")));
    await assertFails(getDoc(doc(clerkDb(), "cash_entries", "ce1")));
  });
});
