/**
 * Firestore rules tests for the `salesman` role and the clerk's read surface.
 *
 * Run: npm run test:rules:roles   (boots the Firestore emulator, so it needs Java)
 *
 * The salesman exists so the sales catalog can stop being a world-readable page. They
 * get `products` plus `social_offers` — the two the catalog price is a function of — and
 * nothing else in the business.
 *
 * The clerk half is the shape of the shop floor. A clerk runs the day: invoices from
 * draft to posted to paid, returns, the catalog, stock and suppliers. The line they do
 * not cross is the money the shop holds and who may use the app — cash entries, the cash
 * setting, loan parties, deleting a customer or trader, merges, and the role audit. Both
 * halves of that boundary are asserted here, because a rule that silently widens is
 * indistinguishable from one that was meant to.
 */

import { after, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";

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
    await setDoc(doc(db, "lot_consumptions", "lc1"), { lot_id: "l1", quantity: 1 });
    await setDoc(doc(db, "inventory_discards", "d1"), { discard_number: "DSC-1" });
    await setDoc(doc(db, "inventory_transactions", "it1"), { type: "SALE" });
    await setDoc(doc(db, "inventory_validation_runs", "vr1"), { run_id: "vr1" });
    await setDoc(doc(db, "physical_stock_corrections", "pc1"), { product_id: "p1" });
    await setDoc(doc(db, "parties", "pa1"), { name: "Lender" });
    await setDoc(doc(db, "customer_merges", "cm1"), { keep_customer_id: "c1" });
    await setDoc(doc(db, "user_admin_audit", "ua1"), { action: "set_role" });
    await setDoc(doc(db, "settings", "cash"), { opening_balance: 5000 });
    await setDoc(doc(db, "settings", "customer_engagement"), { rolling_window_days: 90 });
    await setDoc(doc(db, "settings", "new_arrival"), { threshold_days: 30 });
    await setDoc(doc(db, "social_offers", "so1"), {
      title: "Week Clearance",
      discount_type: "percent",
      discount_value: 7,
      product_ids: ["p1"],
      starts_on: "2026-08-01",
      ends_on: "2026-08-31",
      is_active: true,
      created_by: "social-user",
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

describe("salesman role", () => {
  it("can read products (the sales catalog)", async () => {
    await assertSucceeds(getDoc(doc(salesmanDb(), "products", "p1")));
  });

  it("can read social_offers, or the catalog would show pre-sale prices", async () => {
    await assertSucceeds(getDoc(doc(salesmanDb(), "social_offers", "so1")));
  });

  it("cannot write products", async () => {
    await assertFails(setDoc(doc(salesmanDb(), "products", "p1"), { name: "Tampered" }));
  });

  it("cannot write social_offers — reading a price is not setting one", async () => {
    await assertFails(setDoc(doc(salesmanDb(), "social_offers", "so2"), { title: "Mine" }));
  });

  // Two collections, and two only. Everything below is the business the salesman never sees.
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

  it("an unauthenticated visitor cannot read social_offers either", async () => {
    await assertFails(getDoc(doc(anonDb(), "social_offers", "so1")));
  });
});

describe("clerk keeps every read its pages depend on", () => {
  // Sales page: invoices + returns + customers. Sales detail: invoice items.
  // Customers page: customers + invoices + the engagement tier thresholds.
  // Products, Inventory and Traders came later, when the clerk stopped needing an
  // admin to run the shop.
  for (const [collectionName, docId] of [
    ["products", "p1"],
    ["customers", "c1"],
    ["invoices", "i1"],
    ["invoice_items", "ii1"],
    ["invoice_returns", "r1"],
    ["invoice_return_items", "ri1"],
    ["expenses", "e1"],
    // The invoice form prices its lines from live offers.
    ["social_offers", "so1"],
    // Posting an invoice, and seeing what it cost.
    ["sales", "s1"],
    ["stock_lots", "l1"],
    ["lot_consumptions", "lc1"],
    ["invoice_item_cogs", "ic1"],
    // Inventory page: movements, discards, and the health card's latest run.
    ["inventory_transactions", "it1"],
    ["inventory_discards", "d1"],
    ["inventory_validation_runs", "vr1"],
    ["physical_stock_corrections", "pc1"],
    // Suppliers.
    ["traders", "t1"],
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

  it("cannot author an offer — consuming a price must not imply setting one", async () => {
    await assertFails(setDoc(doc(clerkDb(), "social_offers", "so3"), { title: "Clerk sale" }));
  });
});

describe("clerk runs the shop", () => {
  it("can set a product's sale price", async () => {
    await assertSucceeds(
      setDoc(doc(clerkDb(), "products", "p1"), { name: "Widget", sale_price: 120, cost_price: 40 }),
    );
  });

  it("can add a supplier", async () => {
    await assertSucceeds(
      setDoc(doc(clerkDb(), "traders", "t2"), {
        name: "New Supplier",
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });
});

/**
 * The other half of the boundary. Everything above says a clerk may run the shop;
 * this says what "runs the shop" stops short of. A rule change that widened one of
 * these would otherwise pass unnoticed — the app would simply start working.
 */
describe("the clerk still cannot touch the money, or who may use the app", () => {
  it("cannot read the cash ledger", async () => {
    await assertFails(getDoc(doc(clerkDb(), "cash_entries", "ce1")));
  });

  it("cannot write a cash entry", async () => {
    await assertFails(
      setDoc(doc(clerkDb(), "cash_entries", "ce2"), { amount: 100, entry_type: "add" }),
    );
  });

  it("cannot read settings/cash — the opening balance is the owner's number", async () => {
    await assertFails(getDoc(doc(clerkDb(), "settings", "cash")));
  });

  it("cannot change a setting", async () => {
    await assertFails(setDoc(doc(clerkDb(), "settings", "cash"), { opening_balance: 0 }));
  });

  it("cannot read loan parties", async () => {
    await assertFails(getDoc(doc(clerkDb(), "parties", "pa1")));
  });

  it("cannot delete a customer — archiving is the reversible way", async () => {
    await assertFails(deleteDoc(doc(clerkDb(), "customers", "c1")));
  });

  it("cannot delete a trader", async () => {
    await assertFails(deleteDoc(doc(clerkDb(), "traders", "t1")));
  });

  it("cannot merge customers", async () => {
    await assertFails(
      setDoc(doc(clerkDb(), "customer_merges", "cm2"), { keep_customer_id: "c1" }),
    );
  });

  it("cannot read the role audit", async () => {
    await assertFails(getDoc(doc(clerkDb(), "user_admin_audit", "ua1")));
  });
});

/**
 * The offer discount rides on the invoice line as its own field so the receipt can show the
 * saving. That means the line's arithmetic identity has a second form, and BOTH must hold —
 * lines written before offers existed carry neither key.
 */
describe("invoice_items carrying an offer discount", () => {
  function line(over = {}) {
    return {
      invoice_id: "INV-20260815-1234",
      order_id: "INV-20260815-1234",
      customer_id: "c1",
      product_id: "p1",
      quantity: 10,
      unit_price: 1500,
      line_discount: 500,
      line_delivery_charge: 0,
      // 15000 - 500 (clerk) - 1050 (offer) = 13450
      offer_discount: 1050,
      offer_label: "Week Clearance",
      line_total: 13450,
      created_at: new Date(),
      updated_at: new Date(),
      ...over,
    };
  }

  it("accepts a line whose total accounts for the offer", async () => {
    await assertSucceeds(setDoc(doc(clerkDb(), "invoice_items", "off1"), line()));
  });

  it("rejects a line whose total ignores the offer discount", async () => {
    await assertFails(
      setDoc(doc(clerkDb(), "invoice_items", "off2"), line({ line_total: 14500 })),
    );
  });

  it("rejects a negative offer discount", async () => {
    await assertFails(
      setDoc(
        doc(clerkDb(), "invoice_items", "off3"),
        line({ offer_discount: -50, line_total: 14550 }),
      ),
    );
  });

  it("rejects an offer label that is not a string", async () => {
    await assertFails(setDoc(doc(clerkDb(), "invoice_items", "off4"), line({ offer_label: 7 })));
  });

  it("still accepts a legacy line carrying neither offer field", async () => {
    const legacy = line();
    delete legacy.offer_discount;
    delete legacy.offer_label;
    legacy.line_total = 14500;
    await assertSucceeds(setDoc(doc(clerkDb(), "invoice_items", "off5"), legacy));
  });

  it("still rejects an unknown extra field", async () => {
    await assertFails(
      setDoc(doc(clerkDb(), "invoice_items", "off6"), line({ smuggled_field: true })),
    );
  });
});
