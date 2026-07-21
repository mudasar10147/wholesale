# Inventory Management System — Architecture Review

**Date:** 2026-07-19
**Scope:** Full review of stock-in, stock-out, returns, discards, adjustments, the ledger engine, reporting, and security.
**Verdict:** Strong accounting core, unsafe enforcement boundary, incomplete WMS feature set.

---

## 1. Executive summary

This is a **genuinely well-designed FIFO perpetual inventory system** — considerably better than typical small-business software. It has real cost layering, an immutable double-entry-style ledger, an idempotent outbox, invariant assertions, reconciliation tooling, and a documented phased migration runbook. Whoever designed the accounting model knew what they were doing.

It is undermined by three structural problems:

1. **Every invariant is enforced in the browser.** There is no server-side inventory code at all.
2. **A concurrency defect in invoice posting** silently corrupts lot quantities — and has already done so in production.
3. **Master data is missing the fields a wholesale business needs** (UoM/pack size, SKU, barcode, per-product reorder point, expiry).

Overall grade against professional/ERP standards:

| Dimension | Grade | Notes |
|---|---|---|
| Costing model (FIFO, COGS, cost layers) | **A−** | Genuinely correct, lot-accurate, cost basis preserved on returns |
| Audit trail / ledger design | **B−** | Immutable and idempotent by design; but records quantities not money, and the outbox has no automatic dispatcher |
| Transactional integrity | **C** | Atomic where it counts, but a real lost-update bug |
| Security / enforcement | **D** | Client-trusted; public catalog read |
| Master data model | **C−** | No UoM, SKU, barcode, expiry, per-product reorder point |
| Reporting | **C+** | Good FIFO/purchase reports; but three conflicting valuation numbers, no exports, unusable movement log |
| Operational tooling | **C** | Good scripts — but nothing scheduled, and the validator has *never been run* against production |
| Test coverage | **D+** | ~20% of validation branches; ledger checks never execute; concurrency tests exercise a mock |
| Feature completeness vs WMS | **C** | No stock take, no purchase returns, no multi-warehouse, no reservations |

---

## 2. How inventory actually works today

### 2.1 The data model

Four layers, in order of authority:

| Collection | Role |
|---|---|
| `products.stock_quantity` | "Book stock" — the fast-read denormalized total |
| `stock_lots` | FIFO cost layers: `qty_in`, `qty_remaining`, `unit_cost`, `received_at`, `trader_id` |
| `lot_consumptions` | Which lot fed which invoice line, at what cost |
| `inventory_transactions` + `_lines` | The immutable ERP ledger (append-only) |

**The core invariant:** `products.stock_quantity == Σ stock_lots.qty_remaining` for every product.
Defined in [invariantCheck.ts:28](lib/inventory/invariantCheck.ts#L28).

### 2.2 Stock in

`stockIn()` — [lib/firestore/inventory.ts:142](lib/firestore/inventory.ts#L142)

Creates a **new lot** (never merges into an existing one — correct for FIFO), increments book stock, sets `cost_price` to the new receipt cost, writes a `PURCHASE_RECEIPT` ledger row inside the same transaction, and asserts the invariant before commit. Trader is mandatory. 3× contention retry.

Products can also be created with opening stock ([products.ts:98](lib/firestore/products.ts#L98)), and `scripts/backfill-opening-lots.cjs` exists for historical data.

### 2.3 Stock out (the sale path)

This is the main flow. `createDraftInvoice` → `postInvoice` — [lib/firestore/invoices.ts:646](lib/firestore/invoices.ts#L646)

- **Drafts never move stock.** The draft-time stock check is advisory and explicitly skippable via `allowInsufficientStockForDraft`. There is **no reservation** — two clerks can draft the same last unit.
- **Posting** is where everything happens, in one `runTransaction` ([:787–1014](lib/firestore/invoices.ts#L787)): oversell check → FIFO consume oldest lot first → write `lot_consumptions` + `sales` + `invoice_item_cogs` → decrement lots and book stock → flip to `posted`.
- **COGS** is computed per lot chunk at that lot's own `unit_cost`, rounded to 2dp per chunk, then summed. Invoice-level `posted_cogs_amount` is stored.
- **The ledger row is written after commit** via the outbox, with `ledger_status: pending` on the invoice as the recovery marker.

`voidInvoice` ([:1209](lib/firestore/invoices.ts#L1209)) correctly reverses lot consumption with a `qty_remaining > qty_in` guard.

### 2.4 Returns from customers

`createReturnDraft` → `postReturn` — [lib/firestore/invoiceReturns.ts:596](lib/firestore/invoiceReturns.ts#L596)

This is the **best-engineered part of the system**. Returned stock goes back into the **original lot at the original cost**, not into a new lot and not at current cost:

- Loads the original `lot_consumptions`, minus prior restorations/write-offs.
- Allocates **LIFO over the consumption chunks** — unwinding the most recently consumed layer of that invoice line.
- Restores `qty_remaining` on the original lot, guarded against exceeding `qty_in`.
- Writes `return_lot_restorations` and `return_lot_write_offs` as a per-lot audit trail.
- Supports three settlement types: `credit_note`, `reduce_balance`, `cash_refund`.
- Returned-but-damaged units can be written off instead of restocked, with COGS tracked separately.

Returnable quantity is correctly capped at `sold − already_returned`.

### 2.5 Discards / wastage

`postInventoryDiscard` — [lib/firestore/inventoryDiscards.ts:143](lib/firestore/inventoryDiscards.ts#L143)

FIFO-consumes oldest lots, writes a three-tier trail (`inventory_discards` header → `_items` → `_lots` with per-lot cost), decrements stock, recomputes `cost_price`, and emits a `DAMAGE` ledger transaction. All three collections are **append-only at the rules level** — correct.

### 2.6 Manual adjustments

Two competing implementations, which is a problem (see §3.4):

- `postStockAdjustment` — [lib/inventory/stockAdjustment.ts:38](lib/inventory/stockAdjustment.ts#L38). **Reason mandatory.** Positive delta creates a lot; negative FIFO-consumes. Writes a proper `ADJUSTMENT` ledger row inside the transaction with `before_on_hand`/`after_on_hand` and `posted_by_uid`. Reached from **Product → Lots modal**.
- `stockIn`/`stockOut` — no reason, wrong ledger type. Reached from the **main Inventory page "Adjust stock" button** ([StockAdjustModal.tsx:58](app/components/inventory/StockAdjustModal.tsx#L58) → [StockAdjustControls.tsx:88](app/components/products/StockAdjustControls.tsx#L88)).

### 2.7 The ledger engine

A well-built outbox — [lib/inventory/ledgerOutbox.ts](lib/inventory/ledgerOutbox.ts):

- **Deterministic doc IDs**: `ledgerTransactionDocId(type, sourceType, sourceId)` ([ledgerIds.ts:5](lib/inventory/ledgerIds.ts#L5)) makes concurrent fulfillment idempotent by construction.
- Dedupe-by-source query, bound-transaction short-circuit, 3 attempts with backoff.
- On failure: marks `ledger_status: failed` and throws `LedgerFulfillmentError` carrying `stockCommitted: true`.
- Recovery via **Inventory Health → Repair** ([repairLedger.ts](lib/inventory/repairLedger.ts)).

Rollout is flag-controlled ([config.ts:16](lib/inventory/config.ts#L16)). Current effective state (no env overrides set): engine writes **on**, shadow mode **off**, direct lot edits **blocked**, legacy paths **still present**. That is Phase 2/3 soak.

---

## 3. Findings

### 3.1 CRITICAL — Lot quantities are read outside the transaction (lost update)

[lib/firestore/invoices.ts:710–715](lib/firestore/invoices.ts#L710), [:769](lib/firestore/invoices.ts#L769), [:855–872](lib/firestore/invoices.ts#L855)

`postInvoice` fetches all lots **before** `runTransaction`, simulates FIFO on that stale snapshot to guess which lots will be touched, and inside the transaction re-reads **only the guessed-dirty lots**. Lots that FIFO actually spills into — but which the estimate missed — are **written without ever being read**, so Firestore applies no optimistic-concurrency precondition to them.

> **Failure scenario.** Product P has lots L1(10, oldest) and L2(50). User A posts qty 5 → estimate marks only L1 dirty. User B concurrently posts qty 12, consuming all of L1 plus 2 of L2, and commits first. A's transaction retries (it did read `products/P`), re-reads L1 as 0, spills into L2 — but L2 is stale at 50 in A's map and was never `tx.get`-ed. A writes `L2.qty_remaining = 45`. **B's decrement of L2 is silently erased. 2 units of phantom stock appear.**

Worse: the whole estimate is computed **outside** `runTransaction` and is therefore **never recomputed on retry** — the callback replays the same stale data every time.

The Firestore rule `qty_remaining <= qty_in` does not catch this, because 45 is a legal value.

**This is not theoretical.** [reports/book-stock-reconcile-2026-07-10T11-02-12-909Z.json](reports/book-stock-reconcile-2026-07-10T11-02-12-909Z.json) records **43 products with 234 units of drift**, reconciled 9 days ago — and **every single one** was in the direction `lotSum > book`, exactly the signature of this bug.

### 3.2 CRITICAL — The invariant assertion is one-sided

[lib/firestore/invoices.ts:95–103](lib/firestore/invoices.ts#L95)

```ts
if (book > lotTotal) {
  throw new Error(stockLotMismatchMessage(...));
}
```

Only fires when book stock **exceeds** lot total. The inverse — lots exceeding book stock — is silently tolerated and FIFO happily consumes the phantom stock. **All 43 drifted products in production were this direction**, which is precisely why the drift accumulated undetected until someone ran the reconcile script manually.

Note this is *stricter* elsewhere: `assertStockLotInvariant` in [invariantCheck.ts:47](lib/inventory/invariantCheck.ts#L47), used by `stockIn`/`stockOut`/`postStockAdjustment`, correctly checks `!==`. The invoice path uses the weaker one.

### 3.3 CRITICAL — `products` is world-readable

[firestore.rules:933–936](firestore.rules#L933)

```
match /products/{docId} {
  allow read: if true;
  allow write: if isAdmin();
}
```

`allow read: if true` — **no authentication required at all**. The Firebase project ID ships in the client bundle as `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, so anyone can dump the entire catalog including `cost_price`, `stock_quantity`, `sale_price`, and `target_margin_percent`.

For a wholesaler, cost prices and margins are the crown jewels — a competitor or customer can compute your buying power exactly. The adjacent comment says *"clerks: read products for invoice lines"*, so the intent was clearly `isSignedIn()`. This reads as debugging residue.

**This is a one-line fix and should be done today.**

### 3.4 HIGH — No server-side enforcement of anything

There is no `functions/` directory, and `app/api/**` contains only customer-merge, social, and image routes. **Zero inventory endpoints.** All FIFO allocation, COGS computation, stock maintenance, and ledger writing runs in the browser via the client SDK.

Firestore transactions give **atomicity, not authority**. Combined with the unvalidated `products` rule, an admin session (or a stale/buggy client build) can:

- Set `stock_quantity` to any value, including negative — no rule validates it
- Change stock with **no ledger row at all** — nothing links the two
- Fabricate an immutable `inventory_transactions` row: `create` has **no validator function** and no `posted_by_uid == request.auth.uid` binding, so ledger attribution is forgeable
- Raise `qty_remaining` back up to `qty_in` to resell already-sold stock

The `customer_merges` rule ([:993](firestore.rules#L993)) *does* bind the actor UID — the pattern exists in the codebase, it just wasn't applied to the ledger.

In a small wholesale business every owner-operator is an admin, so the ledger's integrity guarantee currently reduces to *"no one made a mistake and no session was stolen."*

### 3.5 HIGH — Two "Adjust stock" buttons with different audit guarantees

The main Inventory page's "Adjust stock" modal calls `stockIn`/`stockOut`, which require **no reason** and emit `PURCHASE_RECEIPT`/`STOCK_ISSUE` ledger rows — not `ADJUSTMENT`. The Product Lots modal calls `postStockAdjustment`, which **does** require a reason and emits a correct `ADJUSTMENT` row.

The result: a shrinkage write-off done through the main inventory screen is indistinguishable in the ledger from a genuine purchase receipt, with no reason recorded. This defeats shrinkage analytics entirely.

### 3.6 HIGH — Money tolerance of ±100 on invoice headers

[firestore.rules:61–63](firestore.rules#L61)

```
function approxHeaderMoneyEq(a, b) {
  return a is number && b is number && a >= b - 100.0 && a <= b + 100.0;
}
```

The comment says *"float error can exceed cents."* ±100 currency units is not float error — it is a skimming window on every invoice update. The sibling `approxMoneyEq` at ±0.05 is defensible; this is not.

### 3.6b HIGH — The outbox has no automatic dispatcher

`fulfillLedgerOutbox` runs **in the browser, after commit**. If it fails all 3 attempts, the source doc is marked `ledger_status: failed` and recovery depends on **a human opening the Inventory Health dashboard and clicking "Repair"** ([InventoryHealthDashboard.tsx:47](app/components/inventory/InventoryHealthDashboard.tsx#L47)).

There is no background worker, no scheduled sweeper, no Cloud Function scanning for `ledger_status in (pending, failed)`. If the tab closes, the network drops, or the user navigates away between the stock commit and the ledger write, **the ledger row is never written until someone happens to visit that dashboard.** `docs/inventory/STRESS_TESTING.md` presents a tidy recovery matrix in which every row terminates in a manual action.

Ledger repairs are also **anonymous** — the dashboard calls `repairInvoiceSaleLedger(db, row.id)` without passing a uid, so `posted_by_uid` is empty on every repaired row.

### 3.6c HIGH — The reconciliation script bypasses the ledger it exists to protect

`reconcile-book-stock.mjs:189` force-rewrites `products.stock_quantity` with a plain `batch.update` — **no `inventory_transactions` row, no `ADJUSTMENT` event, no reason code, no posting user.**

On 2026-07-10 it adjusted **43 products by 234 units** this way. An auditor asking *"why did OG Glass go from 1278 to 1379?"* has no answer inside the system — the only trace is an uncommitted JSON file on a developer's laptop.

This directly violates the project's own rule in `MIGRATION_RUNBOOK.md:87`: *"Never use 'sync stock from lots'… post a **Stock adjustment** with required reason."* The script that was actually used does exactly what the runbook forbids.

### 3.6d MEDIUM/UNVERIFIED — Possible rules rejection on every ledger write

[inventoryTransactionService.ts:99](lib/inventory/inventoryTransactionService.ts#L99) does:

```ts
tx.set(txnRef, header);      // ... writes lines ...
tx.update(txnRef, { item_ids: lineIds });
```

…against a collection whose rule is `allow update, delete: if false` ([firestore.rules:1006](firestore.rules#L1006)). Whether this passes depends on how Firestore evaluates a `set`+`update` pair on the same document within one commit. **I could not confirm the behaviour statically and there is no emulator test covering the inventory rules** (`test:rules` covers only `social.rules`).

If rules reject it, *every* ledger write fails — surfacing as `LedgerFulfillmentError` with stock already committed, i.e. exactly the "stock moved, ledger missing" state. **Verify this with an emulator test before anything else in this document.** The fix is trivial regardless: compute `lineIds` first and include `item_ids` in the initial `tx.set`.

### 3.7 MEDIUM — Ledger lines carry `unit_cost: 0` for returns and discards

[invoiceReturns.ts:67](lib/firestore/invoiceReturns.ts#L67), [inventoryDiscards.ts:276](lib/firestore/inventoryDiscards.ts#L276), [repairLedger.ts:36](lib/inventory/repairLedger.ts#L36)

The correct FIFO cost is known at that point, but the ledger line is written with `unit_cost: 0`, so `total_cost` computes to zero. Meanwhile `ADJUSTMENT` and `PURCHASE_RECEIPT` rows carry real costs. **Any valuation or COGS report built on `inventory_transactions` will understate returns and damage** — an inconsistency inside a single ledger. Sale lines have the same issue.

### 3.8 MEDIUM — Discards can get permanently stuck in `pending`

[repairLedger.ts:125–160](lib/inventory/repairLedger.ts#L125) queries only `invoices` and `invoice_returns` for stuck ledger status. `inventory_discards` writes `ledger_status: pending` but there is **no `repairDiscardLedger`**, so a discard whose `DAMAGE` ledger write fails drops out of Inventory Health forever.

Also: `postInventoryDiscard` is the only stock mutation **without a contention retry loop** ([:167](lib/firestore/inventoryDiscards.ts#L167)) — every other path has 3 attempts.

### 3.9 MEDIUM — Negative adjustments record the wrong cost

[stockAdjustment.ts:172](lib/inventory/stockAdjustment.ts#L172) writes `unit_cost: input.unitCost` on the outbound ledger line, but the stock actually consumed came from FIFO lots at their own costs. The operator's typed cost silently overrides real cost basis on the permanent audit record.

### 3.10 MEDIUM — 500-op transaction guard undercounts

[invoices.ts:776](lib/firestore/invoices.ts#L776) budgets `items.length * 3`, allowing exactly **one** `lot_consumptions` doc per line. Real cost is `lots_spanned + 2`. Any line spanning ≥2 lots undercounts, so a large invoice can pass the guard and then fail at commit. Handled gracefully (no corruption), but the user gets a confusing "split into smaller drafts" error.

### 3.11 MEDIUM — Posted returns are irreversible

No `voidReturn` exists anywhere, even though `firestore.rules:465` defines `invoiceReturnVoidedAtUnchanged` in anticipation. A mis-keyed posted return can only be patched with a manual stock adjustment, which will **not** unwind `return_lot_restorations` or the negative `sales` row — leaving the audit trail permanently wrong.

### 3.12 MEDIUM — `stock_lots` allows admin delete

[firestore.rules:1086](firestore.rules#L1086), self-labelled *"Temporary"*. Deleting a lot orphans its `lot_consumptions` records, which are themselves `delete: if false`. Destroys FIFO cost history.

### 3.13 MEDIUM — Audit-trail weaknesses an accountant would flag

- **`transaction_number` is random, not sequential.** [inventoryTransactionService.ts:21](lib/inventory/inventoryTransactionService.ts#L21) generates `ITX-{type}-{YYYYMMDD}-{random 4 digits}`. There is **no gapless sequence**, so a missing or deleted entry cannot be detected by number — and birthday collisions become material at ~100 transactions/day/type.
- **Reversals are unlinked.** `reverses_transaction_id` exists on the type but is never populated. `SALE` and `SALE_VOID` share an *identical* `source_document_id`, distinguished only by `type`. There is no explicit reversal chain to follow.
- **No general ledger.** [registerDefaultSubscribers.ts:14](lib/inventory/registerDefaultSubscribers.ts#L14) is an explicit **no-op stub** — the accounting subscriber is a comment reading *"future AccountingService plugs in here."* No debit/credit pairs, no account codes, no trial balance, no period close. The event bus is in-process, synchronous and non-durable: an event fired with no subscriber registered is gone.
- **No period locking.** Nothing prevents backdated posting into a closed period; there is no concept of a closed period.
- **`posted_at` on the emitted event uses client `new Date()`** ([:157](lib/inventory/inventoryTransactionService.ts#L157)) rather than `serverTimestamp()` — client clock skew lands in the audit stream.

### 3.14 MEDIUM — Reporting inconsistencies and scale problems

- **Three different inventory valuations, none reconciled.** `/inventory` shows `Σ cost_price × stock_quantity` (current list cost). `/reports/fifo` shows `Σ qty_remaining × unit_cost` (the accounting-correct FIFO value). `stockSummary.ts` computes both but is consumed **only by the dashboard**. Whenever `cost_price` drifts from lot costs — which it does — the screens disagree with no explanation. **There is no single, totalled, printable Inventory Valuation Report.**
- **The movement log is unusable at scale.** [InventoryMovementLog.tsx:51](app/components/inventory/InventoryMovementLog.tsx#L51) subscribes to the **entire** `inventory_transaction_lines` collection, unfiltered and unbounded. It renders **raw Firestore document IDs** in the Product column ([:129](app/components/inventory/InventoryMovementLog.tsx#L129)), and has no date filter, type filter, search, pagination, value column, running balance, or user attribution.
- **No CSV/Excel export anywhere.** A repo-wide grep for `csv|xlsx` returns zero hits. The only export is the reorder-list PDF. Every report is screen-only.
- **`turnoverMetrics.ts` is not used by any inventory screen** — velocity, days-of-cover and turns ratio exist but are only wired into the dashboard. The inventory area has zero velocity signal.
- **The reorder list has no suggested order quantity** ([reorderList.ts:56](lib/inventory/reorderList.ts#L56)) — no reorder qty, no EOQ, no consumption rate. The buyer writes quantities on the printed PDF by hand.
- **Missing standard reports:** stock ageing buckets, dead/slow-moving stock, ABC analysis, adjustment report, supplier price variance, valuation-as-of-date.
- **No sorting or pagination on any inventory table**; several screens open 5+ unbounded collection listeners at once.

### 3.15 LOW — Assorted

- **Full-collection scans on the client.** `loadStockSummary` ([stockSummary.ts:38](lib/inventory/stockSummary.ts#L38)) downloads *every* product and *every* lot on each dashboard render. `prefetchSortedLotIdsForProduct` ([lotAdmin.ts:22](lib/firestore/lotAdmin.ts#L22)) scans all `stock_lots` with no `where` clause. `stockLotsQuery.ts:12` fetches all lots per product including fully-consumed ones.
- **Missing indexes.** No composite index on `stock_lots (product_id, qty_remaining, received_at)`, none on `inventory_transaction_lines`, none for the movement log's chronological feed.
- **FIFO tie-breaking is nondeterministic** — [invoices.ts:178](lib/firestore/invoices.ts#L178) has no tiebreaker, and lots with missing `received_at` all collapse to 0.
- **Discard COGS is never rounded** ([inventoryDiscards.ts:118](lib/firestore/inventoryDiscards.ts#L118)) — float artifacts land in stored money fields and render raw.
- **Dead code.** `preloadedLotsByProduct` ([invoices.ts:717](lib/firestore/invoices.ts#L717)) is built and never read. `FIRESTORE_TXN_DOC_CAP` in `invoiceReturns.ts:37` is unused. `AddSaleForm` (legacy `recordSale`, no lot consumption) and `walkInSessions.ts` (oversell + no lot consumption) are both **unreachable from any page** — dead but loaded.
- **`firestore-debug.log` (132 KB) is committed** at the repo root and not gitignored. Emulator logs routinely contain document contents.

---

## 4. Feature gaps vs professional standard

### 4.1 Missing master data

`ProductDoc` ([lib/types/firestore.ts:18](lib/types/firestore.ts#L18)) has no:

| Field | Impact |
|---|---|
| **Unit of measure / pack size** | **Most damaging for a wholesaler.** Everything is implicitly "each" — cases vs units cannot be represented. `quantity is int` throughout the rules also forbids kg/litre. |
| **SKU / item code** | The Firestore doc ID is the only key. No stable business identifier. |
| **Barcode / EAN** | Blocks all scanner-driven receiving and picking. |
| **Per-product reorder point / safety stock** | One **global** threshold of 5 units for every product ([lowStock.ts:1](lib/inventory/lowStock.ts#L1)) — from screwdrivers to pallets. |
| **Preferred supplier / lead time / MOQ** | `trader_id` lives only on the lot, so reorder suggestions can't know who to buy from or how early. |
| **`is_active` / discontinued** | Customers, traders and parties all have it; products don't. Dead SKUs can't be retired. |
| **`updated_at`** | Has `created_at` only. |
| **Tax code / HSN**, weight, dimensions | Absent. |
| **`stock_quantity_reserved`** | No allocation concept — drafts don't reserve stock. |

`StockLotDoc` has no **expiry / best-before** (total blocker for FEFO — no food, pharma, or cosmetics), no **supplier batch number** (no recall traceability), no **landed-cost breakdown** (freight/duty can't be apportioned), no **PO/GRN reference**, and no **bin location**. `warehouse_id` is optional, so multi-warehouse is nominal only.

### 4.2 Missing processes

| Process | Status |
|---|---|
| **Stock take / physical count / cycle counting** | **Absent.** No count sheets, no variance report, no freeze. The only route is a free-text adjustment. This is the single biggest process gap. |
| **Purchase returns to supplier** | **Absent.** No `PURCHASE_RETURN` type. Only a negative adjustment, which doesn't link to a trader or reduce payables. |
| **Purchase orders / goods receipt against PO** | Absent. Receiving is ad-hoc `stockIn`. |
| **Stock reservation / allocation** | Absent. Drafts don't hold stock. |
| **Multi-warehouse / transfers** | Types exist (`TRANSFER`, `to_warehouse_id`) but no implementation or UI. |
| **Approval workflow on write-offs** | Absent. No maker/checker, no `approved_by_uid` on discards. |
| **Reason code taxonomy** | Free text only. No enumerated damage/expiry/theft/QC codes, so no shrinkage analytics. |
| **Serial number tracking** | Absent. |

### 4.3 What reporting *does* exist (this part is good)

- **Valuation** — at cost, at lot cost (true FIFO), at retail, plus unrealized gross profit and inventory margin % ([stockSummary.ts:15](lib/inventory/stockSummary.ts#L15))
- **FIFO audit dashboard** — lot aging, remaining valuation, per-invoice gross margin, reconciliation checks (`/reports/fifo`)
- **Purchase reports** — by product, trader, day/week/month, with KPIs (`/reports/purchases`)
- **Low stock + reorder list** with PDF export
- **Turnover metrics** — velocity, inventory days, turns ratio, health hints
- **Movement log** and **Inventory Health** dashboard with ledger repair

---

## 5. Operational tooling — built but not wired up

Genuinely good scripts exist:

| Script | Purpose |
|---|---|
| `npm run validate:inventory` | Read-only integrity check → `reports/` |
| `npm run reconcile:book-stock` | Fixes book-vs-lot drift. **Dry-run by default**, `--apply` to write. Well-built. |
| `npm run validate:inventory:nightly` | Fails if errors > 0 |
| `npm run migrate:inventory` | Versioned migrations with `--dry-run`/`--apply`/`--rollback` |
| `npm run inventory:export-baseline` | Captures parity fixtures |

**But there is no `.github/` directory at all, no cron, and no `vercel.json`.** Nothing is scheduled.

Worse: **`reports/` contains only the two `book-stock-reconcile` files and zero `inventory-validation-*.json`.** The validator appears to have **never been run against production**. Yet the nightly validation is referenced in the runbook, in `STRESS_TESTING.md`, and in the in-app health dashboard — which instructs the operator to run a **terminal command**. A control that is documented, surfaced in the UI, and never executed is worse than an absent one: it manufactures false assurance. It is also the stated gate for Phase 4 ("30 days green validation").

`nightly-validate.mjs` sets `INVENTORY_VALIDATION_MODE=nightly`, which **nothing reads** — it is functionally identical to `validate.mjs`.

**The documented rollback procedure does not work.** `config.ts` promises *"Override via env for rollback without redeploying"* and the runbook tells operators to edit `.env.local`. But all four flags are `NEXT_PUBLIC_*`, which Next.js **inlines into the client bundle at build time** — flipping them requires a full rebuild and redeploy. None are documented in `.env.example`.

**Shadow mode is dead code, and vacuous as written.** It is off by default with no env override. When enabled, `actual` is hardcoded to `{ persisted: false }` while `expected` is the full input — so they can never match and every operation logs a diff. It is a write-log of intended rows, not a parity checker.

### Test coverage

All three suites pass, but:

- **`validateInventory.test.ts` has exactly 3 assertions against 15 declared issue codes (~20%).** Its fixture omits `inventoryTransactions`/`inventoryTransactionLines` entirely, so **the entire ledger-integrity block never executes in any test**. `export-baseline.mjs` hardcodes those arrays empty, so the parity fixture can't cover them either.
- **`inventoryConcurrency.test.ts` tests a reimplementation, not the code.** `consumeFifo` is a local mock described as *"mirrors stockOut / postInvoice logic"* — it will keep passing if the real FIFO diverges. This is exactly why finding 3.1 is invisible. The "idempotency" test asserts that a JavaScript `Map` deduplicates.
- **Zero coverage** for `ledgerOutbox.ts` (the most consequential file), `invariantCheck.ts`, `repairLedger.ts`, `inventoryTransactionService.ts`.
- **`test:rules` covers only `social.rules`** — so the ledger immutability guarantee, the system's single strongest control, is itself untested.
- There is **no aggregate `npm test`** and no CI to run any of it.

---

## 6. Recommendations, in priority order

### Do today
1. **`firestore.rules:934` → `allow read: if isSignedIn()`.** One line. Stops the cost-price/margin leak to the open internet.
2. **Emulator-test the `tx.set` + `tx.update` pattern (3.6d).** If rules reject it, every ledger write is failing right now. Fix by folding `item_ids` into the initial `set` regardless.
3. **Run `npm run validate:inventory` against production.** It has apparently never been run. You need to know the current state before anything else.

### Do this sprint
4. **Fix the lost-update bug (3.1).** Move lot loading *inside* `runTransaction` and `tx.get` every lot of every affected product, so retries re-read fresh data. Cap products-per-invoice to stay under the 500-op limit, and fix the op estimate at [:776](lib/firestore/invoices.ts#L776) to `lots_spanned + 2`.
5. **Make the invariant two-sided (3.2)** — use `!==`, matching `assertStockLotInvariant`.
6. **Schedule the nightly validation** (GitHub Action or cron) and add an in-app "Run validation" button so the dashboard stops telling operators to open a terminal.
7. **Make `reconcile-book-stock.mjs` post real `ADJUSTMENT` ledger rows (3.6c)** instead of bare `batch.update`, with a reason and a service-account UID.
8. **Point the main "Adjust stock" button at `postStockAdjustment` (3.5)** so every adjustment carries a mandatory reason and a correct `ADJUSTMENT` ledger row.
9. **Write real `unit_cost` on return/discard/sale ledger lines (3.7).** Until this is done the ledger cannot value inventory.
10. **Add `validProductBase()`** enforcing `stock_quantity is int >= 0`, `cost_price >= 0`; split `allow write` into create/update/delete.
11. **Tighten `approxHeaderMoneyEq` (3.6)** from ±100 toward ±1, or move money to integer minor units.
12. **Remove `stock_lots` delete (3.12);** delete `firestore-debug.log` and gitignore it.

### Do this quarter
13. **Move posting, adjustment, and discard behind Admin-SDK API routes** using the existing `verifyRequestRoles` — *and* run the outbox dispatcher server-side (3.6b) so ledger fulfilment no longer depends on a browser tab staying open. This is the only change that makes the invariants actually hold; everything above is defence in depth around a client-trusted core.
14. **Add `validInventoryTransactionBase()`** with `posted_by_uid == request.auth.uid` binding, and emulator tests for the inventory rules.
15. **Fix the audit trail (3.13):** gapless sequence numbers, populated `reverses_transaction_id`, server timestamps on events.
16. **Build one consolidated Inventory Valuation Report** on the FIFO lot basis, and make `/inventory` use the same number (3.14).
17. **Fix the movement log** — filters, pagination, product *names*, user attribution.
18. **Schema migration for master data** — `uom`/`pack_size`, `sku`, `barcode`, per-product `reorder_point`/`safety_stock`, `is_active`, and `expiry_date` + `batch_number` on lots. **These get costlier with every document written — do them before the catalog grows.**
19. **Build stock take / cycle counting.** Count sheet → variance report → single reconciling adjustment batch. Note `FifoAuditReport` already computes the exact variance a count report needs — the data exists, the workflow doesn't.
20. **Build purchase returns to supplier** with a `PURCHASE_RETURN` ledger type.
21. **Add the missing indexes** (§3.15) and scope `stockLotsQuery` to `qty_remaining > 0`.
22. **Raise test coverage** — cover the ledger validation branches, test `ledgerOutbox` retry/failure, and make the concurrency test exercise the real FIFO code rather than a mock.
23. **Add CSV export** to every report.

### Later
24. Approval workflow + enumerated reason codes on write-offs.
25. `voidReturn` with proper restoration unwinding.
26. Stock reservation on drafts.
27. Real multi-warehouse + transfers.
28. Period locking / close.
29. The GL subscriber that `registerDefaultSubscribers.ts` is stubbed for.
30. Fix or delete shadow mode; document the flags in `.env.example` and note that changing them requires a rebuild.

---

## 7. Bottom line

The **accounting model is professional-grade** — FIFO cost layers, preserved cost basis on returns, LIFO unwinding of consumption chunks, an immutable ledger with deterministic idempotency keys, and dry-run-by-default remediation tooling with cross-project guards. Someone here understood inventory accounting properly. That foundation is worth protecting.

The **design is sound; the operation is where it falls down.** Specifically:

- The ledger records **quantities but not money** — sale, return and damage lines all carry `unit_cost: 0`, so COGS is not derivable from the ledger that exists to prove it.
- The outbox has **no automatic dispatcher** — recovery depends on a human clicking a button.
- The nightly validation that gates Phase 4 has **never run**.
- The one remediation that *did* execute in production silently rewrote 43 products' stock **outside the ledger it was built to protect** — violating the project's own runbook.
- Everything runs in the browser, and the product catalog with all cost prices is **readable by the open internet**.

The honest summary: **you have the accounting engine of a real ERP, wrapped in the security model of a prototype, with the controls documented but switched off — and missing the master-data fields a wholesale business specifically needs.**

Sequence: confirm the ledger is actually writing (3.6d) and close the public read today. Fix the concurrency bug and turn the controls on this sprint. Then move enforcement server-side and migrate the schema, before the data grows. The feature gaps — stock take, purchase returns, multi-warehouse — are real but can follow.
