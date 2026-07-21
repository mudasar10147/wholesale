/**
 * M0.5 baseline reconciliation — TEMPORARY TOOL, deleted in M6.
 * (PHASE1_INTEGRITY_ARCHITECTURE_V2.md §19.0.5-M, §15.3.)
 *
 * The ONLY code permitted to move one layer (book or lots) without the other.
 * That power is contained by three rules (M.7):
 *   1. It asserts the POST-state, never the pre-state — it begins from a
 *      violating state (its purpose) but refuses to commit unless P1 AND L6 both
 *      hold afterwards. Stronger than the normal path, which asserts P1 only.
 *   2. One transaction per product, product read FIRST as the concurrency anchor,
 *      and the plan is recomputed from FRESH reads inside the transaction.
 *   3. Every correction is derived (reconciliationPlan.ts) and recorded per lot,
 *      so the repair is reconstructable without this tool.
 *
 * Runs under the Admin SDK (the `inventory-repair` identity, §13) — never in the
 * UI. Writes are ABSOLUTE (qty_remaining := history_implied, stock := lHist) and
 * keyed by deterministic ids, so the operation is idempotent: re-running a
 * repaired product is a no-op and creates no duplicate ledger or repair rows.
 */

import { FieldValue, type Firestore, type Query } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  computeReconciliationPlan,
  requiresSecondApprover,
  type ReconciliationPlan,
  type ReconciliationPlanInput,
} from "@/lib/inventory/reconciliationPlan";
import type { InventoryRepairAuthority } from "@/lib/types/firestore";

const DEFAULT_WAREHOUSE_ID = "default";

export type ReconcileProductParams = {
  productId: string;
  /** Verified physical count, when one was performed. Omit for pure book/lot reconciliation. */
  physicalCount?: number | null;
  authorityCategory: InventoryRepairAuthority;
  reasonDetail: string;
  /** The M0 baseline validation run this repair is attributed to. */
  validationRunId: string;
  actedByUid: string;
  /** Required when authorityCategory is `administrative` (the second signature). */
  approvedByUid?: string;
  warehouseId?: string;
  /** When true, computes and returns the plan but writes nothing. Default true at the CLI. */
  dryRun?: boolean;
};

export type ReconcileStatus = "applied" | "dry_run" | "noop" | "refused" | "already_repaired";

export type ReconcileResult = {
  status: ReconcileStatus;
  productId: string;
  plan?: ReconciliationPlan;
  repairId?: string;
  reconciliationLedgerId?: string;
  physicalAdjustmentLedgerId?: string;
  refusalReasons?: string[];
};

function safeId(part: string): string {
  return part.replace(/[/\s]/g, "_");
}

function txnNumber(prefix: string, runId: string, productId: string): string {
  return `${prefix}-${safeId(runId)}-${safeId(productId)}`.slice(0, 1400);
}

/** Build the pure-planner input from a product doc + its history docs. */
function buildPlanInput(
  productData: FirebaseFirestore.DocumentData,
  lotDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  consumptionDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  discardDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  restorationDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  physicalCount: number | null,
): ReconciliationPlanInput {
  const lotIds = new Set(lotDocs.map((d) => d.id));

  const activeConsumptionByLot = new Map<string, number>();
  const danglingRefs: string[] = [];
  for (const d of consumptionDocs) {
    const c = d.data();
    if (c.reversed_at) continue; // reversed consumptions net to zero on the lot
    if (!lotIds.has(c.lot_id)) {
      danglingRefs.push(`consumption ${d.id} -> missing lot ${c.lot_id}`);
      continue;
    }
    activeConsumptionByLot.set(c.lot_id, (activeConsumptionByLot.get(c.lot_id) ?? 0) + (c.quantity ?? 0));
  }

  const discardAllocByLot = new Map<string, number>();
  for (const d of discardDocs) {
    const a = d.data();
    if (!lotIds.has(a.lot_id)) {
      danglingRefs.push(`discard alloc ${d.id} -> missing lot ${a.lot_id}`);
      continue;
    }
    discardAllocByLot.set(a.lot_id, (discardAllocByLot.get(a.lot_id) ?? 0) + (a.quantity ?? 0));
  }

  const restorationByLot = new Map<string, number>();
  for (const d of restorationDocs) {
    const r = d.data();
    if (!lotIds.has(r.lot_id)) {
      danglingRefs.push(`restoration ${d.id} -> missing lot ${r.lot_id}`);
      continue;
    }
    restorationByLot.set(r.lot_id, (restorationByLot.get(r.lot_id) ?? 0) + (r.quantity ?? 0));
  }

  return {
    book: typeof productData.stock_quantity === "number" ? productData.stock_quantity : 0,
    lots: lotDocs.map((d) => {
      const l = d.data();
      return {
        lot_id: d.id,
        qty_in: typeof l.qty_in === "number" ? l.qty_in : 0,
        qty_remaining: typeof l.qty_remaining === "number" ? l.qty_remaining : 0,
        has_received_at: l.received_at != null,
      };
    }),
    activeConsumptionByLot,
    discardAllocByLot,
    restorationByLot,
    physicalCount,
    danglingRefs,
  };
}

function productHistoryQueries(db: Firestore, productId: string): {
  lots: Query;
  consumptions: Query;
  discards: Query;
  restorations: Query;
} {
  return {
    lots: db.collection(COLLECTIONS.stockLots).where("product_id", "==", productId),
    consumptions: db.collection(COLLECTIONS.lotConsumptions).where("product_id", "==", productId),
    discards: db.collection(COLLECTIONS.inventoryDiscardLots).where("product_id", "==", productId),
    restorations: db.collection(COLLECTIONS.returnLotRestorations).where("product_id", "==", productId),
  };
}

function formatGateFailures(plan: ReconciliationPlan): string[] {
  return plan.gateFailures.map((f) => {
    switch (f.code) {
      case "LOT_HISTORY_NEGATIVE":
        return `lot ${f.lot_id}: history-implied remaining ${f.history_implied} < 0 (consumption exceeds intake)`;
      case "LOT_HISTORY_EXCEEDS_INTAKE":
        return `lot ${f.lot_id}: history-implied ${f.history_implied} > qty_in ${f.qty_in}`;
      case "LOT_TOTAL_NEGATIVE":
        return `history-implied lot total ${f.l_hist} < 0`;
      case "LOT_MISSING_RECEIVED_AT":
        return `lot ${f.lot_id}: missing received_at (FIFO order at risk)`;
      case "DANGLING_CONSUMPTION_REF":
        return `dangling reference: ${f.detail}`;
      case "INVALID_INPUT":
        return `invalid input: ${f.detail}`;
      default:
        return "unknown gate failure";
    }
  });
}

/**
 * Reconcile a single product. See the module header for the guarantees.
 * Never throws on a business refusal (gates, missing approval, already repaired);
 * returns a status the caller logs. Throws only on genuine I/O / assertion faults.
 */
export async function reconcileProduct(
  db: Firestore,
  params: ReconcileProductParams,
): Promise<ReconcileResult> {
  const productId = params.productId;
  const warehouseId = params.warehouseId || DEFAULT_WAREHOUSE_ID;
  const physicalCount = params.physicalCount ?? null;
  const dryRun = params.dryRun ?? true;

  const repairId = `${safeId(params.validationRunId)}__${safeId(productId)}`;
  const repairRef = db.collection(COLLECTIONS.inventoryRepairs).doc(repairId);
  const reconLedgerId = txnNumber("RECON", params.validationRunId, productId);
  const reconLedgerRef = db.collection(COLLECTIONS.inventoryTransactions).doc(reconLedgerId);

  // Idempotency: a completed repair for this (run, product) is never redone.
  const existing = await repairRef.get();
  if (existing.exists) {
    return { status: "already_repaired", productId, repairId };
  }

  // Pre-plan from a non-transactional read (for dry-run and early refusal).
  const q = productHistoryQueries(db, productId);
  const productRef = db.collection(COLLECTIONS.products).doc(productId);
  const [prodSnap, lotsSnap, consSnap, discSnap, restSnap] = await Promise.all([
    productRef.get(),
    q.lots.get(),
    q.consumptions.get(),
    q.discards.get(),
    q.restorations.get(),
  ]);
  if (!prodSnap.exists) {
    return { status: "refused", productId, refusalReasons: [`product ${productId} not found`] };
  }

  const prePlan = computeReconciliationPlan(
    buildPlanInput(prodSnap.data()!, lotsSnap.docs, consSnap.docs, discSnap.docs, restSnap.docs, physicalCount),
  );

  if (!prePlan.ok) {
    return { status: "refused", productId, plan: prePlan, refusalReasons: formatGateFailures(prePlan) };
  }
  if (requiresSecondApprover(params.authorityCategory) && !params.approvedByUid) {
    return {
      status: "refused",
      productId,
      plan: prePlan,
      refusalReasons: ["authority `administrative` requires approved_by_uid (a second approver)"],
    };
  }
  if (prePlan.isNoop) {
    return { status: "noop", productId, plan: prePlan };
  }
  if (dryRun) {
    return { status: "dry_run", productId, plan: prePlan };
  }

  // ── Reconciliation transaction (M.4 steps 3+4): moves lots alone, then book
  //    alone. Product read first (anchor); plan recomputed from fresh reads. ──
  let committedPlan: ReconciliationPlan = prePlan;
  await db.runTransaction(async (tx) => {
    const freshProd = await tx.get(productRef); // ANCHOR — must be the first read
    if (!freshProd.exists) throw new Error(`product ${productId} vanished mid-reconcile`);
    const [fLots, fCons, fDisc, fRest] = await Promise.all([
      tx.get(q.lots),
      tx.get(q.consumptions),
      tx.get(q.discards),
      tx.get(q.restorations),
    ]);
    const plan = computeReconciliationPlan(
      buildPlanInput(freshProd.data()!, fLots.docs, fCons.docs, fDisc.docs, fRest.docs, physicalCount),
    );
    if (!plan.ok) {
      throw new Error(`reconcile ${productId}: gates failed on fresh read: ${formatGateFailures(plan).join("; ")}`);
    }

    // Step 3 — lot reconciliation: set each drifted lot to its history-implied value.
    for (const c of plan.lotCorrections) {
      if (c.delta === 0) continue;
      tx.update(db.collection(COLLECTIONS.stockLots).doc(c.lot_id), {
        qty_remaining: c.after,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    // Step 4 — book reconciliation: set stock_quantity to the corrected lot total.
    if (plan.bookReconciliation !== 0) {
      tx.update(productRef, { stock_quantity: plan.lHist });
    }

    // RECONCILIATION ledger row — movement:false, corrections embedded (M.6).
    tx.set(reconLedgerRef, {
      transaction_number: reconLedgerId,
      type: "RECONCILIATION",
      status: "posted",
      movement: false,
      warehouse_id: warehouseId,
      product_id: productId,
      item_ids: [],
      book_before: plan.bookBefore,
      book_after: plan.lHist,
      lot_total_before: plan.lotTotalBefore,
      lot_total_after: plan.lHist,
      lot_corrections: plan.lotCorrections
        .filter((c) => c.delta !== 0)
        .map((c) => ({
          lot_id: c.lot_id,
          qty_in: c.qty_in,
          before: c.before,
          after: c.after,
          delta: c.delta,
          history_implied: c.history_implied,
        })),
      validation_run_id: params.validationRunId,
      authority_category: params.authorityCategory,
      reason_detail: params.reasonDetail,
      posted_by_uid: params.actedByUid,
      ...(params.approvedByUid ? { approved_by_uid: params.approvedByUid } : {}),
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      posted_at: FieldValue.serverTimestamp(),
    });

    // Post-state assertion (M.7.1): refuse to commit unless P1 AND L6 both hold.
    const postLotSum = plan.lotCorrections.reduce((s, c) => s + c.after, 0);
    const postBook = plan.lHist;
    if (postBook !== postLotSum) {
      throw new Error(`reconcile ${productId}: post-state P1 violated (book ${postBook} != lots ${postLotSum})`);
    }
    for (const c of plan.lotCorrections) {
      if (c.after !== c.history_implied) {
        throw new Error(`reconcile ${productId}: post-state L6 violated on lot ${c.lot_id}`);
      }
    }
    committedPlan = plan;
  });

  // ── Step 5 — physical adjustment, ONLY when a count differs from history.
  //    A REAL movement, posted as ADJUSTMENT (movement:true), kept separate from
  //    the RECONCILIATION above. Works now because steps 3+4 restored consistency. ──
  let physicalAdjustmentLedgerId: string | undefined;
  if (committedPlan.physicalDelta !== 0) {
    physicalAdjustmentLedgerId = await applyPhysicalAdjustment(db, {
      productId,
      delta: committedPlan.physicalDelta,
      warehouseId,
      reasonDetail: `Physical count reconciliation (${params.reasonDetail})`,
      actedByUid: params.actedByUid,
      validationRunId: params.validationRunId,
    });
  }

  // Repair record — written last so it references every ledger row. `.create()`
  // makes a concurrent double-run lose the race cleanly (ALREADY_EXISTS).
  const invariantId = committedPlan.lotCorrections.some((c) => c.delta !== 0) ? "L6" : "P1";
  try {
    await repairRef.create({
      validation_run_id: params.validationRunId,
      product_id: productId,
      invariant_id: invariantId,
      before_book_stock: committedPlan.bookBefore,
      before_lot_total: committedPlan.lotTotalBefore,
      ...(physicalCount != null ? { physical_count: physicalCount } : {}),
      approved_final_quantity: committedPlan.finalQuantity,
      adjustment_delta: committedPlan.finalQuantity - committedPlan.bookBefore,
      authority_category: params.authorityCategory,
      reason_detail: params.reasonDetail,
      related_document_ids: [],
      acted_by_uid: params.actedByUid,
      ...(params.approvedByUid ? { approved_by_uid: params.approvedByUid } : {}),
      created_at: FieldValue.serverTimestamp(),
      ledger_transaction_id: reconLedgerId,
      ...(physicalAdjustmentLedgerId ? { physical_adjustment_transaction_id: physicalAdjustmentLedgerId } : {}),
    });
  } catch (err) {
    if (isAlreadyExists(err)) {
      return { status: "already_repaired", productId, repairId };
    }
    throw err;
  }

  return {
    status: "applied",
    productId,
    plan: committedPlan,
    repairId,
    reconciliationLedgerId: reconLedgerId,
    physicalAdjustmentLedgerId,
  };
}

function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: number | string })?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

/**
 * Apply a real physical adjustment (goods genuinely missing/found) through a
 * dedicated ADJUSTMENT ledger row with `movement:true`. Positive appends an
 * adjustment lot; negative FIFO-consumes at real cost. Deterministic ledger id.
 * Returns the ledger transaction id.
 */
async function applyPhysicalAdjustment(
  db: Firestore,
  args: {
    productId: string;
    delta: number;
    warehouseId: string;
    reasonDetail: string;
    actedByUid: string;
    validationRunId: string;
  },
): Promise<string> {
  const { productId, delta, warehouseId } = args;
  const adjLedgerId = txnNumber("RECONADJ", args.validationRunId, productId);
  const adjLedgerRef = db.collection(COLLECTIONS.inventoryTransactions).doc(adjLedgerId);
  const productRef = db.collection(COLLECTIONS.products).doc(productId);
  const lotsQuery = db.collection(COLLECTIONS.stockLots).where("product_id", "==", productId);

  await db.runTransaction(async (tx) => {
    const prodSnap = await tx.get(productRef); // anchor
    if (!prodSnap.exists) throw new Error(`product ${productId} not found for physical adjustment`);
    const book = typeof prodSnap.data()!.stock_quantity === "number" ? prodSnap.data()!.stock_quantity : 0;

    const lotsSnap = await tx.get(lotsQuery);
    const lots = lotsSnap.docs
      .map((d) => ({ ref: d.ref, data: d.data() }))
      .sort((a, b) => toMillis(a.data.received_at) - toMillis(b.data.received_at));

    const lineRef = db.collection(COLLECTIONS.inventoryTransactionLines).doc();
    let direction: "in" | "out";
    let quantity: number;
    let unitCost: number;
    let totalCost: number;
    let lotId: string | undefined;
    const afterBook = book + delta;

    if (delta > 0) {
      quantity = delta;
      direction = "in";
      // Found stock has no natural cost basis; use the newest live lot cost, else 0.
      unitCost = newestLiveLotCost(lots);
      totalCost = round2(unitCost * quantity);
      const newLotRef = db.collection(COLLECTIONS.stockLots).doc();
      lotId = newLotRef.id;
      tx.set(newLotRef, {
        product_id: productId,
        unit_cost: unitCost,
        qty_in: quantity,
        qty_remaining: quantity,
        source: "adjustment",
        warehouse_id: warehouseId,
        reference_id: args.reasonDetail.slice(0, 400),
        received_at: FieldValue.serverTimestamp(),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      tx.update(productRef, { stock_quantity: afterBook });
    } else {
      quantity = -delta;
      direction = "out";
      if (book < quantity) {
        throw new Error(`physical adjustment: cannot remove ${quantity}, only ${book} in stock`);
      }
      let need = quantity;
      let cost = 0;
      for (const lot of lots) {
        if (need <= 0) break;
        const avail = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
        if (avail <= 0) continue;
        const take = Math.min(avail, need);
        need -= take;
        cost += take * (typeof lot.data.unit_cost === "number" ? lot.data.unit_cost : 0);
        tx.update(lot.ref, { qty_remaining: avail - take, updated_at: FieldValue.serverTimestamp() });
      }
      if (need > 0) throw new Error(`physical adjustment: lots out of sync, ${need} unallocated`);
      unitCost = quantity > 0 ? round2(cost / quantity) : 0;
      totalCost = round2(cost);
      tx.update(productRef, { stock_quantity: afterBook });
    }

    tx.set(adjLedgerRef, {
      transaction_number: adjLedgerId,
      type: "ADJUSTMENT",
      status: "posted",
      movement: true,
      warehouse_id: warehouseId,
      item_ids: [lineRef.id],
      reason: args.reasonDetail,
      posted_by_uid: args.actedByUid,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      posted_at: FieldValue.serverTimestamp(),
    });
    tx.set(lineRef, {
      transaction_id: adjLedgerId,
      product_id: productId,
      warehouse_id: warehouseId,
      direction,
      quantity,
      unit_cost: unitCost,
      total_cost: totalCost,
      ...(lotId ? { lot_id: lotId } : {}),
      before_on_hand: book,
      after_on_hand: afterBook,
      created_at: FieldValue.serverTimestamp(),
    });
  });

  return adjLedgerId;
}

function toMillis(v: unknown): number {
  const t = v as { toMillis?: () => number } | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : 0;
}

function newestLiveLotCost(lots: Array<{ data: FirebaseFirestore.DocumentData }>): number {
  let best: { received: number; cost: number } | null = null;
  for (const lot of lots) {
    const qr = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
    if (qr <= 0) continue;
    const received = toMillis(lot.data.received_at);
    const cost = typeof lot.data.unit_cost === "number" ? lot.data.unit_cost : 0;
    if (!best || received >= best.received) best = { received, cost };
  }
  return best ? best.cost : 0;
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
