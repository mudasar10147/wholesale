/**
 * Pure reconciliation planner — the derivation at the heart of M0.5 baseline
 * remediation (PHASE1_INTEGRITY_ARCHITECTURE_V2.md §19.0.5-M).
 *
 * No Firestore, no side effects: given a product's book stock, its lots, and its
 * append-only consumption / discard / restoration history, it computes each lot's
 * HISTORY-IMPLIED remaining quantity and the corrections needed to make P1 and L6
 * hold — or it refuses, when the history itself is broken.
 *
 * Lots are never selected by FIFO or by judgement. Every lot is corrected to its
 * own derived value `h_i`, so L6 is green by construction (M.3). This file is
 * exercised directly by the unit tests AND re-used, unchanged, by the applier —
 * so the test is testing the real derivation, not a mock of it (§12.1).
 */

import type { InventoryRepairAuthority } from "@/lib/types/firestore";

export type PlanLot = {
  lot_id: string;
  qty_in: number;
  qty_remaining: number;
  /** FIFO ordering and costing depend on received_at; a lot missing it is an escalation. */
  has_received_at: boolean;
};

export type ReconciliationGateFailure =
  | { code: "LOT_HISTORY_NEGATIVE"; lot_id: string; history_implied: number }
  | { code: "LOT_HISTORY_EXCEEDS_INTAKE"; lot_id: string; history_implied: number; qty_in: number }
  | { code: "LOT_TOTAL_NEGATIVE"; l_hist: number }
  | { code: "LOT_MISSING_RECEIVED_AT"; lot_id: string }
  | { code: "DANGLING_CONSUMPTION_REF"; detail: string }
  | { code: "INVALID_INPUT"; detail: string };

export type ReconciliationLotCorrectionPlan = {
  lot_id: string;
  qty_in: number;
  before: number;
  after: number;
  delta: number;
  history_implied: number;
};

export type ReconciliationPlan = {
  /** True only when no gate failed. A false plan must never be applied. */
  ok: boolean;
  gateFailures: ReconciliationGateFailure[];
  lotCorrections: ReconciliationLotCorrectionPlan[];
  /** Σ history-implied remaining = the corrected lot total. */
  lHist: number;
  bookBefore: number;
  lotTotalBefore: number;
  /** Book reconciliation delta applied to stock_quantity only: lHist − book. */
  bookReconciliation: number;
  physicalCount: number | null;
  /** Physical adjustment delta (real movement): P − lHist, else 0. */
  physicalDelta: number;
  /** Final on-hand after the whole repair: physical count if given, else lHist. */
  finalQuantity: number;
  /** True when the product is already consistent and no count differs — nothing to do. */
  isNoop: boolean;
};

export type CountByLot = Map<string, number> | Record<string, number>;

export type ReconciliationPlanInput = {
  book: number;
  lots: PlanLot[];
  /** Σ quantity of ACTIVE (not reversed) lot_consumptions, per lot_id. */
  activeConsumptionByLot: CountByLot;
  /** Σ quantity of inventory_discard_lots allocations, per lot_id. */
  discardAllocByLot: CountByLot;
  /** Σ quantity of return_lot_restorations, per lot_id. */
  restorationByLot: CountByLot;
  /** Verified physical count, when one was performed. */
  physicalCount?: number | null;
  /** Consumption/discard/restoration rows referencing a lot not in `lots` (broken history). */
  danglingRefs?: string[];
};

function lookup(map: CountByLot, key: string): number {
  const v = map instanceof Map ? map.get(key) : map[key];
  return typeof v === "number" ? v : 0;
}

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/**
 * `h_i = qty_in − Σ active consumptions − Σ discard allocations + Σ restorations`
 * (M.3 — the L6 identity rearranged).
 */
export function deriveLotHistory(
  lot: PlanLot,
  activeConsumptionByLot: CountByLot,
  discardAllocByLot: CountByLot,
  restorationByLot: CountByLot,
): number {
  return (
    lot.qty_in -
    lookup(activeConsumptionByLot, lot.lot_id) -
    lookup(discardAllocByLot, lot.lot_id) +
    lookup(restorationByLot, lot.lot_id)
  );
}

export function computeReconciliationPlan(input: ReconciliationPlanInput): ReconciliationPlan {
  const gateFailures: ReconciliationGateFailure[] = [];

  if (!Number.isInteger(input.book)) {
    gateFailures.push({ code: "INVALID_INPUT", detail: `book stock is not an integer: ${input.book}` });
  }
  if (input.physicalCount != null && !isNonNegInt(input.physicalCount)) {
    gateFailures.push({
      code: "INVALID_INPUT",
      detail: `physical count must be a non-negative integer: ${input.physicalCount}`,
    });
  }
  for (const ref of input.danglingRefs ?? []) {
    gateFailures.push({ code: "DANGLING_CONSUMPTION_REF", detail: ref });
  }

  const lotCorrections: ReconciliationLotCorrectionPlan[] = [];
  let lHist = 0;
  let lotTotalBefore = 0;

  for (const lot of input.lots) {
    if (!Number.isInteger(lot.qty_in) || lot.qty_in < 0) {
      gateFailures.push({ code: "INVALID_INPUT", detail: `lot ${lot.lot_id} qty_in invalid: ${lot.qty_in}` });
    }
    if (!lot.has_received_at) {
      gateFailures.push({ code: "LOT_MISSING_RECEIVED_AT", lot_id: lot.lot_id });
    }
    const h = deriveLotHistory(
      lot,
      input.activeConsumptionByLot,
      input.discardAllocByLot,
      input.restorationByLot,
    );
    if (h < 0) {
      gateFailures.push({ code: "LOT_HISTORY_NEGATIVE", lot_id: lot.lot_id, history_implied: h });
    }
    if (h > lot.qty_in) {
      gateFailures.push({
        code: "LOT_HISTORY_EXCEEDS_INTAKE",
        lot_id: lot.lot_id,
        history_implied: h,
        qty_in: lot.qty_in,
      });
    }
    lHist += h;
    lotTotalBefore += typeof lot.qty_remaining === "number" ? lot.qty_remaining : 0;
    lotCorrections.push({
      lot_id: lot.lot_id,
      qty_in: lot.qty_in,
      before: lot.qty_remaining,
      after: h,
      delta: h - lot.qty_remaining,
      history_implied: h,
    });
  }

  if (lHist < 0) {
    gateFailures.push({ code: "LOT_TOTAL_NEGATIVE", l_hist: lHist });
  }

  const physicalCount = input.physicalCount ?? null;
  const physicalDelta = physicalCount != null && physicalCount !== lHist ? physicalCount - lHist : 0;
  const finalQuantity = physicalCount != null ? physicalCount : lHist;
  const bookReconciliation = lHist - input.book;

  const ok = gateFailures.length === 0;
  const isNoop =
    ok &&
    bookReconciliation === 0 &&
    physicalDelta === 0 &&
    lotCorrections.every((c) => c.delta === 0);

  return {
    ok,
    gateFailures,
    lotCorrections,
    lHist,
    bookBefore: input.book,
    lotTotalBefore,
    bookReconciliation,
    physicalCount,
    physicalDelta,
    finalQuantity,
    isNoop,
  };
}

/** Authority categories that permit unattended repair (everything except administrative). */
export function requiresSecondApprover(authority: InventoryRepairAuthority): boolean {
  return authority === "administrative";
}
