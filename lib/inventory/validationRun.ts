/**
 * Validation run orchestrator (PHASE1_INTEGRITY_ARCHITECTURE_V2.md §8.3, §9).
 *
 * Wraps the pure register validator (validateInventory.ts) with the run-level
 * machinery: full vs incremental mode, movement-derived discovery, first_seen_at
 * carry-forward, a persisted run record, and a watermark that advances only on a
 * complete run. Admin SDK — the run record and watermark are the validator's own
 * bookkeeping (not a stock write), so a read-only validator identity plus write
 * to `inventory_validation_runs` is sufficient (§13).
 *
 * Persistence is redacted per §14: only issue METADATA (invariant_id, severity,
 * entity, first_seen_at) is written to Firestore — never messages, monetary
 * deltas, cost prices or customer ids. The full detail stays in the returned
 * in-memory report (and any local reports/ file).
 */

import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { validateInventoryData, type ValidationIssue, type ValidationVerdict } from "@/lib/inventory/validateInventory";
import type { ValidationInput } from "@/lib/inventory/validationContext";

const SCHEMA_VERSION = 1;
const OVERLAP_MS = 15 * 60 * 1000; // §9.5.1 — never query from the exact watermark
const STALE_WATERMARK_MS = 48 * 60 * 60 * 1000; // §9.3 — older than this ⇒ fall back to full
const MAX_PERSISTED_ISSUES = 500; // §14

export type RunMode = "full" | "incremental";

export type PersistedIssue = {
  invariant_id: string;
  severity: ValidationIssue["severity"];
  entity_type: string;
  entity_id: string;
  first_seen_at: Timestamp;
};

export type RunManifestSource = { source: string; docs_scanned: number; status: "complete" | "failed" };

export type ValidationRunRecord = {
  schema_version: number;
  run_id: string;
  mode: RunMode;
  /** True when it validated everything it set out to (governs watermark advance). */
  complete: boolean;
  started_at: Timestamp;
  finished_at: Timestamp;
  project_id: string;
  /** The watermark this run represents; the next incremental run starts from here. */
  as_of: Timestamp;
  scope?: { product_ids: string[]; discovered_from: RunManifestSource[]; since: Timestamp };
  counts: { products: number; lots: number; consumptions: number; invoices: number; ledger_transactions: number };
  summary: { critical: number; error: number; warning: number };
  verdict: ValidationVerdict;
  issues: PersistedIssue[];
  truncated: boolean;
  issues_total: number;
};

/**
 * The stable identity of an issue: invariant id + entity type + entity id.
 * This is what first_seen_at keys on, so two different issues never merge and
 * the same issue is tracked across runs (§8.3).
 */
export function entityOf(issue: Pick<ValidationIssue, "lot_id" | "consumption_id" | "invoice_item_id" | "invoice_id" | "transaction_id" | "product_id">): { type: string; id: string } {
  if (issue.lot_id) return { type: "lot", id: issue.lot_id };
  if (issue.consumption_id) return { type: "consumption", id: issue.consumption_id };
  if (issue.invoice_item_id) return { type: "invoice_item", id: issue.invoice_item_id };
  if (issue.invoice_id) return { type: "invoice", id: issue.invoice_id };
  if (issue.transaction_id) return { type: "transaction", id: issue.transaction_id };
  if (issue.product_id) return { type: "product", id: issue.product_id };
  return { type: "global", id: "-" };
}

export function issueKey(i: { invariant_id: string; entity_type: string; entity_id: string }): string {
  return `${i.invariant_id}::${i.entity_type}::${i.entity_id}`;
}

function millisOf(ts: unknown): number {
  const t = ts as { toMillis?: () => number } | undefined;
  if (typeof t?.toMillis === "function") return t.toMillis();
  if (typeof ts === "string") { const p = Date.parse(ts); return Number.isNaN(p) ? 0 : p; }
  return 0;
}

const mapDocs = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, data: d.data() }));

async function loadAll(db: Firestore): Promise<ValidationInput> {
  const [
    products, lots, consumptions, invoices, itemCogs,
    inventoryTransactions, inventoryTransactionLines,
    invoiceReturns, invoiceReturnItems, returnLotRestorations, returnLotWriteOffs,
    inventoryDiscards, inventoryDiscardItems, inventoryDiscardLots, sales,
  ] = await Promise.all([
    db.collection(COLLECTIONS.products).get(),
    db.collection(COLLECTIONS.stockLots).get(),
    db.collection(COLLECTIONS.lotConsumptions).get(),
    db.collection(COLLECTIONS.invoices).get(),
    db.collection(COLLECTIONS.invoiceItemCogs).get(),
    db.collection(COLLECTIONS.inventoryTransactions).get(),
    db.collection(COLLECTIONS.inventoryTransactionLines).get(),
    db.collection(COLLECTIONS.invoiceReturns).get(),
    db.collection(COLLECTIONS.invoiceReturnItems).get(),
    db.collection(COLLECTIONS.returnLotRestorations).get(),
    db.collection(COLLECTIONS.returnLotWriteOffs).get(),
    db.collection(COLLECTIONS.inventoryDiscards).get(),
    db.collection(COLLECTIONS.inventoryDiscardItems).get(),
    db.collection(COLLECTIONS.inventoryDiscardLots).get(),
    db.collection(COLLECTIONS.sales).get(),
  ]);
  return {
    products: mapDocs(products) as ValidationInput["products"],
    lots: mapDocs(lots) as ValidationInput["lots"],
    consumptions: mapDocs(consumptions) as ValidationInput["consumptions"],
    invoices: mapDocs(invoices) as ValidationInput["invoices"],
    itemCogs: mapDocs(itemCogs) as ValidationInput["itemCogs"],
    inventoryTransactions: mapDocs(inventoryTransactions) as ValidationInput["inventoryTransactions"],
    inventoryTransactionLines: mapDocs(inventoryTransactionLines) as ValidationInput["inventoryTransactionLines"],
    invoiceReturns: mapDocs(invoiceReturns) as ValidationInput["invoiceReturns"],
    invoiceReturnItems: mapDocs(invoiceReturnItems) as ValidationInput["invoiceReturnItems"],
    returnLotRestorations: mapDocs(returnLotRestorations) as ValidationInput["returnLotRestorations"],
    returnLotWriteOffs: mapDocs(returnLotWriteOffs) as ValidationInput["returnLotWriteOffs"],
    inventoryDiscards: mapDocs(inventoryDiscards) as ValidationInput["inventoryDiscards"],
    inventoryDiscardItems: mapDocs(inventoryDiscardItems) as ValidationInput["inventoryDiscardItems"],
    inventoryDiscardLots: mapDocs(inventoryDiscardLots) as ValidationInput["inventoryDiscardLots"],
    sales: mapDocs(sales) as ValidationInput["sales"],
  };
}

const STUCK = new Set(["pending", "failed"]);

/**
 * Movement-derived incremental discovery (§9.2), in-memory over the loaded input.
 *
 * DEFENCE IN DEPTH — every stock-affecting workflow is covered by at least one
 * source that it provably writes, so discovery never depends on a single field:
 *
 *   stock-in / lot creation → stock_lots.updated_at (new lot)
 *   invoice posting         → lot_consumptions.created_at
 *   invoice voiding         → stock_lots.updated_at + SALE_VOID ledger line
 *   returns / restorations  → return_lot_restorations.created_at + stock_lots.updated_at
 *   return write-offs        → return_lot_write_offs.created_at        (no lot change!)
 *   discards                → inventory_discard_lots.created_at + stock_lots.updated_at
 *   adjustments             → stock_lots.updated_at + ADJUSTMENT ledger line
 *   reconciliations         → RECONCILIATION ledger header.product_id  (book-only ⇒ no lot change!)
 *   stuck / failed ledger    → ledger_status/returns_post_status pending|failed (regardless of time)
 *
 * Returns the candidate product set; each product is then validated in FULL
 * (incremental narrows which products, never which checks).
 */
export function discoverChangedProducts(
  input: ValidationInput,
  sinceMillis: number,
): { productIds: Set<string>; sources: RunManifestSource[] } {
  const productIds = new Set<string>();
  const sources: RunManifestSource[] = [];
  const add = (pid: unknown) => { if (typeof pid === "string" && pid) productIds.add(pid); };

  const timeSource = (name: string, rows: Array<{ data: Record<string, unknown> }> | undefined, tsField: string, pidField = "product_id") => {
    let n = 0;
    for (const r of rows ?? []) {
      if (millisOf(r.data[tsField]) > sinceMillis) { add(r.data[pidField]); n += 1; }
    }
    sources.push({ source: `${name}.${tsField}`, docs_scanned: n, status: "complete" });
  };

  timeSource("stock_lots", input.lots, "updated_at");
  timeSource("lot_consumptions", input.consumptions, "created_at");
  timeSource("return_lot_restorations", input.returnLotRestorations, "created_at");
  timeSource("return_lot_write_offs", input.returnLotWriteOffs, "created_at");
  timeSource("inventory_discard_lots", input.inventoryDiscardLots, "created_at");
  timeSource("inventory_transaction_lines", input.inventoryTransactionLines, "created_at");
  // Ledger headers carry product_id only for RECONCILIATION (book-only corrections
  // that touch no lot and would otherwise be invisible).
  timeSource("inventory_transactions", input.inventoryTransactions, "created_at");

  // ── Stuck work (no time filter) — resolve to product via child collections. ──
  const cogsByInvoice = new Map<string, Set<string>>();
  for (const ic of input.itemCogs) {
    const s = cogsByInvoice.get(ic.data.invoice_id) ?? new Set<string>();
    if (ic.data.product_id) s.add(ic.data.product_id);
    cogsByInvoice.set(ic.data.invoice_id, s);
  }
  const returnItemsByReturn = new Map<string, Set<string>>();
  for (const ri of input.invoiceReturnItems ?? []) {
    const s = returnItemsByReturn.get(ri.data.return_id) ?? new Set<string>();
    if (ri.data.product_id) s.add(ri.data.product_id);
    returnItemsByReturn.set(ri.data.return_id, s);
  }
  const discardItemsByDiscard = new Map<string, Set<string>>();
  for (const di of input.inventoryDiscardItems ?? []) {
    const s = discardItemsByDiscard.get(di.data.discard_id) ?? new Set<string>();
    if (di.data.product_id) s.add(di.data.product_id);
    discardItemsByDiscard.set(di.data.discard_id, s);
  }

  let stuck = 0;
  for (const inv of input.invoices) {
    if (STUCK.has(inv.data.ledger_status ?? "") || inv.data.returns_post_status === "pending") {
      (cogsByInvoice.get(inv.id) ?? new Set()).forEach(add);
      stuck += 1;
    }
  }
  for (const ret of input.invoiceReturns ?? []) {
    if (STUCK.has(ret.data.ledger_status ?? "")) {
      (returnItemsByReturn.get(ret.id) ?? new Set()).forEach(add);
      stuck += 1;
    }
  }
  for (const disc of input.inventoryDiscards ?? []) {
    if (STUCK.has(disc.data.ledger_status ?? "")) {
      (discardItemsByDiscard.get(disc.id) ?? new Set()).forEach(add);
      stuck += 1;
    }
  }
  sources.push({ source: "stuck_ledger_work", docs_scanned: stuck, status: "complete" });

  return { productIds, sources };
}

async function latestCompleteRun(db: Firestore): Promise<ValidationRunRecord | null> {
  const snap = await db
    .collection(COLLECTIONS.inventoryValidationRuns)
    .where("complete", "==", true)
    .orderBy("as_of", "desc")
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0]!.data() as ValidationRunRecord);
}

export type RunOptions = {
  mode: RunMode;
  projectId: string;
  /** Overrides the run clock (tests). Defaults to now. */
  asOf?: Date;
};

export type RunResult = {
  record: ValidationRunRecord;
  /** Full (unredacted) issues, in memory only — never persisted. */
  fullIssues: ValidationIssue[];
  /** True when an incremental request fell back to full (§9.3). */
  fellBackToFull: boolean;
};

/**
 * Run validation and persist the record. Returns the persisted record plus the
 * full in-memory issue detail.
 */
export async function runValidation(db: Firestore, opts: RunOptions): Promise<RunResult> {
  const asOf = opts.asOf ? Timestamp.fromDate(opts.asOf) : Timestamp.now();
  const prev = await latestCompleteRun(db);

  // Mode selection with mandatory full fallback (§9.3).
  let mode: RunMode = opts.mode;
  let fellBackToFull = false;
  let scope: ValidationRunRecord["scope"] | undefined;
  let sinceTs: Timestamp | undefined;
  if (mode === "incremental") {
    const stale =
      !prev || asOf.toMillis() - prev.as_of.toMillis() > STALE_WATERMARK_MS;
    if (stale) {
      mode = "full";
      fellBackToFull = true;
    } else {
      // §9.5.1 — never query from the exact watermark; overlap by 15 min.
      sinceTs = Timestamp.fromMillis(prev!.as_of.toMillis() - OVERLAP_MS);
    }
  }

  const input = await loadAll(db);

  let discoveredFrom: RunManifestSource[] = [];
  let productScope: Set<string> | null = null;
  if (mode === "incremental" && sinceTs) {
    const discovered = discoverChangedProducts(input, sinceTs.toMillis());
    productScope = discovered.productIds;
    discoveredFrom = discovered.sources;
    scope = { product_ids: [...productScope], discovered_from: discoveredFrom, since: sinceTs };
  }

  const report = validateInventoryData(input, opts.projectId, { mode });

  // Incremental narrows WHICH products, never which checks (§9.2): keep issues
  // whose product is in scope, plus global (product-less) issues.
  let fullIssues = report.issues;
  if (productScope) {
    fullIssues = fullIssues.filter((i) => {
      const pid = i.product_id;
      return pid ? productScope!.has(pid) : true;
    });
  }

  // first_seen_at carry-forward (§8.3): distinguish new drift from known-unrepaired.
  const prevFirstSeen = new Map<string, Timestamp>();
  for (const pi of prev?.issues ?? []) {
    prevFirstSeen.set(issueKey(pi), pi.first_seen_at);
  }

  const persisted: PersistedIssue[] = fullIssues.map((i) => {
    const e = entityOf(i);
    const base: PersistedIssue = {
      invariant_id: i.invariant_id,
      severity: i.severity,
      entity_type: e.type,
      entity_id: e.id,
      first_seen_at: asOf,
    };
    const carried = prevFirstSeen.get(issueKey(base));
    if (carried) base.first_seen_at = carried;
    return base;
  });

  const critical = fullIssues.filter((i) => i.severity === "CRITICAL").length;
  const error = fullIssues.filter((i) => i.severity === "ERROR").length;
  const warning = fullIssues.filter((i) => i.severity === "WARNING").length;
  const verdict: ValidationVerdict = critical + error > 0 ? "FAIL" : warning > 0 ? "PASS_WITH_WARNINGS" : "PASS";

  const complete =
    mode === "full" || discoveredFrom.every((s) => s.status === "complete");

  const issuesTotal = persisted.length;
  const truncated = issuesTotal > MAX_PERSISTED_ISSUES;

  const runRef = db.collection(COLLECTIONS.inventoryValidationRuns).doc();
  const record: ValidationRunRecord = {
    schema_version: SCHEMA_VERSION,
    run_id: runRef.id,
    mode,
    complete,
    started_at: asOf,
    finished_at: Timestamp.now(),
    project_id: opts.projectId,
    as_of: asOf,
    ...(scope ? { scope } : {}),
    counts: {
      products: input.products.length,
      lots: input.lots.length,
      consumptions: input.consumptions.length,
      invoices: input.invoices.length,
      ledger_transactions: input.inventoryTransactions?.length ?? 0,
    },
    summary: { critical, error, warning },
    verdict,
    issues: persisted.slice(0, MAX_PERSISTED_ISSUES),
    truncated,
    issues_total: issuesTotal,
  };

  await runRef.set(record);
  return { record, fullIssues, fellBackToFull };
}
