/**
 * Emulator proof for the Physical Stock Correction tool.
 * Run: npm run test:physical-recount   (boots the Firestore emulator, needs Java)
 *
 * Exercises the REAL applyPhysicalCorrection / previewPhysicalCorrection /
 * searchProductsForCorrection against the emulator via the Admin SDK (the same
 * identity the endpoint uses). Covers, per the spec matrix:
 *   incorrect stock/lot totals · positive count · zero count · shrinkage · surplus ·
 *   cost sources (latest stock-in / product cost / manual) · missing cost (rejected) ·
 *   duplicate submission (idempotent) · concurrent same-key · ambiguous/unknown product ·
 *   product changed after preview (STALE) · fresh read on the next correction ·
 *   post-update validator success (P1 green; recount-closed lots excluded from L6).
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  applyPhysicalCorrection,
  previewPhysicalCorrection,
  searchProductsForCorrection,
} from "@/lib/inventory/physicalStockCorrection";
import { assertAllInvariants } from "@/test/helpers/assertAllInvariants";
import { validateInventoryData } from "@/lib/inventory/validateInventory";
import { loadAllInventory } from "@/lib/inventory/validationRun";

const PROJECT = "wholesale-rules-test";
let app;
let db;
let counter = 0;

function uid(prefix) {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
}

async function seedProduct(id, spec) {
  const now = Timestamp.now();
  await db.collection("products").doc(id).set({
    name: spec.name ?? `Product ${id}`,
    cost_price: spec.costPrice ?? 10,
    sale_price: 20,
    stock_quantity: spec.book,
    ...(spec.image_url ? { image_url: spec.image_url } : {}),
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
      received_at: lot.received_at != null ? Timestamp.fromMillis(lot.received_at) : now,
      created_at: now,
      updated_at: now,
    });
  }
  let cIdx = 0;
  for (const c of spec.consumptions ?? []) {
    cIdx += 1;
    await db.collection("lot_consumptions").doc(`${id}-cons-${cIdx}`).set({
      invoice_id: "inv1",
      order_id: "order1",
      invoice_item_id: "ii1",
      product_id: id,
      lot_id: c.lot_id,
      quantity: c.quantity,
      unit_cost: 10,
      cogs_amount: 10 * c.quantity,
      created_at: now,
    });
  }
}

const getProduct = async (id) => (await db.collection("products").doc(id).get()).data();
async function getLots(id) {
  const snap = await db.collection("stock_lots").where("product_id", "==", id).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
const openLots = (lots) => lots.filter((l) => (l.qty_remaining ?? 0) > 0);
const lotSum = (lots) => lots.reduce((s, l) => s + (l.qty_remaining ?? 0), 0);
async function getCorrections(productId) {
  const snap = await db
    .collection("physical_stock_corrections")
    .where("product_id", "==", productId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function adjustmentLinesFor(productId) {
  const snap = await db
    .collection("inventory_transaction_lines")
    .where("product_id", "==", productId)
    .get();
  return snap.docs.map((d) => d.data());
}

function args(over) {
  return {
    productId: over.productId,
    physicalCount: over.physicalCount,
    manualUnitCost: over.manualUnitCost ?? null,
    reason: over.reason ?? "recount test",
    recountSessionId: over.recountSessionId ?? "sess-1",
    idempotencyKey: over.idempotencyKey ?? uid("key"),
    operatorUid: "admin-uid",
    operatorEmail: "admin@example.com",
    expectedCurrentStock: over.expectedCurrentStock,
    expectedOpenLotTotal: over.expectedOpenLotTotal,
  };
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST must be set (run via emulators:exec)");
  app = initializeApp({ projectId: PROJECT });
  db = getFirestore(app);
});
after(async () => {
  await deleteApp(app);
});
beforeEach(async () => {
  await clearFirestore();
});

describe("physical stock correction", () => {
  it("surplus: sets a positive count, closes old lots, creates one baseline lot, validator green", async () => {
    const id = uid("p");
    await seedProduct(id, { book: 40, lots: [{ id: `${id}-l1`, qty_in: 50, qty_remaining: 40, unit_cost: 12 }] });

    const res = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 45, expectedCurrentStock: 40, expectedOpenLotTotal: 40,
    }));
    assert.equal(res.status, "applied");
    assert.equal(res.correction.stock_delta, 5);
    assert.equal(res.correction.cost_source, "latest_stock_in");
    assert.equal(res.correction.unit_cost, 12);
    assert.ok(res.correction.post_update_validation.ok);

    const lots = await getLots(id);
    const open = openLots(lots);
    assert.equal((await getProduct(id)).stock_quantity, 45);
    assert.equal(lotSum(open), 45);
    assert.equal(open.length, 1, "exactly one open baseline lot");
    assert.equal(open[0].source, "adjustment");
    assert.equal(open[0].recount_baseline, true);
    const closed = lots.filter((l) => l.closed_by_recount === true);
    assert.equal(closed.length, 1, "old lot closed, not deleted");

    const lines = await adjustmentLinesFor(id);
    assert.ok(lines.some((l) => l.direction === "in" && l.quantity === 5));

    const report = await assertAllInvariants(db); // throws on any blocking violation
    assert.equal(report.issues.filter((i) => i.invariant_id === "P1").length, 0, "P1 green");
    assert.equal(report.issues.filter((i) => i.invariant_id === "L6").length, 0, "L6 green");
  });

  it("shrinkage: count below book records an 'out' movement", async () => {
    const id = uid("p");
    await seedProduct(id, { book: 40, lots: [{ id: `${id}-l1`, qty_in: 40, qty_remaining: 40, unit_cost: 9 }] });
    const res = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 32, expectedCurrentStock: 40, expectedOpenLotTotal: 40,
    }));
    assert.equal(res.status, "applied");
    assert.equal(res.correction.stock_delta, -8);
    assert.equal((await getProduct(id)).stock_quantity, 32);
    assert.equal(lotSum(openLots(await getLots(id))), 32);
    const lines = await adjustmentLinesFor(id);
    assert.ok(lines.some((l) => l.direction === "out" && l.quantity === 8));
    await assertAllInvariants(db);
  });

  it("zero count: no new open lot, stock and lots both zero", async () => {
    const id = uid("p");
    await seedProduct(id, { book: 10, lots: [{ id: `${id}-l1`, qty_in: 10, qty_remaining: 10 }] });
    const res = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 0, expectedCurrentStock: 10, expectedOpenLotTotal: 10,
    }));
    assert.equal(res.status, "applied");
    assert.equal(res.correction.new_lot_id, null);
    assert.equal((await getProduct(id)).stock_quantity, 0);
    assert.equal(openLots(await getLots(id)).length, 0, "no open lot for a zero count");
    await assertAllInvariants(db);
  });

  it("incorrect book-vs-lot totals: fixes P1 to the counted number", async () => {
    const id = uid("p");
    // book 100 but lots sum to 103 (untrusted history) — the classic drift.
    await seedProduct(id, {
      book: 100,
      lots: [
        { id: `${id}-a`, qty_in: 60, qty_remaining: 60 },
        { id: `${id}-b`, qty_in: 43, qty_remaining: 43 },
      ],
    });
    const res = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 98, expectedCurrentStock: 100, expectedOpenLotTotal: 103,
    }));
    assert.equal(res.status, "applied");
    assert.equal((await getProduct(id)).stock_quantity, 98);
    assert.equal(lotSum(openLots(await getLots(id))), 98);
    assert.equal(openLots(await getLots(id)).length, 1);
    await assertAllInvariants(db);
  });

  it("cost source: latest valid stock-in cost wins over an older one", async () => {
    const id = uid("p");
    await seedProduct(id, {
      book: 5,
      lots: [
        { id: `${id}-old`, qty_in: 5, qty_remaining: 2, unit_cost: 10, source: "stock_in", received_at: 1000 },
        { id: `${id}-new`, qty_in: 5, qty_remaining: 3, unit_cost: 15, source: "stock_in", received_at: 5000 },
      ],
    });
    const res = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 7, expectedCurrentStock: 5, expectedOpenLotTotal: 5,
    }));
    assert.equal(res.status, "applied");
    assert.equal(res.correction.cost_source, "latest_stock_in");
    assert.equal(res.correction.unit_cost, 15);
  });

  it("cost override: a manual unit cost wins over the auto-resolved stock-in cost", async () => {
    const id = uid("p");
    // latest stock-in cost is 130 (only 10 pieces), but the bulk really cost 52.
    await seedProduct(id, {
      book: 10,
      lots: [{ id: `${id}-l`, qty_in: 10, qty_remaining: 10, unit_cost: 130, source: "stock_in", received_at: 9000 }],
    });
    const res = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 1000, manualUnitCost: 52,
      expectedCurrentStock: 10, expectedOpenLotTotal: 10,
    }));
    assert.equal(res.status, "applied");
    assert.equal(res.correction.cost_source, "manual");
    assert.equal(res.correction.unit_cost, 52);
    const open = openLots(await getLots(id));
    assert.equal(open[0].unit_cost, 52, "new baseline lot uses the overridden cost");
    assert.equal((await getProduct(id)).cost_price, 52, "product cost_price follows the override");
  });

  it("cost source: falls back to product cost_price when no stock-in lot", async () => {
    const id = uid("p");
    await seedProduct(id, {
      book: 4, costPrice: 8,
      lots: [{ id: `${id}-o`, qty_in: 4, qty_remaining: 4, unit_cost: 0, source: "opening_balance" }],
    });
    const res = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 6, expectedCurrentStock: 4, expectedOpenLotTotal: 4,
    }));
    assert.equal(res.status, "applied");
    assert.equal(res.correction.cost_source, "product_cost_price");
    assert.equal(res.correction.unit_cost, 8);
  });

  it("missing cost: rejects a positive count and writes nothing; manual cost then works", async () => {
    const id = uid("p");
    await seedProduct(id, {
      book: 3, costPrice: 0,
      lots: [{ id: `${id}-o`, qty_in: 3, qty_remaining: 3, unit_cost: 0, source: "opening_balance" }],
    });
    const rejected = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 9, expectedCurrentStock: 3, expectedOpenLotTotal: 3,
    }));
    assert.equal(rejected.status, "cost_required");
    assert.equal((await getProduct(id)).stock_quantity, 3, "nothing changed on rejection");
    assert.equal((await getCorrections(id)).length, 0, "no audit record written");

    const ok = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 9, manualUnitCost: 7.5,
      expectedCurrentStock: 3, expectedOpenLotTotal: 3,
    }));
    assert.equal(ok.status, "applied");
    assert.equal(ok.correction.cost_source, "manual");
    assert.equal(ok.correction.unit_cost, 7.5);
  });

  it("negative and non-integer counts are rejected", async () => {
    const id = uid("p");
    await seedProduct(id, { book: 5, lots: [{ id: `${id}-l`, qty_in: 5, qty_remaining: 5 }] });
    const neg = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: -1, expectedCurrentStock: 5, expectedOpenLotTotal: 5,
    }));
    assert.equal(neg.status, "invalid_count");
    const frac = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 2.5, expectedCurrentStock: 5, expectedOpenLotTotal: 5,
    }));
    assert.equal(frac.status, "invalid_count");
    assert.equal((await getCorrections(id)).length, 0);
  });

  it("duplicate submission with the same key is idempotent (one write only)", async () => {
    const id = uid("p");
    await seedProduct(id, { book: 20, lots: [{ id: `${id}-l`, qty_in: 20, qty_remaining: 20, unit_cost: 11 }] });
    const key = uid("dupkey");
    const first = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 18, idempotencyKey: key, expectedCurrentStock: 20, expectedOpenLotTotal: 20,
    }));
    const second = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 18, idempotencyKey: key, expectedCurrentStock: 20, expectedOpenLotTotal: 20,
    }));
    assert.equal(first.status, "applied");
    assert.equal(second.status, "already_applied");
    assert.equal((await getCorrections(id)).length, 1, "exactly one audit record");
    assert.equal(openLots(await getLots(id)).length, 1, "exactly one baseline lot");
    assert.equal((await getProduct(id)).stock_quantity, 18, "not double-applied");
  });

  it("concurrent same-key submissions commit exactly once", async () => {
    const id = uid("p");
    await seedProduct(id, { book: 30, lots: [{ id: `${id}-l`, qty_in: 30, qty_remaining: 30, unit_cost: 5 }] });
    const key = uid("conckey");
    const both = await Promise.allSettled([
      applyPhysicalCorrection(db, args({ productId: id, physicalCount: 25, idempotencyKey: key, expectedCurrentStock: 30, expectedOpenLotTotal: 30 })),
      applyPhysicalCorrection(db, args({ productId: id, physicalCount: 25, idempotencyKey: key, expectedCurrentStock: 30, expectedOpenLotTotal: 30 })),
    ]);
    const statuses = both.map((r) => (r.status === "fulfilled" ? r.value.status : "rejected"));
    assert.ok(statuses.includes("applied"), `one applied: ${statuses}`);
    assert.equal((await getCorrections(id)).length, 1, "exactly one audit record under contention");
    assert.equal(openLots(await getLots(id)).length, 1);
    assert.equal((await getProduct(id)).stock_quantity, 25);
    await assertAllInvariants(db);
  });

  it("stale preview: rejects when the product changed since preview; writes nothing", async () => {
    const id = uid("p");
    await seedProduct(id, { book: 12, lots: [{ id: `${id}-l`, qty_in: 12, qty_remaining: 12 }] });
    const preview = await previewPhysicalCorrection(db, id);
    assert.equal(preview.status, "ok");
    // someone else changes stock after the preview was captured
    await db.collection("products").doc(id).update({ stock_quantity: 7 });
    const res = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 10,
      expectedCurrentStock: preview.product.stock_quantity, // stale (12)
      expectedOpenLotTotal: preview.before_lot_total,
    }));
    assert.equal(res.status, "stale_preview");
    assert.equal(res.current_stock, 7);
    assert.equal((await getCorrections(id)).length, 0, "nothing written on stale");
    assert.equal((await getProduct(id)).stock_quantity, 7, "untouched");
  });

  it("the next correction reads fresh state (sequential re-baseline)", async () => {
    const id = uid("p");
    await seedProduct(id, { book: 10, lots: [{ id: `${id}-l`, qty_in: 10, qty_remaining: 10, unit_cost: 4 }] });
    const first = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 10, expectedCurrentStock: 10, expectedOpenLotTotal: 10,
    }));
    assert.equal(first.status, "applied");
    // fresh preview reflects the new baseline
    const p2 = await previewPhysicalCorrection(db, id);
    assert.equal(p2.product.stock_quantity, 10);
    assert.equal(p2.before_lot_total, 10);
    const second = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 6,
      expectedCurrentStock: p2.product.stock_quantity, expectedOpenLotTotal: p2.before_lot_total,
    }));
    assert.equal(second.status, "applied");
    assert.equal(second.correction.before_book_stock, 10, "read the fresh (post-first) book");
    assert.equal(second.correction.stock_delta, -4);
    assert.equal((await getProduct(id)).stock_quantity, 6);
    assert.equal(openLots(await getLots(id)).length, 1);
    await assertAllInvariants(db);
  });

  it("unknown product: preview not_found; apply not_found; ambiguous name returns candidates", async () => {
    const a = uid("prod");
    const b = uid("prod");
    await seedProduct(a, { name: "Widget Blue", book: 1, lots: [{ id: `${a}-l`, qty_in: 1, qty_remaining: 1 }] });
    await seedProduct(b, { name: "Widget Red", book: 1, lots: [{ id: `${b}-l`, qty_in: 1, qty_remaining: 1 }] });

    assert.equal((await previewPhysicalCorrection(db, "does-not-exist")).status, "not_found");
    const applyUnknown = await applyPhysicalCorrection(db, args({
      productId: "does-not-exist", physicalCount: 1, expectedCurrentStock: 0, expectedOpenLotTotal: 0,
    }));
    assert.equal(applyUnknown.status, "not_found");

    const hits = await searchProductsForCorrection(db, "Widget");
    assert.ok(hits.length >= 2, "ambiguous name returns multiple candidates for the operator to pick");
  });

  it("recount-closed lots with prior consumptions are excluded from L6 and never deleted", async () => {
    const id = uid("p");
    // lot with history: qty_in 20, consumed 5 → history-implied remaining 15, but stored 15.
    await seedProduct(id, {
      book: 15,
      lots: [{ id: `${id}-l`, qty_in: 20, qty_remaining: 15, unit_cost: 6 }],
      consumptions: [{ lot_id: `${id}-l`, quantity: 5 }],
    });
    const res = await applyPhysicalCorrection(db, args({
      productId: id, physicalCount: 12, expectedCurrentStock: 15, expectedOpenLotTotal: 15,
    }));
    assert.equal(res.status, "applied");

    const lots = await getLots(id);
    const closed = lots.find((l) => l.id === `${id}-l`);
    assert.equal(closed.closed_by_recount, true, "old lot marked closed");
    assert.equal(closed.qty_remaining, 0, "old lot zeroed");
    assert.ok(closed.qty_in === 20, "historical qty_in preserved (not deleted)");

    // L6 would fail on the closed lot (0 != 20-5) if it were not excluded. Validate
    // directly and assert only the invariants under test: the seeded consumption has
    // no parent invoice and a demo cost, so consumption-chain invariants C3/C5 fire as
    // seed artifacts unrelated to the recount behaviour being proven here.
    const report = validateInventoryData(await loadAllInventory(db));
    assert.equal(report.issues.filter((i) => i.invariant_id === "L6").length, 0, "L6 green (closed lot excluded)");
    assert.equal(report.issues.filter((i) => i.invariant_id === "P1").length, 0, "P1 green");
  });
});
