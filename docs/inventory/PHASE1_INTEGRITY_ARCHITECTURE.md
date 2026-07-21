# Phase 1 — Inventory Integrity Architecture

**Status:** Proposed — for review and approval before implementation
**Date:** 2026-07-20
**Author:** Lead Software Architect
**Scope:** Inventory integrity only. No new features, no ERP expansion, no payment redesign.
**Supersedes:** the "Do this sprint" sections of `INVENTORY_SYSTEM_REVIEW.md` and `INVOICE_LIFECYCLE_REVIEW.md`, which are re-scoped and re-prioritised here.

---

## 0. Executive summary and the one thing that changed

Before writing this plan I verified the concurrency mechanics in the running code. **One finding materially reduces the scope of Phase 1, and one materially increases it.**

### 0.1 Good news — the fix is much smaller than the reviews implied

Every stock-mutating path already reads its product document inside the transaction:

| Path | `tx.get(product)` | Writes product |
|---|---|---|
| `postInvoice` | yes ([invoices.ts:844](../../lib/firestore/invoices.ts#L844)) | yes ([:887](../../lib/firestore/invoices.ts#L887)) |
| `voidInvoice` | yes | yes ([:1410](../../lib/firestore/invoices.ts#L1410)) |
| `stockIn` | yes ([inventory.ts:158](../../lib/firestore/inventory.ts#L158)) | yes |
| `stockOut` | yes | yes (`increment`) |
| `postInventoryDiscard` | yes ([inventoryDiscards.ts:171](../../lib/firestore/inventoryDiscards.ts#L171)) | yes (`increment`) |
| `postReturn` | yes | yes ([invoiceReturns.ts:825](../../lib/firestore/invoiceReturns.ts#L825)) |
| `postStockAdjustment` | yes | yes |

This matters enormously. In Firestore, reading a document inside a transaction places an optimistic-concurrency precondition on it. Because **every** lot mutation is accompanied by a read *and* a write of that lot's product document, the product document already functions as a **serialization point for the entire lot set of that product**. Two concurrent operations on the same product cannot both commit — the loser aborts and retries.

So the 43-product / 234-unit drift was **not** caused by a missing lock. It was caused by something narrower and cheaper to fix:

> `postInvoice` captures its lot snapshot **outside** `runTransaction` ([invoices.ts:708–770](../../lib/firestore/invoices.ts#L708)) and the transaction callback closes over that snapshot. When the product precondition fails and Firestore **re-runs the callback, the callback replays the same stale lot data.** The retry refreshes the product but not the lots.

The corruption window is the retry path, not the happy path. That is why drift accumulated slowly rather than constantly.

**Consequence for this plan:** the earlier recommendation to `tx.get` every lot of every affected product is *unnecessary and harmful*. A product with 300 lots inside a 20-line invoice would need 6,000 reads and would breach the 500-operation transaction cap on arithmetic alone. We do not need it. We need the lot snapshot re-read inside the transaction callback, and we need the product-as-anchor property to become an explicitly enforced, tested rule rather than an accident.

### 0.2 Bad news — there are live write paths nobody accounted for

Two categories of code can corrupt inventory today and appear in neither review's remediation list:

**Dead-but-loaded oversell paths.** `lib/firestore/sales.ts:57` and `lib/firestore/walkInSessions.ts:215,327` mutate `products.stock_quantity` with `increment()` and **never touch `stock_lots` at all**. They break the core invariant by construction on every call. Both are currently unreachable from the UI, but they are compiled, imported, and one `onClick` away from being live.

**A function that does exactly what the runbook forbids.** [lotAdmin.ts:128](../../lib/firestore/lotAdmin.ts#L128) `syncProductStockFromLots()` force-writes `stock_quantity: sum` from the lot total, with no ledger row, no reason, and no posting user. `MIGRATION_RUNBOOK.md:87` explicitly prohibits this operation. It is currently uncalled — only `convertOpeningBalanceLotToStockIn` is imported from that module — but it is exported and one import away. Alongside it sit `updateLotAndSyncProduct`, `deleteLotAndSyncProduct` and `createAdjustmentLot`, all similarly uncalled and similarly capable.

**These are the highest-value, lowest-risk items in Phase 1.** Deleting code cannot break behaviour that nothing invokes, and it permanently removes an entire class of future incident. Milestone 0 does this first.

### 0.3 A necessary challenge to the Phase 1 goal statement

> *"Make it IMPOSSIBLE for inventory to become inconsistent."*

I need to be straight with you: **in a system where writes originate from the browser, this goal is not achievable, and pursuing it literally will cost far more than it returns.**

Firestore security rules evaluate one document at a time. They can enforce `qty_remaining <= qty_in`. They **cannot** enforce `stock_quantity == Σ qty_remaining`, because that is a cross-document aggregate. No rule you can write will ever express the core invariant. The only way to make it structurally impossible to violate is to make every stock write pass through server code you control — which the earlier review recommended, and which I am explicitly **deferring out of Phase 1** (reasoning in §8.4).

I propose we adopt an achievable goal instead, and hold ourselves to it strictly:

> **Phase 1 goal (revised):** Every *known* corruption mechanism is eliminated at its source. Every *unknown* corruption is detected automatically within 24 hours, attributed to a specific operation, and repaired through an audited path that itself cannot introduce new drift.

This is the difference between "provably impossible" and "impossible in practice, and self-healing when practice is wrong." For a business of this size the second is the correct engineering target. The first is a research project.

Where the plan below says *guarantee*, it means the first clause. Where it says *detect*, it means the second. I have marked which is which throughout, because conflating them is how teams end up believing controls they do not have — exactly what happened with the nightly validation that was documented, surfaced in the UI, and never run.

### 0.4 What Phase 1 delivers

| # | Outcome | Type |
|---|---|---|
| 1 | The FIFO lost-update in `postInvoice` is eliminated | Guarantee |
| 2 | All non-lot-aware stock writers are deleted from the codebase | Guarantee |
| 3 | Every stock mutation flows through one auditable gateway | Guarantee |
| 4 | The core invariant is asserted two-sided, in-transaction, on every mutation | Guarantee |
| 5 | 20 invariants validated nightly and on demand, with drift attributed to a source operation | Detect |
| 6 | Repair is possible only through a ledger-posting, reason-carrying, attributed path | Guarantee |
| 7 | A concurrency test suite that exercises the real code, not a mock | Detect |
| 8 | No inventory code reaches production without a green integrity gate | Process |

**Explicitly out of scope:** master-data schema changes (UoM, SKU, barcode, expiry), stock take, purchase returns, multi-warehouse, reservations, reporting work, CSV export, payment changes of any kind, gapless numbering, and the general-ledger subscriber. These are all real needs. None of them make inventory more correct, and each one adds surface that Phase 1 would then have to protect.

---

## 1. Inventory invariants

An invariant is a statement that must be true of the database at every instant when no transaction is in flight. Each is given an ID, a severity, and an enforcement point.

**Severity meanings:**

| Severity | Meaning | Response |
|---|---|---|
| **CRITICAL** | Stock, cost or money is already wrong. Financial statements are affected. | Block deploys, page a human, repair immediately |
| **ERROR** | Data is internally inconsistent. Wrongness is likely but not yet proven. | Fix before next release, investigate within 24h |
| **WARNING** | Suspicious but possibly legitimate. Often a leading indicator. | Review weekly |

**Enforcement points:**

| Point | Description |
|---|---|
| **T** | Asserted inside the mutating transaction — the write cannot commit if violated |
| **R** | Enforced by Firestore security rules |
| **V** | Checked by the offline validator only |

### 1.1 Products

| ID | Invariant | Sev | Enf |
|---|---|---|---|
| **P1** | `products.stock_quantity == Σ stock_lots.qty_remaining` for that product | CRITICAL | T + V |
| **P2** | `stock_quantity >= 0` | CRITICAL | T + R + V |
| **P3** | `stock_quantity` is an integer | ERROR | T + R + V |
| **P4** | `cost_price >= 0` and is finite | ERROR | R + V |
| **P5** | `cost_price` equals the unit cost of the newest lot with `qty_remaining > 0` (or last receipt cost when none) | WARNING | V |
| **P6** | Every product referenced by a lot, sale, or invoice line exists | ERROR | V |

**P1 is the system's constitution.** Every other rule exists to protect it. Note it must be checked **two-sided** — the current invoice path checks only `book > lotTotal` ([invoices.ts:95](../../lib/firestore/invoices.ts#L95)), and *all 43 production drift cases were the other direction*. This one-sided check is why the drift ran undetected.

**P5 is deliberately a WARNING, not an ERROR.** `cost_price` is a denormalised display value used for the `/inventory` valuation screen. It drifts from lot cost legitimately during normal trading. Promoting it to ERROR would generate constant noise. The real fix is making reports read lot cost — a Phase 2 reporting concern, not an integrity one.

### 1.2 FIFO lots

| ID | Invariant | Sev | Enf |
|---|---|---|---|
| **L1** | `0 <= qty_remaining <= qty_in` | CRITICAL | T + R + V |
| **L2** | `qty_in > 0` | ERROR | R + V |
| **L3** | `unit_cost >= 0` and is finite | CRITICAL | R + V |
| **L4** | `received_at` is present and is a valid timestamp | ERROR | R + V |
| **L5** | `product_id` references an existing product | ERROR | V |
| **L6** | `qty_in - qty_remaining == Σ(active consumptions) + Σ(active discard allocations) − Σ(restorations)` | CRITICAL | V |
| **L7** | No lot is ever deleted | CRITICAL | R |
| **L8** | `trader_id` present on all `PURCHASE_RECEIPT`-origin lots | WARNING | V |

**L6 is the second constitution.** P1 says book stock agrees with the lot layer. L6 says the lot layer agrees with the *consumption history*. Together they mean the entire chain — book stock → lots → consumptions → invoices — is coherent. **L6 is the invariant that would have caught the production drift on day one**, because a lost update to `qty_remaining` breaks L6 immediately even when P1 still balances.

L6 cannot be enforced transactionally without reading the full consumption history of every lot, which is unbounded. It is therefore validator-only — and it is the single most valuable check the validator performs.

**L4 deserves emphasis.** FIFO ordering depends entirely on `received_at`. Today, lots with a missing or invalid timestamp sort to `0` ([invoices.ts:178](../../lib/firestore/invoices.ts#L178)) and are consumed *first*, at whatever cost they carry. A single malformed lot silently corrupts COGS for every subsequent sale of that product. This is a quiet, high-impact failure and L4 must be enforced at write time, not merely observed.

### 1.3 Lot consumptions

| ID | Invariant | Sev | Enf |
|---|---|---|---|
| **C1** | For each posted invoice item: `Σ consumption.quantity (active) == invoice_item.quantity` | CRITICAL | T + V |
| **C2** | `consumption.quantity > 0` | ERROR | T + V |
| **C3** | `lot_id` and `invoice_item_id` reference existing documents | ERROR | V |
| **C4** | `cogs_amount == round2(unit_cost × quantity)` | CRITICAL | T + V |
| **C5** | `consumption.unit_cost == lot.unit_cost` at time of consumption | CRITICAL | T + V |
| **C6** | Consumptions of a voided invoice all carry `reversed_at` | CRITICAL | V |
| **C7** | Consumptions exist **only** for posted or voided invoices — never for drafts | CRITICAL | V |
| **C8** | No consumption is ever deleted | CRITICAL | R |

**C5 is the cost-basis guarantee.** It is what makes returns able to restore stock at the *original* cost rather than the current one — the best-engineered property of the existing system. If C5 breaks, returns silently revalue inventory.

**C7 catches a partially-failed post.** A draft that owns consumption rows means stock moved but the status flip did not commit — a torn write. It should be impossible given the transaction boundary, which is exactly why finding it means something is badly wrong.

### 1.4 Invoices, sales and COGS

| ID | Invariant | Sev | Enf |
|---|---|---|---|
| **I1** | A posted invoice has all `posted_*` snapshot fields populated | ERROR | T + R |
| **I2** | Every item of a posted (non-void) invoice has ≥1 active consumption | CRITICAL | V |
| **I3** | A draft invoice has no consumptions, no `sales` rows, no `invoice_item_cogs` | CRITICAL | V |
| **I4** | `item_ids` all resolve to existing `invoice_items` | CRITICAL | T + V |
| **I5** | `posted_cogs_amount == Σ invoice_item_cogs.cogs_amount` | CRITICAL | T + V |
| **I6** | `invoice_item_cogs.cogs_amount == Σ` that item's consumption `cogs_amount` | CRITICAL | T + V |
| **I7** | For a posted invoice, `Σ sales.quantity == Σ invoice_items.quantity` | ERROR | V |
| **I8** | Exactly one `sales` row per invoice item of a posted invoice | ERROR | V |
| **I9** | A voided invoice has `stock_reversal_applied == true` | CRITICAL | T + R |
| **I10** | No two invoices share an `order_id` | CRITICAL | T (doc ID) |

**I3 is the draft firewall** and deserves to be stated explicitly because the system's whole safety model rests on it: *drafts move nothing.* Every recovery procedure assumes a draft is inert. If I3 is ever violated, deleting a draft would silently destroy stock.

**I7/I8 are ERROR rather than CRITICAL by deliberate choice.** `sales` rows are a reporting projection; they do not feed stock or FIFO. A missing sales row misstates a report — bad, but recoverable by rebuilding from `lot_consumptions`, which is the true record. Stock is unaffected. Grading these CRITICAL would put reporting bugs on the same footing as stock corruption and dilute the signal.

### 1.5 Returns and exchanges

There is **no separate exchange concept in the codebase.** The counter-sale return flow ([counterSaleReturns.ts](../../lib/firestore/counterSaleReturns.ts)) *is* the exchange: a new sale with return lines attached, netted against the sale total. This plan treats "exchange" as "counter-sale with return lines" throughout. If a distinct exchange feature is wanted later, it must be built on these same invariants.

| ID | Invariant | Sev | Enf |
|---|---|---|---|
| **R1** | Returned qty per invoice line `<= sold qty − already returned` | CRITICAL | T + V |
| **R2** | `Σ return_lot_restorations per consumption <= consumption.quantity` | CRITICAL | T + V |
| **R3** | `restorations + write_offs <= consumed` per consumption | CRITICAL | T + V |
| **R4** | Restored qty returns to the **original lot** at the **original unit cost** | CRITICAL | T + V |
| **R5** | A restoration never pushes `qty_remaining` above `qty_in` (this is L1) | CRITICAL | T + R |
| **R6** | Written-off returns decrement neither book stock nor lot qty (never restocked) | CRITICAL | T + V |
| **R7** | A posted return has a corresponding `DAMAGE` or return ledger row | ERROR | V |
| **R8** | Counter-sale: `Σ attached return credit == invoice.returns_credit_amount` | ERROR | V |
| **R9** | A voided invoice has no posted returns against it | CRITICAL | T |

**R9 already holds** via `loadInvoiceReturnBlockers` ([invoiceReturns.ts:153](../../lib/firestore/invoiceReturns.ts#L153)) and is listed so the validator confirms it rather than assuming it.

### 1.6 Discards and adjustments

| ID | Invariant | Sev | Enf |
|---|---|---|---|
| **D1** | `Σ inventory_discard_lots.quantity == discard_item.quantity` | CRITICAL | T + V |
| **D2** | Discard lot allocations follow FIFO order | ERROR | V |
| **D3** | Discard COGS `== Σ(lot unit_cost × qty)`, rounded to 2dp | ERROR | T + V |
| **D4** | Every discard has a `DAMAGE` ledger transaction | ERROR | V |
| **A1** | Every adjustment carries a non-empty reason | CRITICAL | T |
| **A2** | Every adjustment carries `posted_by_uid` | CRITICAL | T |
| **A3** | Adjustment ledger line records `before_on_hand` and `after_on_hand` | ERROR | T |
| **A4** | A negative adjustment's ledger `unit_cost` is the **FIFO cost consumed**, not an operator-typed value | ERROR | T |
| **A5** | Every adjustment emits ledger type `ADJUSTMENT` — never `PURCHASE_RECEIPT` or `STOCK_ISSUE` | CRITICAL | T |

**A5 is currently violated by design.** The main Inventory page's "Adjust stock" button routes to `stockIn`/`stockOut`, which require no reason and emit the wrong ledger type ([StockAdjustModal.tsx:58](../../app/components/inventory/StockAdjustModal.tsx#L58)). A shrinkage write-off is presently indistinguishable in the ledger from a genuine purchase receipt. This defeats shrinkage analytics completely and is fixed in Milestone 3.

**A4 is currently violated** at [stockAdjustment.ts:172](../../lib/inventory/stockAdjustment.ts#L172), where the operator's typed cost overrides real FIFO cost basis on the permanent audit record.

### 1.7 Ledger

| ID | Invariant | Sev | Enf |
|---|---|---|---|
| **G1** | Every committed stock movement has exactly one ledger transaction | CRITICAL | V |
| **G2** | No source document remains in `ledger_status: pending/failed` beyond 1 hour | ERROR | V + monitor |
| **G3** | Ledger transactions are append-only — never updated, never deleted | CRITICAL | R |
| **G4** | `Σ ledger line quantities` per product `==` net stock movement for that product | CRITICAL | V |
| **G5** | No orphan ledger row (source document must exist) | ERROR | V |
| **G6** | Ledger line `unit_cost > 0` wherever a real cost basis exists | WARNING→ERROR | V |
| **G7** | `posted_by_uid` is non-empty on every ledger transaction | ERROR | V |

**G4 is the ledger's reason for existing** — it is the independent second opinion on stock. If G4 holds and P1 holds, two independently-maintained structures agree, which is far stronger evidence of correctness than either alone.

**G6 starts as WARNING and is promoted to ERROR at the end of Milestone 4.** Sale, return and discard ledger lines are all written with `unit_cost: 0` today ([invoices.ts:106](../../lib/firestore/invoices.ts#L106), [invoiceReturns.ts:67](../../lib/firestore/invoiceReturns.ts#L67), [inventoryDiscards.ts:276](../../lib/firestore/inventoryDiscards.ts#L276)). Grading it ERROR before the fix ships would mean starting with thousands of failures and no green baseline — and a validator that is never green is a validator people learn to ignore. It becomes ERROR the moment the write path is corrected.

**G7 fails today on every repaired row** — `repairInvoiceSaleLedger` is called without a uid.

### 1.8 The invariant register

All 20+ invariants above live in **one machine-readable file**, `lib/inventory/invariants.ts`, as the single source of truth: ID, description, severity, enforcement point, and the check function where automatable. The validator iterates that register; it does not carry its own list. Documentation is generated from it.

This is the mechanism that prevents the documented-but-unenforced drift that produced today's situation, where `validateInventory.test.ts` asserts 3 of 15 declared issue codes and the ledger block never executes in any test. A register makes coverage a countable, reportable number rather than a matter of belief.

---

## 2. The validation engine

### 2.1 Design principles

1. **Read-only. Always.** `validateInventoryIntegrity()` never writes. Detection and repair are separate programs with separate permissions. Merging them is how a validator becomes capable of *causing* the drift it reports — which is precisely what `reconcile-book-stock.mjs` does today.
2. **Deterministic and reproducible.** Same data in, same report out. No sampling, no time dependence beyond an explicit `as_of` parameter.
3. **Attribution over detection.** "Product X drifted by 3" is a fraction as useful as "Product X drifted by 3; the only mutations in the window were invoice INV-20260718-4471 and discard DSC-118; the invoice's consumption sum is 3 short of its line quantity." The validator's job is to hand a human a *cause*, not a symptom.
4. **One shared implementation.** The nightly job, the deploy gate, the in-app health dashboard and the CI suite all call the same function. Three implementations of a control is zero implementations of a control.

### 2.2 What it validates

Every invariant in §1 with enforcement point **V**. Organised in five passes so a cheap failure short-circuits an expensive one:

| Pass | Checks | Cost | Notes |
|---|---|---|---|
| 1. Structural | P2–P4, L1–L5, C2, shape/type checks | O(n) | No joins. Catches malformed docs first. |
| 2. Core balance | **P1** per product | O(products + lots) | The constitution. |
| 3. Consumption chain | **L6**, C1, C4, C5, C7, R1–R6, D1–D3 | O(consumptions) | The expensive, valuable pass. |
| 4. Document coherence | I1–I10, G5 | O(invoices) | |
| 5. Ledger reconciliation | G1, G2, G4, G6, G7 | O(ledger lines) | Independent second opinion. |

### 2.3 What it returns

A structured report, not a log:

```
InventoryValidationReport {
  schema_version, started_at, finished_at, project_id, as_of
  counts: { products, lots, consumptions, invoices, ledger_transactions }
  summary: { critical, error, warning, ok }
  issues: [ {
      invariant_id,          // "P1" — joins back to the register
      severity,
      entity_type, entity_id,
      expected, actual, delta,
      context,               // related doc IDs for attribution
      suggested_action,      // "post_adjustment" | "repair_ledger" | "investigate"
      first_seen_at          // carried forward from prior reports
  } ]
  verdict: "PASS" | "PASS_WITH_WARNINGS" | "FAIL"
}
```

Three properties are non-negotiable:

- **`invariant_id` joins to the register**, so severity is never restated locally and can never disagree.
- **`first_seen_at` is carried forward** from the previous report. New drift and known-unrepaired drift are completely different operational situations; a report that cannot tell them apart forces a full re-triage every night and will be abandoned within a fortnight.
- **`suggested_action` is advisory only.** It never triggers anything. Repair is always a human decision (§5.5).

`verdict` is `FAIL` if any CRITICAL or ERROR issue exists. Warnings alone yield `PASS_WITH_WARNINGS`, which is green for deployment purposes.

### 2.4 When it runs

| Trigger | Mode | On failure |
|---|---|---|
| Pre-deploy CI gate | Full, against production (read-only) | **Block the deploy** |
| Nightly 02:00 | Full | Alert; write report to `reports/` and to Firestore |
| Post-migration | Full, before and after | Halt migration, roll back |
| In-app "Run validation" button | Full, on demand | Display in Inventory Health |
| Post-repair | Full | Confirm the repair actually worked |
| CI on every PR | Against fixtures, not production | Fail the build |

**The in-app button is not optional.** Today's Inventory Health dashboard instructs the operator to run a terminal command — which means, in practice, that it is never run. A control that requires a developer's laptop is a control that does not exist for the business. It must be one click, visible to the person accountable for stock.

### 2.5 How failures are reported

Three channels, deliberately different in urgency:

1. **Machine** — a JSON report committed to `reports/` and written to a Firestore `inventory_validation_runs` collection so the app can display history without shell access.
2. **Human, passive** — the Inventory Health dashboard shows the last run, its verdict, its age, and per-issue detail. **An amber "last validated N days ago" indicator appears whenever the last successful run is over 48 hours old.** Silence must be visibly distinguishable from success; today it is not, which is how "never run" passed for "passing".
3. **Human, active** — CRITICAL issues notify the owner directly. Anything less loses to a busy trading day.

### 2.6 Critical vs. warning — the judgement calls

Grading is where a validator earns or loses trust. Three calls worth defending explicitly:

- **P1 (book ≠ lots) is CRITICAL in both directions.** The current one-sided check is the direct cause of undetected production drift.
- **P5 (cost_price staleness) is WARNING.** It affects a display valuation, not stock or COGS. Making it ERROR guarantees permanent noise.
- **G2 (stuck ledger) is ERROR, not CRITICAL.** Stock is correct; the audit record is late. Serious, not an emergency. Promote to CRITICAL beyond 24 hours.

The bar: **CRITICAL means someone is woken up.** Over-grading destroys a validator faster than under-grading, because the failure mode of over-grading is that the whole thing gets ignored — including the genuine CRITICALs.

---

## 3. Inventory lifecycle review

For each operation: inputs, outputs, data modified, failure points, integrity preservation, rollback, recovery.

### 3.1 Stock In — `stockIn()`

| | |
|---|---|
| **Inputs** | product_id, quantity, unit_cost, trader_id (mandatory), uid |
| **Outputs** | new lot ID, ledger transaction ID |
| **Modifies** | `stock_lots` (new), `products.stock_quantity` +qty, `products.cost_price`, `inventory_transactions` (`PURCHASE_RECEIPT`) |
| **Failure points** | Contention on product; invariant assertion fails; ledger write fails |
| **Integrity** | Single transaction, ledger written *inside* it, `assertStockLotInvariant` (two-sided) before commit |
| **Rollback** | Automatic — transaction aborts atomically |
| **Recovery** | None needed; nothing partially commits |

**Assessment: this is the reference implementation.** Ledger inside the transaction, invariant asserted before commit, correct two-sided check, mandatory trader, never merges into an existing lot. Every other path should converge on this shape. **No changes in Phase 1** beyond routing it through the gateway (§8.2).

### 3.2 Invoice Post — `postInvoice()`

| | |
|---|---|
| **Inputs** | invoice_id, uid |
| **Outputs** | posted invoice, consumptions, sales rows, COGS rows, ledger row |
| **Modifies** | `products.stock_quantity`, `stock_lots.qty_remaining`, `lot_consumptions`, `sales`, `invoice_item_cogs`, `invoices` status, `inventory_transactions` |
| **Failure points** | **Stale lot snapshot on retry (the live defect)**; op-cap breach; ledger fulfilment after commit; op estimate undercount |
| **Integrity** | Product doc is the concurrency anchor; oversell checked twice; FIFO per-chunk COGS |
| **Rollback** | Stock/consumption/COGS roll back atomically. **The ledger does not** — it is fulfilled post-commit. |
| **Recovery** | Resume path ([:700](../../lib/firestore/invoices.ts#L700)) re-runs ledger fulfilment idempotently on a subsequent post attempt; Inventory Health → Repair |

**This is the one operation that has actually corrupted production.** Three defects, in priority order:

1. **The stale snapshot on retry** (§0.1). Lot data is captured outside `runTransaction` and replayed unchanged on every retry.
2. **The one-sided invariant** ([:95](../../lib/firestore/invoices.ts#L95)) — the reason it went undetected.
3. **The op estimate undercount** ([:776](../../lib/firestore/invoices.ts#L776)) — budgets one consumption per line; the true cost is `lots_spanned + 2`. Fails at commit rather than corrupting, so this is a UX defect, not an integrity one — but it should be fixed while we are in the file.

**Design decision — where the ledger write belongs.** `stockIn` writes its ledger row *inside* the transaction; `postInvoice` writes it *after*. Inside is strictly safer: no torn state is possible. But moving it inside costs ~2 additional operations per product against a 500-op cap that large invoices already approach, and would reduce the maximum postable invoice size. **Recommendation: leave the outbox in place for `postInvoice`, and instead close the recovery gap with a server-side dispatcher (Milestone 4).** The outbox design — deterministic IDs, dedupe-by-source, bound-transaction short-circuit — is genuinely good. Its only real flaw is that fulfilment depends on a browser tab staying open.

### 3.3 Invoice Void — `voidInvoice()`

| | |
|---|---|
| **Inputs** | invoice_id, uid |
| **Outputs** | voided invoice, restored lots, reversed consumptions |
| **Modifies** | `stock_lots.qty_remaining` +restore, `lot_consumptions.reversed_at`, `products.stock_quantity`, `invoices`, ledger (`SALE_VOID`) |
| **Failure points** | Consumption docs missing; restore would exceed `qty_in`; ledger write after commit |
| **Integrity** | Blocked when posted returns exist; reverses in exact opposite order of consumption; `qty_remaining + restore > qty_in` guard; nets out prior restorations and write-offs |
| **Rollback** | Atomic within the transaction |
| **Recovery** | `void_ledger_status: pending` + Inventory Health repair |

**Assessment: correct on stock, incomplete on reporting.** The lot reversal is careful and right. But `sales` rows and `invoice_item_cogs` documents **survive the void** — only `lot_consumptions.reversed_at` marks it. Every downstream revenue and COGS report must remember to filter voided invoices, and if any one forgets, voided sales inflate revenue.

**Recommendation: do not change the write path in Phase 1.** Writing reversing `sales` rows is a reporting-semantics change that touches every consumer, and Phase 1 is not the place. Instead add invariant **I7/I8** so the validator reports the condition, and add a single shared helper that all reports must use. Revisit in Phase 2 with reporting.

### 3.4 Return — `postReturn()`

| | |
|---|---|
| **Inputs** | return draft ID, uid |
| **Outputs** | posted return, restorations, write-offs, negative sales row |
| **Modifies** | `stock_lots.qty_remaining`, `return_lot_restorations`, `return_lot_write_offs`, `invoices.returned_amount`, `products.stock_quantity`, ledger |
| **Failure points** | Restoration exceeds consumption; lot missing; cash refund exceeds paid |
| **Integrity** | LIFO unwinding over consumption chunks; restores to the **original lot at original cost**; capped at `sold − already returned` |
| **Rollback** | Atomic |
| **Recovery** | Ledger repair only |

**Assessment: the best-engineered operation in the system.** The LIFO-over-chunks unwinding preserves exact cost basis, which is subtle and correctly done. **No changes in Phase 1.**

One real gap: **there is no `voidReturn`.** A mis-keyed posted return can only be patched with a manual adjustment, which will not unwind `return_lot_restorations` — leaving the audit trail permanently wrong. This is an integrity concern, but it is a *new feature* and carries real design risk. **Recommendation: defer to Phase 2**, and in the meantime add invariant R2/R3 so a bad patch is at least detected. I would rather ship a correct `voidReturn` in Phase 2 than a rushed one in Phase 1.

### 3.5 Exchange (counter-sale with return lines)

| | |
|---|---|
| **Inputs** | invoice with `return_lines` |
| **Outputs** | new posted sale + one posted return per original invoice, netted |
| **Modifies** | Everything `postInvoice` touches, plus everything `postReturn` touches, plus `cash_entries` for excess credit |
| **Failure points** | **`finalizeCounterSaleReturns` runs post-commit, outside any transaction** ([counterSaleReturns.ts:193](../../lib/firestore/counterSaleReturns.ts#L193)) |
| **Integrity** | Sale and return legs are individually atomic; **the pair is not** |
| **Rollback** | Per-leg only. A failure between legs leaves `returns_post_status: pending` |
| **Recovery** | Resume path re-runs `finalizeCounterSaleReturns` idempotently |

**This is the weakest sequence in the system** because it is the only one that is *multi-transaction by construction*. The sale commits, then returns are created and posted, then the netting is written. Interruption anywhere leaves a real, observable intermediate state.

To be clear about severity: **the intermediate state is not stock-corrupt.** Each leg maintains P1 independently. What is at risk is the *netting* — the credit applied. That is a money field, not a stock field.

**Recommendation: do not restructure this in Phase 1.** Making it single-transaction would require the sale and all its returns in one transaction, which will breach the 500-op cap on any realistic counter sale. Instead:
- Add invariant **R8** so an unfinalised counter sale is detected within 24h.
- Make `returns_post_status: pending` visible in Inventory Health alongside stuck ledger rows.
- Ensure the resume path is genuinely idempotent — it must be, since it is the only recovery mechanism, and today it re-runs a **blind assignment** of `paid_amount` rather than an increment.

That last point is a real defect and is the *only* payment-adjacent item in this plan. I am including it because it is a **write-correctness bug in the exchange lifecycle**, not a payment feature: a resumed finalize can silently overwrite a recorded cash amount. It belongs to Milestone 4 as a one-line change from assignment to a transactional read-then-write.

### 3.6 Discard — `postInventoryDiscard()`

| | |
|---|---|
| **Inputs** | items, reason, uid |
| **Outputs** | discard header, items, per-lot allocations, ledger `DAMAGE` |
| **Modifies** | `stock_lots.qty_remaining`, `products.stock_quantity`, three discard collections, ledger |
| **Failure points** | **No contention retry loop** ([:167](../../lib/firestore/inventoryDiscards.ts#L167)) — the only mutation path without one; **no `repairDiscardLedger`** |
| **Integrity** | FIFO consumption, three-tier audit trail, append-only at rules level |
| **Rollback** | Atomic |
| **Recovery** | **None.** A discard whose ledger write fails drops out of Inventory Health permanently |

Two concrete gaps, both cheap: add the 3-attempt retry loop to match every other path, and add `repairDiscardLedger` to the repair sweep. Also: discard COGS is never rounded ([:118](../../lib/firestore/inventoryDiscards.ts#L118)), so float artifacts land in stored money fields.

### 3.7 Adjustment — two competing implementations

This is the clearest architectural defect in the system: **two different code paths, reached from two different buttons, with materially different audit guarantees.**

| | `postStockAdjustment` | `stockIn`/`stockOut` |
|---|---|---|
| Reached from | Product → Lots modal | **Main Inventory "Adjust stock" button** |
| Reason | **Mandatory** | **None** |
| Ledger type | `ADJUSTMENT` (correct) | `PURCHASE_RECEIPT` / `STOCK_ISSUE` (**wrong**) |
| before/after on hand | Recorded | Not recorded |
| `posted_by_uid` | Recorded | Recorded |

The path the operator actually uses day-to-day is the weaker one. A shrinkage write-off recorded through the main inventory screen is **indistinguishable in the ledger from a genuine purchase receipt**, with no reason captured. Shrinkage analytics are impossible, and — more seriously — a stock reduction can enter the ledger as a stock *increase* type.

`postStockAdjustment` also has defect **A4**: it writes the operator's typed `unit_cost` on the outbound ledger line rather than the FIFO cost actually consumed.

Milestone 3 resolves this: one implementation, one entry point, mandatory reason, correct ledger type, real FIFO cost.

### 3.8 Cross-cutting rollback and recovery doctrine

| Situation | Doctrine |
|---|---|
| Transaction fails mid-flight | Firestore rolls back atomically. No action. |
| Contention | Retry 3× with backoff. Every path. No exceptions (fixes discard). |
| Stock committed, ledger failed | **Never roll back stock.** Mark `ledger_status: failed`, dispatcher retries, Inventory Health repairs. |
| Multi-transaction sequence interrupted | Idempotent resume from a persisted status marker. Never a compensating write. |
| Drift detected by validator | **Never auto-repair.** Human reviews, then posts an audited adjustment. |

**The rule that matters most: repair is never automatic.** An automatic repairer that mis-diagnoses turns a detection system into a corruption system. The current `reconcile-book-stock.mjs` force-writes `stock_quantity` with a plain `batch.update` — no ledger row, no reason, no user — and on 2026-07-10 it silently rewrote 43 products by 234 units. An auditor asking *"why did OG Glass go from 1278 to 1379?"* has no answer inside the system. The only trace is an uncommitted JSON file on a developer's laptop.

This directly violates `MIGRATION_RUNBOOK.md:87`. **The tool built to protect the ledger bypassed it.** Milestone 5 rebuilds it to post real `ADJUSTMENT` transactions.

---

## 4. Concurrency strategy

### 4.1 The mechanism, stated precisely

Firestore client transactions are optimistic. Documents read via `tx.get()` acquire a precondition: if any of them changes before commit, the commit is rejected and the callback re-runs. Documents written *without* being read carry no precondition.

**Therefore the rule that makes this system safe is:**

> **The product document is the concurrency anchor for its entire lot set.**
> No code may mutate a `stock_lot` without reading **and** writing that lot's product document in the same transaction.

Because every lot mutation co-writes the product, and every path reads the product first, two concurrent operations on the same product cannot both commit. Operations on *different* products proceed in parallel, which is exactly the concurrency we want.

**This property holds today by accident.** Phase 1 makes it explicit, documented, enforced by the gateway (§8.2), and covered by tests. Its accidental status is precisely the danger: nothing stops the next well-meaning change from writing a lot without touching its product, and nothing would detect it until stock drifted.

A note on `increment()`: several paths write product stock with `increment()` ([inventory.ts:109](../../lib/firestore/inventory.ts#L109), [:332](../../lib/firestore/inventory.ts#L332), [inventoryDiscards.ts:258](../../lib/firestore/inventoryDiscards.ts#L258)). A field transform is a blind write and creates **no** precondition on its own. I verified that each of these paths *separately* `tx.get`s the product, so the precondition does exist. **But this is fragile** — the safety depends on a read whose necessity is not obvious from the write. The gateway must make the read mandatory and structural, not incidental.

### 4.2 Current risks

| # | Risk | Severity | Mechanism |
|---|---|---|---|
| 1 | **`postInvoice` replays a stale lot snapshot on retry** | CRITICAL | Snapshot captured outside `runTransaction`; the closure never refreshes it |
| 2 | `stockOut` prefetches lot IDs outside the transaction | ERROR | A lot created concurrently is invisible; surfaces as a spurious "out of sync" error, not corruption |
| 3 | Discard has no retry loop | ERROR | Contention surfaces to the user as a hard failure |
| 4 | Dead paths mutate stock without lots | CRITICAL | `sales.ts`, `walkInSessions.ts` — break P1 by construction |
| 5 | Counter-sale is multi-transaction | ERROR | Netting can be left unapplied |
| 6 | No reservation on drafts | **Accepted** | See §4.6 |

### 4.3 Required transaction boundaries

| Operation | Boundary | Anchor |
|---|---|---|
| Stock in | One transaction, ledger included | product |
| Invoice post | One transaction; ledger via outbox | **every affected product** |
| Invoice void | One transaction; ledger via outbox | every affected product |
| Return post | One transaction | every affected product |
| Discard | One transaction | every affected product |
| Adjustment | One transaction, ledger included | product |
| Counter sale | Sale txn → return txns → netting txn, idempotent resume | per leg |

### 4.4 Eliminating stale reads

The fix for risk 1, stated as a design constraint rather than an implementation:

1. **All lot loading moves inside the `runTransaction` callback.** Every retry then re-reads. This is the entire root-cause fix.
2. **Read lots via `tx.get` where the set is known and bounded**; where the candidate list must be discovered by query, the product-doc precondition provides the safety net.
3. **The FIFO simulation moves inside the callback** so it is recomputed against fresh data on each attempt. Today it is computed once, outside, and never recomputed.
4. **Bound the read set.** Query only `qty_remaining > 0`, ordered by `received_at`. A product with 300 lots of which 4 are live should read 4. This needs a composite index (§9, M2).
5. **Do not read every lot of every product.** It does not scale and, given the anchor property, buys nothing.

### 4.5 Retry strategy

Uniform across every path: **3 attempts, exponential backoff with jitter, retry only on `aborted`/`failed-precondition`.** Never retry an invariant violation — a deterministic failure retried 3 times is just a slower failure with a worse error message. Discard gets this loop; it currently has none.

### 4.6 Deliberate non-goal — stock reservation on drafts

Two clerks can draft the same last unit; both drafts save; the second post fails with "Not enough stock". The earlier review lists reservations as a gap.

**I recommend explicitly not building reservations in Phase 1, and stating so in the runbook.**

- It is **not an integrity defect.** The oversell check at post time is authoritative and correct. Stock never goes negative. P1 is never violated. The system fails *safe* — it refuses the sale.
- Reservations introduce genuinely hard new problems: expiry, cleanup of abandoned drafts, reserved-vs-available reporting, a new `stock_quantity_reserved` field that becomes a *fourth* quantity to keep consistent — and therefore a new class of drift for the validator to police.
- The business impact is a clerk seeing an error on an uncommon race, on a screen where they can adjust the line and retry.

Adding a fourth denormalised quantity while we are still stabilising the first three would be actively counterproductive. Revisit when order volume justifies it.

---

## 5. Integrity monitoring

### 5.1 Schedule

| When | What | Blocking? |
|---|---|---|
| Every PR | Validator against fixtures + full test suite | **Yes** |
| Pre-deploy | Validator against production (read-only) | **Yes** |
| Post-deploy | Validator, 15 min after | No — alerts |
| Nightly 02:00 | Full validator | No — alerts |
| Pre/post migration | Full validator both sides | **Yes** |
| On demand | In-app button | No |

### 5.2 Fixing the scheduling gap

There is no `.github/` directory, no cron, no `vercel.json`. **Nothing is scheduled.** `reports/` contains two reconcile files and zero validation reports — the validator has apparently never run against production, while being cited in the runbook, in `STRESS_TESTING.md`, and in the in-app dashboard as a live control, and standing as the stated gate for Phase 4 ("30 days green validation").

> A control that is documented, surfaced in the UI, and never executed is **worse than an absent one** — it manufactures false assurance.

Phase 1 must fix the scheduling, not just the code. A GitHub Actions scheduled workflow is sufficient and needs no new infrastructure.

Also: `nightly-validate.mjs` sets `INVENTORY_VALIDATION_MODE=nightly`, which **nothing reads** — it is functionally identical to `validate.mjs`. Either make it mean something or delete it.

### 5.3 Inventory Health dashboard

The existing dashboard is a good foundation. Phase 1 additions:

| Addition | Why |
|---|---|
| **"Run validation" button** | Removes the terminal dependency that makes the control theoretical |
| **Last-run age, amber past 48h** | Makes silence visibly different from success |
| **Per-invariant issue list** with entity links | Attribution, not just detection |
| **Stuck-work queue** — ledger `pending/failed` **and** `returns_post_status: pending` | Counter-sale finalize failures are currently invisible |
| **`repairDiscardLedger`** in the sweep | Discards currently drop out permanently |
| **Repairs carry the acting uid** | `posted_by_uid` is empty on every repaired row today |

### 5.4 Baseline first

**Before any of this ships, run the validator against production and record the result.** It has never been run. We do not know today's true state — the 2026-07-10 reconcile addressed book-vs-lot drift (P1) but nothing has ever checked L6, the consumption chain, or the ledger.

There is a real possibility that the baseline is not clean. That is fine, and far better known than unknown. But it must be established *first*, because every subsequent milestone is measured against it, and because a validator that starts red teaches everyone to ignore it.

**This is Milestone 0 and it is the single highest-value action in the plan.**

### 5.5 The repair process

Repair is a **human-initiated, ledger-posting, attributed** operation. Always.

1. Validator reports drift with attribution.
2. Human investigates the named source documents.
3. Human determines the true physical quantity — *by counting the shelf where feasible.* The lot layer is not automatically right just because it disagrees with book stock.
4. Human posts a **stock adjustment** with a mandatory reason referencing the validation run.
5. Validator re-runs to confirm.

Step 3 deserves emphasis. Because all 43 production drift cases were `lotSum > book`, it is tempting to conclude the lot layer is authoritative and sync book stock to it. **That is exactly the reasoning that produced the unaudited reconcile script.** The lot sum was inflated by *phantom stock from the lost update* — syncing book stock up to it would have made the error permanent and doubled it. Attribution exists precisely so this judgement is made on evidence rather than on which number looks more trustworthy.

`reconcile-book-stock.mjs` is rewritten in Milestone 5 to post real `ADJUSTMENT` transactions with a reason and a service-account uid. Until then it stays dry-run only.

---

## 6. Testing strategy

Current state is the weakest part of the system:

- `validateInventory.test.ts` has **3 assertions against 15 declared issue codes (~20%)**, and its fixture omits `inventoryTransactions`/`inventoryTransactionLines` entirely — **the entire ledger-integrity block never executes in any test.**
- `inventoryConcurrency.test.ts` tests a **local mock** described as *"mirrors stockOut / postInvoice logic"*. It will keep passing if the real FIFO diverges. **This is precisely why the lost-update bug was invisible.** The "idempotency" test asserts that a JavaScript `Map` deduplicates.
- **Zero coverage** for `ledgerOutbox.ts`, `invariantCheck.ts`, `repairLedger.ts`, `inventoryTransactionService.ts`.
- `test:rules` covers only `social.rules` — the ledger immutability guarantee, the system's strongest control, is itself untested.
- There is **no aggregate `npm test`** and no CI.

### 6.1 The governing principle

> **A test that exercises a reimplementation of the code under test is not a test. It is a second opinion from the same brain.**

Every concurrency and integrity test in Phase 1 runs the **real functions** against the **Firestore emulator**. The mock-based concurrency suite is deleted, not extended.

### 6.2 Test layers

| Layer | Target | Runs against | Gate |
|---|---|---|---|
| **Unit** | Pure functions — FIFO ordering, COGS rounding, allocation, invariant predicates | In-memory | Every PR |
| **Rules** | Every inventory collection: append-only, `qty_remaining <= qty_in`, product validators, ledger immutability | Emulator | Every PR |
| **Integration** | Each operation end-to-end; assert **all** invariants after each | Emulator | Every PR |
| **Concurrency** | Real functions, parallel writers, same product | Emulator | Every PR |
| **Randomised** | Random operation sequences; assert invariants after each step | Emulator | Nightly |
| **Stress** | Large invoices, many lots, op-cap boundaries | Emulator | Nightly |
| **Regression** | One test per historical defect, named for it | Emulator | Every PR |

### 6.3 The invariant assertion helper

One shared helper — `assertAllInvariants(db)` — runs the **entire register** against emulator state and is called after *every* mutation in *every* integration test. This is the highest-leverage item in the testing plan: it means a new operation cannot break an old invariant without a test failing, even when nobody thought to write that specific test.

### 6.4 Concurrency tests that must exist

Each runs the real code against the emulator:

| # | Scenario | Asserts |
|---|---|---|
| C1 | Two invoices, same product, FIFO spills into a second lot | **The exact production defect.** P1 + L6 hold |
| C2 | Invoice post vs. stock in, same product | Both succeed; P1 holds |
| C3 | Invoice post vs. discard, same product | One wins or both serialise; P1 holds |
| C4 | Invoice post vs. return, same product | P1 + L6 hold |
| C5 | Two voids of the same invoice | One succeeds; no double restoration |
| C6 | Double post of the same invoice | Idempotent; stock moves once |
| C7 | 10 concurrent posts, overlapping products | P1 + L6 hold for all |
| C8 | Post + concurrent adjustment | P1 holds |

**C1 is the acceptance test for Milestone 2.** It must be written first, demonstrated to **fail against current code**, and then pass. A regression test that has never failed is an assumption wearing a lab coat.

### 6.5 Randomised testing

Generate random valid operation sequences (in, post, void, return, discard, adjust) across a small product set; assert the full register after each step; shrink to a minimal reproduction on failure. This is where the bugs nobody imagined surface. Nightly, with a fixed seed per run recorded in the report so any failure is reproducible.

### 6.6 Coverage targets

| Target | Requirement |
|---|---|
| Invariant register | **100%** — every invariant has ≥1 test that fails when violated |
| Validator issue codes | **100%** (from ~20%) |
| Mutation paths | 100% of operations have integration + concurrency coverage |
| `ledgerOutbox.ts` | Retry, failure, idempotency, concurrent fulfilment |
| Inventory rules | Every collection, both allow and deny cases |

**100% on the register is the one number worth holding firm on.** The others are means to it.

---

## 7. Deployment safety

### 7.1 The gate

> **No code touching inventory reaches production unless every integrity check passes.**

Enforced mechanically in CI, not by convention.

### 7.2 Pre-deploy checklist

| # | Check | Blocking |
|---|---|---|
| 1 | Typecheck clean | Yes |
| 2 | Lint clean | Yes |
| 3 | Unit tests pass | Yes |
| 4 | Rules tests pass (incl. inventory rules) | Yes |
| 5 | Integration tests pass | Yes |
| 6 | Concurrency tests pass | Yes |
| 7 | **Validator against production: no CRITICAL, no ERROR** | Yes |
| 8 | Invariant register coverage = 100% | Yes |
| 9 | Rules diff reviewed if `firestore.rules` changed | Yes |
| 10 | Required indexes deployed **before** app code | Yes |
| 11 | Rollback plan stated in the PR | Yes |

**Item 7 is the unusual one and the most important.** We validate *production* before deploying, because deploying onto already-corrupt data makes diagnosis vastly harder — you can no longer tell whether the new build caused what you are seeing.

**Item 10 matters because ordering is a real failure mode.** Deploying code that needs an index before the index exists produces `FAILED_PRECONDITION` at runtime for every affected user.

### 7.3 Post-deploy

| When | Action |
|---|---|
| +15 min | Run validator; compare to pre-deploy baseline |
| +24 h | Nightly validation must be green |
| +7 d | Review drift trend before the next inventory change |

### 7.4 Rollback triggers

Roll back immediately on any of: a new CRITICAL invariant violation, P1 drift on a product with no explaining mutation, ledger failure rate above baseline, or any report of stock moving without a ledger row.

**Rolling back code does not roll back data.** Every milestone below therefore states a *data* rollback plan separately, and this is why milestones are ordered so that the risky ones are preceded by detection.

### 7.5 The flag-rollback problem

`config.ts` promises *"Override via env for rollback without redeploying"* and the runbook tells operators to edit `.env.local`. **This does not work.** All four flags are `NEXT_PUBLIC_*`, which Next.js inlines into the client bundle at build time — changing them requires a full rebuild and redeploy. None are documented in `.env.example`.

Phase 1 must either make the flags genuinely runtime-switchable or **correct the documentation to say a rebuild is required.** Right now we have a rollback procedure that would fail at the moment it is needed, which is the worst possible time to discover it. Correcting the documentation is the cheap, honest option and I recommend it.

Related: **shadow mode is dead code and vacuous as written** — `actual` is hardcoded to `{ persisted: false }` while `expected` is the full input, so they can never match and every operation logs a diff. It is a write-log of intended rows, not a parity checker. Fix or delete; do not leave it looking like a control.

---

## 8. Code architecture

### 8.1 What should remain

Genuinely good, do not touch:

| Component | Why |
|---|---|
| FIFO cost-layer model | Correct, lot-accurate, cost basis preserved on returns |
| `postReturn` LIFO unwinding | Subtle and right |
| Ledger outbox with deterministic IDs | Idempotent by construction |
| `stockIn` | The reference implementation |
| Integer-cent invoice arithmetic | Provably exact |
| Append-only rules on ledger/consumptions/discards | The strongest control present |
| Dry-run-by-default tooling with cross-project guards | Good instincts |
| The deliberate non-rounding of `unit_cost` on sales rows | Correct, and the comment explaining it must survive refactoring |

### 8.2 The single change that matters most — one mutation gateway

Today, stock can be mutated from at least **eight** places, with different guarantees: `postInvoice`, `voidInvoice`, `stockIn`, `stockOut`, `postStockAdjustment`, `postInventoryDiscard`, `postReturn`, plus the dead `sales.ts`/`walkInSessions.ts`/`lotAdmin.ts` paths.

**Recommendation: every stock mutation goes through one module — `lib/inventory/stockMutation.ts` — which owns the invariant-critical mechanics:**

- Reading the product document (establishing the concurrency anchor)
- Loading and FIFO-sorting lots **inside** the transaction
- Applying the delta to lots and book stock together
- Asserting the two-sided invariant before commit
- Emitting the correct ledger type with real cost

Callers supply *intent* — what moved, why, on whose authority. They do not supply mechanics.

This is what makes §4.1's anchor rule structural rather than aspirational. A caller **cannot** forget to read the product, because the caller never touches the product. It also means the lost-update class of bug can be fixed in exactly one place, forever.

**This is the highest-leverage refactor available and it is the backbone of Milestones 2 and 3.**

### 8.3 What must never be duplicated

| Never duplicate | Canonical home |
|---|---|
| FIFO selection and ordering | `stockMutation.ts` |
| The invariant assertion | `invariantCheck.ts` — one function, two-sided, used everywhere |
| COGS rounding | one helper |
| Ledger doc-ID derivation | `ledgerIds.ts` |
| Invariant definitions | `invariants.ts` register |
| Adjustment semantics | one implementation |

The current duplication — two adjustment paths, two invariant checks with **different strictness** (`assertStockLotInvariant` uses `!==`, the invoice path uses `>`), a FIFO mock in tests that mirrors the real thing — is not a style problem. **It is the direct cause of the production incident.** The weaker of the two invariant checks was on the hot path.

### 8.4 What I am deliberately *not* recommending — and why

The user asked me to challenge the earlier reviews. Four recommendations I think are wrong for this business at this time:

**1. "Move posting, adjustment and discard behind Admin-SDK API routes."** *Defer past Phase 1.*

This was the earlier review's flagship recommendation. My reasoning for deferring:

- It does not fix the actual bug. The production corruption was a stale-snapshot logic error. Moving the same logic to a server would have moved the bug with it.
- Firestore transactions provide identical atomicity and identical optimistic-concurrency guarantees regardless of where they run. The server buys **authority** (defence against a malicious or stale client), not **correctness**.
- The threat model does not currently justify it. This is a small wholesaler where every operator is a trusted owner-operator. The realistic risks are concurrency bugs and half-completed operations — both addressed here without moving anything.
- It is a large, risky rewrite of the most complex code in the system, during the phase whose entire purpose is stabilisation. Rewriting `postInvoice` while trying to prove `postInvoice` is correct is the wrong order.

**It should happen in Phase 2 or 3**, and it is the right long-term destination. It is simply not what makes inventory correct *this* quarter.

One carve-out: **the ledger outbox dispatcher should move server-side in Milestone 4**, because its defect *is* structural — fulfilment depending on a browser tab staying open cannot be fixed client-side by any amount of care.

**2. "Gapless sequence numbers for `transaction_number`."** *Reject for Phase 1.*

Motivated by classical audit practice, where a gapless sequence proves nothing was deleted. But this ledger is already **append-only at the rules level** and uses **deterministic document IDs** — deletion is prevented structurally, and duplication is impossible by construction. A gapless sequence would add a global counter, which is a write-contention hotspot and a new single point of failure, to re-prove something already proven by stronger means. The current random suffix does have a real collision risk at volume; **switch to a ULID or the deterministic ID as the display number.** That solves the actual problem without a counter.

**3. "Read every lot of every affected product inside the transaction."** *Reject — actively harmful.*

Covered in §0.1. It does not scale past a few hundred lots and buys nothing over the anchor property.

**4. "Write reversing `sales` rows on void" and "build `voidReturn`."** *Defer to Phase 2.*

Both are correct diagnoses. Both are **new write paths**, and new write paths are exactly what Phase 1 should not be adding while stabilising. Detect via invariants now; build carefully later.

### 8.5 Avoiding future technical debt

| Rule | Enforcement |
|---|---|
| No stock mutation outside `stockMutation.ts` | Code review + a lint rule restricting `stock_quantity` / `qty_remaining` writes by path |
| Every new invariant enters the register with a test | CI coverage check |
| Every new mutation path gets integration + concurrency tests | PR checklist |
| No dead write paths — delete, don't comment out | Milestone 0 sets the precedent |
| Docs generated from the register, never hand-maintained | Build step |

The last one matters more than it looks. The reviews found controls documented in three places and implemented in none. **Generated documentation cannot drift from the code; hand-written documentation always eventually does.**

---

## 9. Phase 1 roadmap

Six milestones, ordered so that **detection precedes correction** and **deletion precedes refactoring**. Each is independently shippable and independently revertible.

---

### Milestone 0 — Baseline and demolition

**Goal:** Know the true current state; permanently remove code that can corrupt inventory.

| | |
|---|---|
| **Files** | Delete `lib/firestore/walkInSessions.ts`, `recordSale` in `lib/firestore/sales.ts`, `AddSaleForm`, and the uncalled `lotAdmin.ts` exports (`syncProductStockFromLots`, `updateLotAndSyncProduct`, `deleteLotAndSyncProduct`, `createAdjustmentLot`). Keep `convertOpeningBalanceLotToStockIn` — it is used. Also: `firestore.rules` (close public product read), `.gitignore` (`firestore-debug.log`) |
| **Risks** | **Low.** Deleting genuinely unreferenced code. Main risk is deleting something reachable — mitigated by grep + typecheck + a full build |
| **Testing** | Typecheck, build, full manual smoke of every inventory screen |
| **Rollback** | `git revert`. No data touched |
| **Success** | Validator baseline recorded in `reports/`; zero non-lot-aware stock writers remain; `products` requires auth |

Also in M0: **`allow read: if true` on `products`** ([firestore.rules:934](../../firestore.rules#L934)) exposes `cost_price`, `stock_quantity` and `target_margin_percent` to the open internet. It is one line, it is not an integrity issue, and it should ship today regardless of everything else in this plan.

> **Why first:** we cannot measure improvement without a baseline, and every later milestone is safer once the demolition is done. Deleting code that nothing calls is the lowest-risk, highest-value work available.

---

### Milestone 1 — Make corruption visible

**Goal:** Detect every invariant violation automatically. **Change no write path.**

| | |
|---|---|
| **Files** | New `lib/inventory/invariants.ts`; rewrite `lib/inventory/validateInventory.ts`; `scripts/validate.mjs`; new `.github/workflows/nightly-validation.yml`; `InventoryHealthDashboard.tsx`; **`invariantCheck.ts` → two-sided everywhere** |
| **Risks** | **Low** — read-only, except the two-sided assertion, which may cause posts to *fail* on products that are already drifted. That is correct behaviour, but it must be baselined in M0 first, or we will block trading on pre-existing drift |
| **Testing** | Every invariant gets a test that fails when violated; validator coverage 20% → 100% |
| **Rollback** | Revert; validator is additive |
| **Success** | Nightly runs and alerts; register 100% covered; in-app button works; drift is attributed to a source operation |

> **Why second:** we must be able to *see* corruption before we start changing the code that causes it. Otherwise M2 is unfalsifiable — we would have no way to demonstrate the fix worked.

---

### Milestone 2 — Close the concurrency hole

**Goal:** Eliminate the FIFO lost update. **This is the milestone that fixes the actual production incident.**

| | |
|---|---|
| **Files** | `lib/firestore/invoices.ts` (`postInvoice` — move lot loading and FIFO simulation inside the transaction, fix the op estimate); `lib/firestore/stockLotsQuery.ts` (scope to `qty_remaining > 0`); `firestore.indexes.json` |
| **Risks** | **Highest in the plan.** This is the most complex function in the codebase and the one that posts every sale. Risks: increased transaction latency; more contention retries; op-cap behaviour changes on large invoices |
| **Testing** | **Write C1 first and prove it fails against current code.** Then C2–C8, stress tests at op-cap boundaries, full randomised suite |
| **Rollback** | Revert code. **Data written correctly by the new path stays correct** — no data migration, so rollback is clean |
| **Success** | C1 passes; 100 concurrent posts across overlapping products leave P1 and L6 intact; no new drift for 7 days |

**Deploy this one alone**, on a quiet trading day, with the validator run before and 15 minutes after. Do not bundle it with anything.

> **Why third:** M1 gives us the instrument to prove this worked. Doing M2 first would mean fixing the bug and having no way to demonstrate it.

---

### Milestone 3 — One mutation gateway

**Goal:** Centralise stock mutation; eliminate the duplicate adjustment paths.

| | |
|---|---|
| **Files** | New `lib/inventory/stockMutation.ts`; refactor `stockIn`/`stockOut`/`postStockAdjustment`/`postInventoryDiscard` onto it; repoint `StockAdjustModal.tsx` → `postStockAdjustment`; fix A4 (real FIFO cost on adjustment ledger lines); add the discard retry loop; round discard COGS |
| **Risks** | **Medium.** Broad refactor across every mutation path, but each is individually small and well-tested by M1's suite |
| **Testing** | Full integration + concurrency suite; every operation asserts the full register afterwards |
| **Rollback** | Per-path revert — paths migrate one at a time, not in a big bang |
| **Success** | One adjustment implementation; every adjustment carries a reason and emits `ADJUSTMENT`; no stock write outside the gateway |

> Migrate paths **one per PR**, starting with `stockIn` (simplest, already correct) to validate the gateway shape before touching harder paths.

---

### Milestone 4 — Ledger completeness

**Goal:** Guarantee every stock movement has a ledger row carrying real money.

| | |
|---|---|
| **Files** | Server-side outbox dispatcher (scheduled); `repairDiscardLedger` in `repairLedger.ts`; real `unit_cost` on sale/return/discard ledger lines; `posted_by_uid` on repairs; fix `inventoryTransactionService.ts` `tx.set`+`tx.update` (fold `item_ids` into the initial `set`); **fix `finalizeCounterSaleReturns` assignment → transactional read-then-write** |
| **Risks** | **Medium.** First server-side scheduled component. Contained: it only *writes ledger rows*, never stock |
| **Testing** | Outbox retry/failure/idempotency/concurrent-fulfilment tests; emulator rules tests for `inventory_transactions` |
| **Rollback** | Disable the dispatcher; manual repair still works |
| **Success** | No source doc stuck `pending` > 1h; G6 promoted to ERROR and green; ledger valuation matches FIFO valuation |

**Verify the `tx.set` + `tx.update` pattern against the emulator before anything else in this milestone.** [inventoryTransactionService.ts:99](../../lib/inventory/inventoryTransactionService.ts#L99) writes then updates the same document in one commit, against a collection whose rule is `allow update, delete: if false`. If rules reject that pattern, **every ledger write is failing right now** — surfacing exactly as "stock moved, ledger missing". This could not be confirmed statically and there is no emulator test covering inventory rules. It is a 30-minute check with a potentially large finding, and the fix is trivial regardless.

---

### Milestone 5 — Audited repair

**Goal:** Make repair impossible to perform without an audit trail.

| | |
|---|---|
| **Files** | Rewrite `scripts/reconcile-book-stock.mjs` to post real `ADJUSTMENT` transactions with reason + service-account uid; add the repair workflow to Inventory Health; update `MIGRATION_RUNBOOK.md` |
| **Risks** | **Low** — dry-run by default, cross-project guards already present |
| **Testing** | Emulator: drift → detect → repair → re-validate green, with a ledger row proving it |
| **Rollback** | Keep the old script available, dry-run only, until the new one is proven |
| **Success** | No repair path exists that does not write a ledger row; the runbook and the tooling finally agree |

---

### Milestone 6 — Lock the gate

**Goal:** Make regression structurally difficult.

| | |
|---|---|
| **Files** | `.github/workflows/` (CI, pre-deploy gate); `package.json` (aggregate `npm test`); rules tests for inventory collections; lint rule restricting stock-field writes; `.env.example`; docs generated from the register |
| **Risks** | **Low** — process only, no runtime change |
| **Testing** | Deliberately break an invariant on a branch and confirm CI blocks it |
| **Rollback** | N/A |
| **Success** | No inventory PR merges without a green gate; flag-rebuild requirement documented honestly; shadow mode fixed or deleted |

---

### 9.1 Ordering rationale

| Order | Milestone | Why here |
|---|---|---|
| 1 | M0 Baseline & demolition | Cannot measure without a baseline; deleting dead code is free risk reduction |
| 2 | M1 Visibility | Must see corruption before changing what causes it; makes M2 falsifiable |
| 3 | M2 Concurrency | The actual production bug. Needs M1's instrument to prove the fix |
| 4 | M3 Gateway | Refactor onto stable, well-tested ground — never onto a known-buggy path |
| 5 | M4 Ledger | Independent second opinion; needs the gateway to emit correct types |
| 6 | M5 Repair | Needs the ledger to be trustworthy before repairs post into it |
| 7 | M6 Gate | Locks in everything above |

**The dependency that matters most: M1 before M2.** It is tempting to fix the known bug first — it is the one that caused real damage. But without validation in place we would have no way to demonstrate the fix worked, and no way to detect if it introduced something new in the most complex function in the system. Fixing a concurrency bug without an instrument to measure concurrency is how the next incident starts.

**The second: M0 before M1.** Turning on the two-sided invariant against unknown pre-existing drift could start blocking sales on the trading floor. We must know the baseline first, and repair any existing drift through M5's audited path — or, if M5 is not yet built, through manually posted adjustments.

---

## 10. What success looks like

At the end of Phase 1:

1. **The known corruption mechanism is gone.** The FIFO lost update cannot recur; C1 proves it.
2. **Unknown corruption is caught within 24 hours**, attributed to a source operation, with a repair path that posts to the ledger.
3. **Stock cannot be mutated from anywhere except one gateway** that always reads its product, always asserts the invariant two-sided, and always emits the correct ledger type.
4. **Every invariant has a test that fails when violated** — coverage is a countable number, not a belief.
5. **No inventory code reaches production without a green gate**, including validation of production data before deploying onto it.
6. **The documentation describes controls that actually run**, because it is generated from the register that runs them.

What Phase 1 explicitly does **not** deliver: server-side enforcement, stock take, purchase returns, reservations, multi-warehouse, master-data fields, reporting. All are real needs. All are Phase 2+. **None of them make a single existing number more correct**, and adding surface while stabilising the core is how systems acquire the debt they never pay off.

The honest summary of where we are: **the accounting engine is professional-grade, wrapped in controls that were documented but never switched on.** Phase 1 is not about building something new. It is about making the controls that were designed actually run, deleting the code that can bypass them, and closing the one hole that has already cost real money.

---

## Appendix A — Open questions for review

1. **Baseline result.** If M0's validation reveals substantial pre-existing drift beyond the 2026-07-10 reconcile, do we repair before M1 (delays visibility) or run M1 with the two-sided assertion behind a flag (risks trading disruption)? **My recommendation: repair first, via manually posted adjustments, and accept the delay.**
2. **`voidReturn`.** I have deferred it to Phase 2. If mis-keyed returns are a frequent operational problem today, tell me and I will re-scope — it changes the risk calculus.
3. **Counter-sale multi-transaction.** I have accepted this with detection rather than restructuring. Confirm the exchange volume is low enough that a rare unfinalised netting is tolerable for one more quarter.
4. **Trading-hours deploy window.** M2 should ship on the quietest possible day. When is that?
5. **Who receives CRITICAL alerts,** and by what channel? A control with no named owner is not a control.
