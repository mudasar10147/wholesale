/**
 * Unit tests for the pure reconciliation planner (M0.5 §19.0.5-M).
 * Run: node --experimental-strip-types --test lib/inventory/reconciliationPlan.test.ts
 *
 * These assert the DERIVATION (h_i and the corrections) and every refusal gate,
 * with no Firestore. The emulator suite proves the same planner applied for real.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  computeReconciliationPlan,
  deriveLotHistory,
  requiresSecondApprover,
  type PlanLot,
  type ReconciliationPlanInput,
} from "./reconciliationPlan.ts";

function lot(id: string, qtyIn: number, qtyRemaining: number, hasReceivedAt = true): PlanLot {
  return { lot_id: id, qty_in: qtyIn, qty_remaining: qtyRemaining, has_received_at: hasReceivedAt };
}

function input(over: Partial<ReconciliationPlanInput> & { book: number; lots: PlanLot[] }): ReconciliationPlanInput {
  return {
    activeConsumptionByLot: {},
    discardAllocByLot: {},
    restorationByLot: {},
    ...over,
  };
}

function codes(plan: ReturnType<typeof computeReconciliationPlan>): string[] {
  return plan.gateFailures.map((f) => f.code);
}

// ── M.3 derivation ──────────────────────────────────────────────────────────

test("deriveLotHistory: qty_in − consumptions − discards + restorations", () => {
  const h = deriveLotHistory(
    lot("A", 50, 37),
    { A: 10 }, // active consumptions
    { A: 5 }, // discard allocations
    { A: 2 }, // restorations
  );
  assert.equal(h, 50 - 10 - 5 + 2); // 37
});

// ── M.5 case 1: book right, lots wrong (the canonical B=100, L=103) ───────────

test("case 1 — book right, lots wrong: 100/103 → 100/100, L6 correction only", () => {
  const plan = computeReconciliationPlan(
    input({ book: 100, lots: [lot("A", 103, 103)], activeConsumptionByLot: { A: 3 }, physicalCount: 100 }),
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.lHist, 100);
  assert.equal(plan.bookReconciliation, 0); // book already 100
  assert.equal(plan.lotCorrections[0].delta, -3); // phantom 3 removed
  assert.equal(plan.lotCorrections[0].after, 100);
  assert.equal(plan.physicalDelta, 0);
  assert.equal(plan.finalQuantity, 100);
  assert.equal(plan.isNoop, false);
});

// ── M.5 case 2: lots right, book wrong ───────────────────────────────────────

test("case 2 — lots right, book wrong: 100/103 → 103/103, book correction only", () => {
  const plan = computeReconciliationPlan(
    input({ book: 100, lots: [lot("A", 103, 103)], physicalCount: 103 }),
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.lHist, 103);
  assert.equal(plan.bookReconciliation, 3); // book raised to 103
  assert.equal(plan.lotCorrections[0].delta, 0); // lots untouched
  assert.equal(plan.physicalDelta, 0);
  assert.equal(plan.finalQuantity, 103);
});

// ── M.5 case 3: both wrong, physical differs (RECONCILIATION + ADJUSTMENT) ────

test("case 3 — both wrong, physical differs: phantom 3 reconciled, real 2 shrinkage", () => {
  const plan = computeReconciliationPlan(
    input({ book: 100, lots: [lot("A", 103, 103)], activeConsumptionByLot: { A: 3 }, physicalCount: 98 }),
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.lHist, 100);
  assert.equal(plan.lotCorrections[0].delta, -3); // reconciliation (movement:false)
  assert.equal(plan.physicalDelta, -2); // adjustment (movement:true) — real shrinkage
  assert.equal(plan.finalQuantity, 98);
  assert.equal(plan.bookReconciliation, 0);
});

// ── M.5 case 4: history broken → REFUSE ──────────────────────────────────────

test("case 4 — history broken (consumption exceeds intake): refuse", () => {
  const plan = computeReconciliationPlan(
    input({ book: 100, lots: [lot("A", 100, 100)], activeConsumptionByLot: { A: 103 } }),
  );
  assert.equal(plan.ok, false);
  assert.ok(codes(plan).includes("LOT_HISTORY_NEGATIVE"));
  assert.ok(codes(plan).includes("LOT_TOTAL_NEGATIVE"));
});

// ── Refusal gates ────────────────────────────────────────────────────────────

test("gate — restorations push history above intake: refuse", () => {
  const plan = computeReconciliationPlan(
    input({ book: 100, lots: [lot("A", 100, 100)], restorationByLot: { A: 5 } }),
  );
  assert.equal(plan.ok, false);
  assert.ok(codes(plan).includes("LOT_HISTORY_EXCEEDS_INTAKE"));
});

test("gate — lot missing received_at: refuse", () => {
  const plan = computeReconciliationPlan(
    input({ book: 10, lots: [lot("A", 10, 10, false)] }),
  );
  assert.equal(plan.ok, false);
  assert.ok(codes(plan).includes("LOT_MISSING_RECEIVED_AT"));
});

test("gate — dangling consumption reference: refuse", () => {
  const plan = computeReconciliationPlan(
    input({ book: 10, lots: [lot("A", 10, 10)], danglingRefs: ["consumption c1 -> missing lot X"] }),
  );
  assert.equal(plan.ok, false);
  assert.ok(codes(plan).includes("DANGLING_CONSUMPTION_REF"));
});

test("gate — non-integer book / negative physical count: refuse", () => {
  const p1 = computeReconciliationPlan(input({ book: 10.5, lots: [lot("A", 10, 10)] }));
  assert.equal(p1.ok, false);
  assert.ok(codes(p1).includes("INVALID_INPUT"));

  const p2 = computeReconciliationPlan(input({ book: 10, lots: [lot("A", 10, 10)], physicalCount: -1 }));
  assert.equal(p2.ok, false);
  assert.ok(codes(p2).includes("INVALID_INPUT"));
});

// ── Multi-lot derivation across all three terms ──────────────────────────────

test("multi-lot: per-lot history is derived independently, lHist sums correctly", () => {
  const plan = computeReconciliationPlan(
    input({
      book: 999, // deliberately wrong
      lots: [lot("A", 50, 50), lot("B", 40, 40)],
      activeConsumptionByLot: { A: 10, B: 5 },
      discardAllocByLot: { A: 5 },
      restorationByLot: { B: 2 },
    }),
  );
  // h_A = 50 - 10 - 5 + 0 = 35 ; h_B = 40 - 5 - 0 + 2 = 37 ; lHist = 72
  assert.equal(plan.ok, true);
  assert.equal(plan.lHist, 72);
  assert.equal(plan.lotCorrections.find((c) => c.lot_id === "A")!.after, 35);
  assert.equal(plan.lotCorrections.find((c) => c.lot_id === "B")!.after, 37);
  assert.equal(plan.bookReconciliation, 72 - 999);
});

// ── Idempotency / no-op ──────────────────────────────────────────────────────

test("noop — already consistent product: nothing to do", () => {
  const plan = computeReconciliationPlan(input({ book: 100, lots: [lot("A", 100, 100)] }));
  assert.equal(plan.ok, true);
  assert.equal(plan.isNoop, true);
  assert.equal(plan.bookReconciliation, 0);
  assert.equal(plan.lotCorrections[0].delta, 0);
});

// ── Authority ────────────────────────────────────────────────────────────────

test("administrative authority requires a second approver", () => {
  assert.equal(requiresSecondApprover("administrative"), true);
  assert.equal(requiresSecondApprover("physical_count"), false);
  assert.equal(requiresSecondApprover("consumption_history"), false);
});
