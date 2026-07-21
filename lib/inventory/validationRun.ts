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

function entityOf(issue: ValidationIssue): { type: string; id: string } {
  if (issue.lot_id) return { type: "lot", id: issue.lot_id };
  if (issue.consumption_id) return { type: "consumption", id: issue.consumption_id };
  if (issue.invoice_item_id) return { type: "invoice_item", id: issue.invoice_item_id };
  if (issue.invoice_id) return { type: "invoice", id: issue.invoice_id };
  if (issue.transaction_id) return { type: "transaction", id: issue.transaction_id };
  if (issue.product_id) return { type: "product", id: issue.product_id };
  return { type: "global", id: "-" };
}

function issueKey(issue: PersistedIssue): string {
  return `${issue.invariant_id}::${issue.entity_type}::${issue.entity_id}`;
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

/**
 * Movement-derived incremental discovery (§9.2). `stock_lots.updated_at` alone
 * catches every lot mutation (source 1, "close to sufficient"); lot_consumptions
 * and stuck work provide defence in depth. Returns the candidate product set.
 */
async function discoverChangedProducts(
  db: Firestore,
  since: Timestamp,
): Promise<{ productIds: Set<string>; sources: RunManifestSource[] }> {
  const productIds = new Set<string>();
  const sources: RunManifestSource[] = [];

  const scan = async (source: string, run: () => Promise<number>) => {
    try {
      const n = await run();
      sources.push({ source, docs_scanned: n, status: "complete" });
    } catch {
      sources.push({ source, docs_scanned: 0, status: "failed" });
    }
  };

  await scan("stock_lots.updated_at", async () => {
    const snap = await db.collection(COLLECTIONS.stockLots).where("updated_at", ">", since).get();
    snap.docs.forEach((d) => { const pid = d.data().product_id; if (pid) productIds.add(pid); });
    return snap.size;
  });
  await scan("lot_consumptions.created_at", async () => {
    const snap = await db.collection(COLLECTIONS.lotConsumptions).where("created_at", ">", since).get();
    snap.docs.forEach((d) => { const pid = d.data().product_id; if (pid) productIds.add(pid); });
    return snap.size;
  });
  await scan("stuck_invoices", async () => {
    // Stuck work regardless of time (§9.2 source 7): a posted invoice whose ledger
    // never settled. Resolve to product_ids via its item cogs.
    const snap = await db.collection(COLLECTIONS.invoices).where("ledger_status", "in", ["pending", "failed"]).get();
    if (snap.empty) return 0;
    const invIds = new Set(snap.docs.map((d) => d.id));
    const cogs = await db.collection(COLLECTIONS.invoiceItemCogs).get();
    cogs.docs.forEach((d) => { const c = d.data(); if (invIds.has(c.invoice_id) && c.product_id) productIds.add(c.product_id); });
    return snap.size;
  });

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
      sinceTs = Timestamp.fromMillis(prev!.as_of.toMillis() - OVERLAP_MS);
    }
  }

  const input = await loadAll(db);

  let discoveredFrom: RunManifestSource[] = [];
  let productScope: Set<string> | null = null;
  if (mode === "incremental" && sinceTs) {
    const discovered = await discoverChangedProducts(db, sinceTs);
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
