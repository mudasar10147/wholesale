# Physical Stock Correction — admin re-baseline tool

**Status:** in development on `phase1/physical-stock-correction`. **Does not touch
production** during development or testing. Stop at PR + emulator proof for review.

A per-product, physically-authoritative correction: the operator enters the counted
warehouse quantity, and the tool sets the product to exactly that — **without**
reconstructing anything from invoices, purchases, ledger, or historical lots. It does
**not** use the history-reconstruction reconciliation tool (`reconcileMismatch`).

---

## Key codebase facts this design is built on

Confirmed from the data model (`lib/types/firestore.ts`, `firestore.rules`,
`lib/inventory/invariants.ts`):

1. **Quantities are integer-only — a hard invariant (P3 "Book stock integer"), not a
   per-product setting.** There is no unit/UOM/`allow_fractional`/decimals field
   anywhere. `stock_quantity`, `qty_in`, `qty_remaining` are all integers, enforced at
   transaction + rules + validator layers. → **The tool accepts whole numbers only and
   rejects non-integers.** (The spec's "fractional per unit config" has no backing in
   this schema; if fractional units are ever needed it's a separate schema change.)
2. **There is no separate SKU or barcode field on `products`.** The product **document
   id is the SKU key**; `name` is the only other human identifier; `image_url` is the
   image. → Search supports **exact document-id lookup** and a **name search that
   returns candidates the operator selects** (selection resolves to a doc id). We
   **never** update from a typed name alone. (A true barcode scan would need a new
   `barcode` field on products — out of scope here; noted for later.)
3. **The Admin SDK bypasses Firestore rules**, and `inventory_transactions`,
   `inventory_transaction_lines`, `inventory_repairs` are **client-immutable**
   (`update/delete: if false`). All correction writes therefore run **server-side via
   the Admin SDK** in a single transaction — never client-side edits.
4. An **`adjustment`-source lot** satisfies `validStockLotBase` with `qty_in > 0` and
   needs **no** `trader_id`/`purchase_source` (those are only required for `stock_in`).
   So the recount baseline lot uses `source: "adjustment"`.
5. `stock_lots` rules use **no `hasOnlyKeys`** ("legacy/imported lots may include extra
   fields"), so we may add recount marker fields to a lot without a rules change.

---

## Per-product correction behavior (one atomic Admin-SDK transaction)

Given a product `P`, a counted quantity `C` (integer ≥ 0), a resolved `unit_cost`, and
an idempotency key:

1. **Read + before-state.** Load the product (`before_book = stock_quantity`) and all
   its lots. `before_lot_total = Σ qty_remaining` over open lots (`qty_remaining > 0`);
   capture each open lot's `{id, qty_remaining}`.
2. **Stale-preview guard.** The caller passes `expected_current_stock` and an
   `expected_open_lot_total` captured at preview time. If either differs from the live
   read, **abort with `STALE_PREVIEW`** — the UI must reload and re-confirm.
3. **Idempotency.** The correction document id is derived from the idempotency key and
   written with `.create()`; a replay throws `ALREADY_EXISTS` and commits nothing new.
4. **Close existing open lots.** For every lot with `qty_remaining > 0`: set
   `qty_remaining = 0`, `closed_by_recount = true`, `recount_correction_id`,
   `closed_at`, `updated_at`. Immutable fields (`qty_in`, `received_at`, `created_at`,
   `product_id`) are untouched — **no historical lot is deleted.**
5. **Create the baseline lot (only when `C > 0`).** Exactly one new lot:
   `source: "adjustment"`, `qty_in = C`, `qty_remaining = C`, `unit_cost`,
   `reference_id: "physical-recount:<sessionId>"`, `recount_baseline = true`,
   `recount_correction_id`, `received_at/created_at/updated_at = serverTimestamp`.
   When `C = 0`, **no** new open lot is created.
6. **Set product stock.** `stock_quantity = C`; `cost_price = unit_cost` when `C > 0`.
7. **Ledger.** One `ADJUSTMENT` `inventory_transaction` (`movement: true`) for the net
   `delta = C - before_book` (surplus if `> 0`, shrinkage if `< 0`), with a transaction
   line (`direction`, `quantity = |delta|`, `before_on_hand = before_book`,
   `after_on_hand = C`). `reason: "Physical stock recount"`. When `delta = 0` the
   ledger row is still written for a complete audit trail (movement of 0 lots is noted).
8. **Audit record.** One immutable `physical_stock_corrections` doc (fields below).
9. **In-transaction self-verify (before commit).** Assert `stock_quantity == C`, open
   lot total `== C`, exactly one open lot when `C > 0` / zero open lots when `C = 0`.
   On failure the transaction **throws and rolls back** — a correction never commits a
   state that fails its own check. The result is stored on the audit record.

### Invariant treatment (P1 vs L6)

- **P1 (stock == Σ open lot qty_remaining)** holds by construction: zeroed lots
  contribute 0, the one baseline lot contributes `C`, `stock = C`.
- **L6 (per-lot: qty_remaining == qty_in − consumptions − discards + restorations)**
  would be violated on a *closed* pre-recount lot (its `qty_in` had prior consumptions,
  now forced to `qty_remaining = 0`). Per the re-baseline doctrine
  ([`PHYSICAL_RECOUNT_REBASELINE.md`]) **the recount is a new epoch and pre-recount lots
  are frozen, not asserted.** The validator's L6 check therefore **excludes lots marked
  `closed_by_recount`**. The new baseline lot satisfies L6 normally. This is the one
  narrow validator change shipped with the tool.

---

## Cost resolution (in order; positive count blocked on invalid cost)

1. **Latest valid stock-in cost** — most recent `stock_lots` where `source == "stock_in"`
   and `unit_cost > 0`, by `received_at desc`. `cost_source: "latest_stock_in"`.
2. else **product purchase cost** — `products.cost_price` when `> 0`.
   `cost_source: "product_cost_price"`.
3. else **operator-entered** `manual_unit_cost`. `cost_source: "manual"`.

A **positive** count with a missing/zero/negative/NaN cost is **rejected**
(`COST_REQUIRED`). The resolved cost + source are shown before confirmation. When
`C = 0`, no cost is needed (no lot created).

---

## Audit record — `physical_stock_corrections/{correctionId}` (immutable)

`correction_id` · `recount_session_id` (batch) · `product_id` · `product_name` ·
`sku` (= product doc id) · `barcode` (null — no field yet) · `before_book_stock` ·
`before_lot_total` · `physical_count` · `stock_delta` · `closed_lots` (`[{lot_id,
qty_remaining_before}]`) · `new_lot_id` (null when `C = 0`) · `unit_cost` ·
`cost_source` · `ledger_transaction_id` · `operator_uid` · `operator_email` ·
`reason` · `created_at` · `post_update_validation` (`{ok, checks}`).

Rule: admin read, admin create, **no update/delete** (append-only). Undo is only a new,
audited correction — never a deletion.

---

## Security

- Endpoint + page restricted to **authenticated admins** (`request.auth.token.admin`),
  verified server-side on every call (not just UI-gated).
- Correction executes with the **server Admin SDK** (bypasses rules by design; that is
  why server-side admin verification is mandatory).

---

## Production execution notes (NOT part of dev/test)

- Runs with a **write-capable admin service-account credential** — **NOT** the
  read-only validator SA (`roles/datastore.viewer` cannot write, by design).
- **Back up production first.** Correct **product by product** (or small batches);
  each correction is atomic and independently audited.
- Prefer a **quiet/freeze window** so `before_book` matches the counted moment; the
  stale-preview guard catches drift between preview and update.
- The count is authoritative; do **not** run the history-reconstruction tool.
- After a batch, run `validate:inventory --project prod` (read-only) and confirm no new
  P1; closed pre-recount lots are frozen (excluded from L6).

---

## Emulator test matrix (proof before any production use)

`npm run test:physical-recount` (also in the `test:inventory-emulator` aggregate).
**14/14 green.** Covers: incorrect starting stock/lot totals · positive count · zero
count · shrinkage · surplus · cost sources (latest stock-in / product cost / manual) ·
missing cost (rejected, nothing written) · negative & non-integer (rejected) ·
duplicate submission (idempotent, one write) · concurrent same-key (commits once) ·
ambiguous/unknown product · product changed after preview (STALE_PREVIEW, nothing
written) · next correction reads fresh state · **post-update validator success** (P1
green; recount-closed lots excluded from L6; exactly one open baseline lot).

## UI flow (`/inventory/stock-correction`, admins only)

1. **Search** by exact product id/SKU or by name → pick a candidate (never name-only).
2. **Product panel** shows image, name, SKU, current stock, open-lot total, and the
   open lots. A warning shows if book stock already disagrees with the lot total.
3. **Enter the counted quantity** (whole number). If no cost is on file for a positive
   count, a **unit-cost field appears** (required). The resolved cost + its source are
   shown.
4. **Preview** shows the new stock and the surplus/shrinkage difference, and that the
   old lots will be closed and one baseline lot created (none for a zero count).
5. **Update inventory → confirmation modal** (double-submit protected) restates the
   change and warns it is immediate and audited. **Confirm** applies it.
6. **Result** banner (success/failure with the post-check outcome), then **Change
   product** to continue. A **Recent corrections** table shows the audit trail, and
   searched products already corrected this session show a ✓ indicator.

## Files

- Service: `lib/inventory/physicalStockCorrection.ts` (+ L6 exclusion in
  `lib/inventory/invariants.ts`; types in `lib/types/firestore.ts`; collection in
  `lib/firestore/collections.ts`).
- Endpoint: `app/api/inventory/stock-correction/route.ts` (admin-gated).
- Client: `lib/inventory/physicalCorrectionClient.ts`.
- UI: `app/components/inventory/PhysicalStockCorrectionCard.tsx` +
  `app/(dashboard)/inventory/stock-correction/page.tsx` + nav item.
- Rule: `physical_stock_corrections` in `firestore.rules` (admin read/create, immutable).
- Tests: `test/inventory/physicalRecount.emulator.test.mjs`.

## Status

Built and proven on the emulator; **no production inventory touched.** `npm run test`
(typecheck + pure suite) and `npm run test:physical-recount` are green. Ready for
review. Firestore rules deploy separately (not via app deploy) — deploy the rule
before the endpoint is used in production.
