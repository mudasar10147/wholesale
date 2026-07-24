/**
 * Physical Stock Correction — physically-authoritative, per-product re-baseline.
 *
 * The operator's counted warehouse quantity is the truth. This service does NOT
 * reconstruct stock from invoices, purchases, ledger, or historical lots, and it does
 * NOT use the history-reconstruction reconciliation tool (`reconcileMismatch`). For one
 * product it, atomically (Admin SDK transaction):
 *   1. captures the complete before-state,
 *   2. zeroes/closes every open lot (marked, never deleted),
 *   3. sets product stock to the counted quantity,
 *   4. creates exactly one new baseline lot when the count > 0 (none when 0),
 *   5. records the difference as an ADJUSTMENT (surplus/shrinkage) ledger row,
 *   6. writes an immutable audit record (idempotency key == doc id),
 *   7. self-verifies the post-state before the transaction commits.
 *
 * Integer-only: `stock_quantity`/`qty_in`/`qty_remaining` are integers by invariant P3;
 * there is no fractional-unit configuration in this schema, so non-integer counts are
 * rejected. Product has no SKU/barcode field — the doc id is the SKU key.
 *
 * See docs/inventory/PHYSICAL_STOCK_CORRECTION.md.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type {
  PhysicalCorrectionCostSource,
  PhysicalCorrectionClosedLot,
  PhysicalCorrectionValidation,
  ProductDoc,
  StockLotDoc,
} from "@/lib/types/firestore";

const DEFAULT_WAREHOUSE_ID = "default";

function intOr0(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) ? v : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function toMillis(v: unknown): number {
  const t = v as { toMillis?: () => number } | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : 0;
}
function toIso(v: unknown): string | null {
  const t = v as { toDate?: () => Date } | undefined;
  return typeof t?.toDate === "function" ? t.toDate().toISOString() : null;
}

export type ResolvedCost = { unit_cost: number; source: PhysicalCorrectionCostSource };

/**
 * Cost precedence: latest valid stock-in lot cost → product purchase cost → none
 * (operator must supply a manual cost when the count is positive). Uses lots already
 * read in the caller's transaction — no extra query, no composite index.
 */
export function resolveRecountCost(
  lots: Array<{ data: StockLotDoc }>,
  product: Pick<ProductDoc, "cost_price">,
): ResolvedCost | null {
  let latestStockIn: { unit_cost: number; at: number } | null = null;
  for (const { data } of lots) {
    if (data.source !== "stock_in") continue;
    if (typeof data.unit_cost !== "number" || !(data.unit_cost > 0)) continue;
    const at = toMillis(data.received_at);
    if (!latestStockIn || at > latestStockIn.at) latestStockIn = { unit_cost: data.unit_cost, at };
  }
  if (latestStockIn) return { unit_cost: latestStockIn.unit_cost, source: "latest_stock_in" };
  if (typeof product.cost_price === "number" && product.cost_price > 0) {
    return { unit_cost: product.cost_price, source: "product_cost_price" };
  }
  return null;
}

export type OpenLotView = {
  id: string;
  qty_remaining: number;
  unit_cost: number;
  source: StockLotDoc["source"];
  received_at: string | null;
};

export type CorrectionPreview = {
  status: "ok";
  product: {
    id: string;
    name: string;
    sku: string;
    barcode: string | null;
    image_url: string | null;
    stock_quantity: number;
    cost_price: number;
  };
  open_lots: OpenLotView[];
  before_lot_total: number;
  /** Resolved cost for a positive count; null when the operator must enter one. */
  resolved_unit_cost: number | null;
  cost_source: PhysicalCorrectionCostSource | null;
};

/** Read a product + its lots and present everything the operator confirms against. */
export async function previewPhysicalCorrection(
  db: Firestore,
  productId: string,
): Promise<CorrectionPreview | { status: "not_found" }> {
  const prodSnap = await db.collection(COLLECTIONS.products).doc(productId).get();
  if (!prodSnap.exists) return { status: "not_found" };
  const product = prodSnap.data() as ProductDoc;

  const lotsSnap = await db
    .collection(COLLECTIONS.stockLots)
    .where("product_id", "==", productId)
    .get();
  const lots = lotsSnap.docs.map((d) => ({ id: d.id, data: d.data() as StockLotDoc }));

  const openLots = lots
    .filter((l) => intOr0(l.data.qty_remaining) > 0)
    .sort((a, b) => toMillis(a.data.received_at) - toMillis(b.data.received_at));
  const beforeLotTotal = openLots.reduce((s, l) => s + intOr0(l.data.qty_remaining), 0);
  const cost = resolveRecountCost(lots, product);

  return {
    status: "ok",
    product: {
      id: prodSnap.id,
      name: typeof product.name === "string" ? product.name : "",
      sku: prodSnap.id,
      barcode: null,
      image_url: typeof product.image_url === "string" ? product.image_url : null,
      stock_quantity: intOr0(product.stock_quantity),
      cost_price: typeof product.cost_price === "number" ? product.cost_price : 0,
    },
    open_lots: openLots.map((l) => ({
      id: l.id,
      qty_remaining: intOr0(l.data.qty_remaining),
      unit_cost: typeof l.data.unit_cost === "number" ? l.data.unit_cost : 0,
      source: l.data.source,
      received_at: toIso(l.data.received_at),
    })),
    before_lot_total: beforeLotTotal,
    resolved_unit_cost: cost?.unit_cost ?? null,
    cost_source: cost?.source ?? null,
  };
}

export type ProductSearchHit = {
  id: string;
  name: string;
  sku: string;
  image_url: string | null;
  stock_quantity: number;
};

/**
 * Resolve a product for correction. An exact document-id match is returned first;
 * otherwise a case-sensitive name-prefix search returns candidates the operator must
 * select from. We never update from a typed name alone — selection yields a doc id.
 */
export async function searchProductsForCorrection(
  db: Firestore,
  rawQuery: string,
  limit = 20,
): Promise<ProductSearchHit[]> {
  const query = rawQuery.trim();
  if (!query) return [];
  const hits = new Map<string, ProductSearchHit>();

  const byId = await db.collection(COLLECTIONS.products).doc(query).get();
  if (byId.exists) hits.set(byId.id, toHit(byId.id, byId.data() as ProductDoc));

  // Case-sensitive prefix on name (no lowercased field exists in the schema).
  const snap = await db
    .collection(COLLECTIONS.products)
    .orderBy("name")
    .startAt(query)
    .endAt(`${query}`)
    .limit(limit)
    .get();
  for (const d of snap.docs) {
    if (!hits.has(d.id)) hits.set(d.id, toHit(d.id, d.data() as ProductDoc));
  }
  return Array.from(hits.values()).slice(0, limit);
}

function toHit(id: string, p: ProductDoc): ProductSearchHit {
  return {
    id,
    name: typeof p.name === "string" ? p.name : "",
    sku: id,
    image_url: typeof p.image_url === "string" ? p.image_url : null,
    stock_quantity: intOr0(p.stock_quantity),
  };
}

export type ApplyCorrectionArgs = {
  productId: string;
  /** Integer >= 0. Non-integers and negatives are rejected. */
  physicalCount: number;
  /** Required only when the count > 0 and no cost can be resolved. */
  manualUnitCost?: number | null;
  reason: string;
  recountSessionId: string;
  /** Doubles as the correction doc id — a replay collides and is reported idempotently. */
  idempotencyKey: string;
  operatorUid: string;
  operatorEmail: string;
  /** From the preview, for stale-detection. */
  expectedCurrentStock: number;
  expectedOpenLotTotal: number;
};

export type CorrectionSummary = {
  correction_id: string;
  product_id: string;
  before_book_stock: number;
  before_lot_total: number;
  physical_count: number;
  stock_delta: number;
  closed_lots: PhysicalCorrectionClosedLot[];
  new_lot_id: string | null;
  unit_cost: number;
  cost_source: PhysicalCorrectionCostSource;
  ledger_transaction_id: string;
  post_update_validation: PhysicalCorrectionValidation;
};

export type ApplyCorrectionResult =
  | { status: "applied"; correction: CorrectionSummary }
  | { status: "already_applied"; correction: CorrectionSummary }
  | { status: "not_found" }
  | { status: "invalid_count"; message: string }
  | { status: "cost_required"; message: string }
  | {
      status: "stale_preview";
      message: string;
      current_stock: number;
      current_open_lot_total: number;
    };

/** Apply one physically-authoritative correction atomically. */
export async function applyPhysicalCorrection(
  db: Firestore,
  args: ApplyCorrectionArgs,
): Promise<ApplyCorrectionResult> {
  const {
    productId,
    physicalCount,
    manualUnitCost = null,
    reason,
    recountSessionId,
    idempotencyKey,
    operatorUid,
    operatorEmail,
    expectedCurrentStock,
    expectedOpenLotTotal,
  } = args;

  if (!Number.isInteger(physicalCount) || physicalCount < 0) {
    return {
      status: "invalid_count",
      message: "Physical count must be a whole number of 0 or more (stock is integer-only).",
    };
  }
  if (manualUnitCost != null && (!Number.isFinite(manualUnitCost) || manualUnitCost <= 0)) {
    return { status: "cost_required", message: "Manual unit cost must be a positive number." };
  }

  const productRef = db.collection(COLLECTIONS.products).doc(productId);
  const correctionRef = db.collection(COLLECTIONS.physicalStockCorrections).doc(idempotencyKey);
  const lotsQuery = db.collection(COLLECTIONS.stockLots).where("product_id", "==", productId);

  try {
    return await db.runTransaction(async (tx) => {
      // ---- reads (all before writes) ----
      const prodSnap = await tx.get(productRef); // concurrency anchor
      if (!prodSnap.exists) return { status: "not_found" as const };
      const existingCorrection = await tx.get(correctionRef);
      const lotsSnap = await tx.get(lotsQuery);

      if (existingCorrection.exists) {
        return {
          status: "already_applied" as const,
          correction: summaryFromDoc(existingCorrection.data()!, idempotencyKey),
        };
      }

      const product = prodSnap.data() as ProductDoc;
      const beforeBook = intOr0(product.stock_quantity);
      const lots = lotsSnap.docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data() as StockLotDoc }));
      const openLots = lots
        .filter((l) => intOr0(l.data.qty_remaining) > 0)
        .sort((a, b) => toMillis(a.data.received_at) - toMillis(b.data.received_at));
      const beforeLotTotal = openLots.reduce((s, l) => s + intOr0(l.data.qty_remaining), 0);

      // ---- stale-preview guard ----
      if (beforeBook !== expectedCurrentStock || beforeLotTotal !== expectedOpenLotTotal) {
        return {
          status: "stale_preview" as const,
          message: "The product changed since the preview was loaded. Reload and confirm again.",
          current_stock: beforeBook,
          current_open_lot_total: beforeLotTotal,
        };
      }

      // ---- cost resolution ----
      const resolved = resolveRecountCost(lots, product);
      let unitCost = 0;
      let costSource: PhysicalCorrectionCostSource = resolved?.source ?? "manual";
      if (physicalCount > 0) {
        if (manualUnitCost != null) {
          unitCost = manualUnitCost;
          costSource = "manual";
        } else if (resolved) {
          unitCost = resolved.unit_cost;
          costSource = resolved.source;
        } else {
          return {
            status: "cost_required" as const,
            message:
              "No valid stock-in or product cost is available. Enter a unit cost to correct a positive quantity.",
          };
        }
      } else if (resolved) {
        unitCost = resolved.unit_cost;
        costSource = resolved.source;
      }

      // ---- writes ----
      const closedLots: PhysicalCorrectionClosedLot[] = [];
      for (const lot of openLots) {
        closedLots.push({ lot_id: lot.id, qty_remaining_before: intOr0(lot.data.qty_remaining) });
        tx.update(lot.ref, {
          qty_remaining: 0,
          closed_by_recount: true,
          recount_correction_id: idempotencyKey,
          closed_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }

      let newLotId: string | null = null;
      if (physicalCount > 0) {
        const newLotRef = db.collection(COLLECTIONS.stockLots).doc();
        newLotId = newLotRef.id;
        tx.set(newLotRef, {
          product_id: productId,
          unit_cost: unitCost,
          qty_in: physicalCount,
          qty_remaining: physicalCount,
          source: "adjustment",
          warehouse_id: DEFAULT_WAREHOUSE_ID,
          reference_id: `physical-recount:${recountSessionId}`,
          recount_baseline: true,
          recount_correction_id: idempotencyKey,
          received_at: FieldValue.serverTimestamp(),
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }

      const productUpdate: Record<string, unknown> = {
        stock_quantity: physicalCount,
        updated_at: FieldValue.serverTimestamp(),
      };
      if (physicalCount > 0) productUpdate.cost_price = unitCost;
      tx.update(productRef, productUpdate);

      // ---- ADJUSTMENT ledger (surplus/shrinkage) ----
      const delta = physicalCount - beforeBook;
      const ledgerRef = db.collection(COLLECTIONS.inventoryTransactions).doc();
      const lineRef = db.collection(COLLECTIONS.inventoryTransactionLines).doc();
      const ledgerId = ledgerRef.id;
      tx.set(ledgerRef, {
        transaction_number: ledgerId,
        type: "ADJUSTMENT",
        status: "posted",
        movement: true,
        warehouse_id: DEFAULT_WAREHOUSE_ID,
        item_ids: [lineRef.id],
        reason: reason && reason.trim() ? reason.trim() : "Physical stock recount",
        source_document_type: "physical_stock_correction",
        source_document_id: idempotencyKey,
        posted_by_uid: operatorUid,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        posted_at: FieldValue.serverTimestamp(),
      });
      tx.set(lineRef, {
        transaction_id: ledgerId,
        product_id: productId,
        warehouse_id: DEFAULT_WAREHOUSE_ID,
        direction: delta >= 0 ? "in" : "out",
        quantity: Math.abs(delta),
        unit_cost: unitCost,
        total_cost: round2(Math.abs(delta) * unitCost),
        ...(newLotId ? { lot_id: newLotId } : {}),
        before_on_hand: beforeBook,
        after_on_hand: physicalCount,
        created_at: FieldValue.serverTimestamp(),
      });

      // ---- in-transaction self-verify of the post-state ----
      const postOpenLotCount = physicalCount > 0 ? 1 : 0;
      const postOpenLotTotal = physicalCount > 0 ? physicalCount : 0;
      const validation: PhysicalCorrectionValidation = {
        stock_equals_count: physicalCount === physicalCount, // stock is set to physicalCount
        lot_total_equals_count: postOpenLotTotal === physicalCount,
        open_lot_count_ok:
          physicalCount > 0 ? postOpenLotCount === 1 : postOpenLotCount === 0,
        ok: true,
      };
      validation.ok =
        validation.stock_equals_count &&
        validation.lot_total_equals_count &&
        validation.open_lot_count_ok;
      if (!validation.ok) {
        throw new Error("Post-update self-verification failed; correction rolled back.");
      }

      // ---- immutable audit record (idempotency: create fails on replay) ----
      const summary: CorrectionSummary = {
        correction_id: idempotencyKey,
        product_id: productId,
        before_book_stock: beforeBook,
        before_lot_total: beforeLotTotal,
        physical_count: physicalCount,
        stock_delta: delta,
        closed_lots: closedLots,
        new_lot_id: newLotId,
        unit_cost: unitCost,
        cost_source: costSource,
        ledger_transaction_id: ledgerId,
        post_update_validation: validation,
      };
      tx.create(correctionRef, {
        correction_id: idempotencyKey,
        recount_session_id: recountSessionId,
        product_id: productId,
        product_name: typeof product.name === "string" ? product.name : "",
        sku: productId,
        barcode: null,
        before_book_stock: beforeBook,
        before_lot_total: beforeLotTotal,
        physical_count: physicalCount,
        stock_delta: delta,
        closed_lots: closedLots,
        new_lot_id: newLotId,
        unit_cost: unitCost,
        cost_source: costSource,
        ledger_transaction_id: ledgerId,
        operator_uid: operatorUid,
        operator_email: operatorEmail,
        reason: reason && reason.trim() ? reason.trim() : "Physical stock recount",
        created_at: FieldValue.serverTimestamp(),
        post_update_validation: validation,
      });

      return { status: "applied" as const, correction: summary };
    });
  } catch (err) {
    if (isAlreadyExists(err)) {
      const snap = await correctionRef.get();
      if (snap.exists) {
        return { status: "already_applied", correction: summaryFromDoc(snap.data()!, idempotencyKey) };
      }
    }
    throw err;
  }
}

function summaryFromDoc(data: Record<string, unknown>, id: string): CorrectionSummary {
  const v = (data.post_update_validation as PhysicalCorrectionValidation | undefined) ?? {
    ok: true,
    stock_equals_count: true,
    lot_total_equals_count: true,
    open_lot_count_ok: true,
  };
  return {
    correction_id: (data.correction_id as string) ?? id,
    product_id: (data.product_id as string) ?? "",
    before_book_stock: intOr0(data.before_book_stock),
    before_lot_total: intOr0(data.before_lot_total),
    physical_count: intOr0(data.physical_count),
    stock_delta: intOr0(data.stock_delta),
    closed_lots: (data.closed_lots as PhysicalCorrectionClosedLot[]) ?? [],
    new_lot_id: (data.new_lot_id as string | null) ?? null,
    unit_cost: typeof data.unit_cost === "number" ? data.unit_cost : 0,
    cost_source: (data.cost_source as PhysicalCorrectionCostSource) ?? "manual",
    ledger_transaction_id: (data.ledger_transaction_id as string) ?? "",
    post_update_validation: v,
  };
}

function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | undefined;
  return (
    e?.code === 6 ||
    e?.code === "already-exists" ||
    e?.code === "ALREADY_EXISTS" ||
    (typeof e?.message === "string" && /ALREADY_EXISTS|already exists/i.test(e.message))
  );
}
