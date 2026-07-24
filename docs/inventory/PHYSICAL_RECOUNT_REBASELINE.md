# Physical recount re-baseline — the future recovery strategy

> **STATUS: planned, not yet executed.** This is the workflow that will restore an
> authoritative inventory baseline **after Phase 1 is complete and the inventory
> system is proven stable.** It does not run during M0.5. M0.5 only builds and
> proves the tool it will use.

## Why a physical recount, not historical reconstruction

A pre-architecture script force-synced production lot quantities to product stock
without validation or audit. As a result the append-only lot/consumption history no
longer reconciles with the stored quantities, and **no internal figure — book, lot,
or history-derived — can be trusted as the truth** for existing production data
(see [`BASELINE_REMEDIATION.md`](./BASELINE_REMEDIATION.md)).

The only trustworthy source is a **fresh manual count of the physical warehouse.**
That count becomes the new, authoritative baseline; everything recorded before it is
frozen as pre-re-baseline history.

## The doctrine

1. **The frozen physical warehouse count is the single source of truth.** Each
   product's counted quantity `P` is authoritative.
2. **The recount is a new epoch.** After it, the counted state is the baseline and
   the M1 validator asserts against it going forward. Pre-recount history is retained
   for audit but is not treated as truth.
3. **Every change is recorded honestly** as `RECONCILIATION` (a stored number was
   left as-found, no goods moved) and/or `ADJUSTMENT` (`movement:true`, the counted
   truth differs from the internal figure — real shrinkage/surplus), with an
   immutable `inventory_repairs` record per product.

## Preconditions (do not start until all hold)

- Phase 1 is complete: M1 validator live, M2 stale-snapshot fix shipped and observed,
  M3–M6 delivered. The mechanism that (hypothetically) caused drift is fixed, so the
  recount is not immediately re-corrupted.
- A **frozen** physical count exists: counting is finished, the warehouse is not
  transacting during the freeze window, and the count is signed off.
- A verified production export (backup) exists and is named in the run log.
- The count is captured per product in the input format below.

## Input format

A JSON array, one entry per counted product (the same allowlist the tool already
accepts, constrained to `physical_count` authority). Batches of **≤10 products**:

```json
[
  {
    "productId": "PRODUCT_DOC_ID",
    "authorityCategory": "physical_count",
    "physicalCount": 98,
    "reasonDetail": "Warehouse recount 2026-XX-XX, sheet #, counted by <name>",
    "approvedByUid": "OPTIONAL_SECOND_APPROVER_UID"
  }
]
```

An example lives at
[`examples/physical-recount.example.json`](./examples/physical-recount.example.json).

## Procedure

1. **Freeze & count.** Halt inventory mutation, count every product, sign off the sheet.
2. **Back up.** Export production; record the backup name.
3. **Build batches** (≤10 products) from the count, `authorityCategory: "physical_count"`.
4. **Dry-run** against production and review each product's plan:
   ```
   npm run reconcile:mismatch -- --project prod --run-id <recountId> \
     --acted-by <uid> --allowlist recount-batch-01.json
   ```
5. **Apply.** The tool refuses a production apply unless every entry is
   `physical_count` with a `physicalCount`:
   ```
   npm run reconcile:mismatch -- --project prod --run-id <recountId> \
     --acted-by <uid> --allowlist recount-batch-01.json \
     --apply --backup <backup-name>
   ```
   Each product ends at its counted quantity `P`, with a `RECONCILIATION` row (the
   internal figures as-found) and, where `P` differs, an `ADJUSTMENT` (`movement:true`).
6. **Validate.** The tool re-derives each product clean and halts on any that is not;
   then run `npm run validate:inventory -- --project prod`.
7. **Repeat** batch by batch until the whole warehouse is re-baselined.
8. **Declare the new baseline.** Record the recount run id as the authoritative
   baseline; the M1 validator asserts against it thereafter.

## Open design decisions to finalize when this is built

The current tool derives per-lot corrections from history and **refuses on broken
history** (negative `h_i`, `h_i > qty_in`, missing `received_at`, dangling refs). For
a physical re-baseline where history is explicitly *not* trusted, two questions must
be settled before execution — they are recorded here so the decision is deliberate,
not accidental:

1. **Refusals on corrupt history.** A product whose history trips a sanity gate will
   be refused by the current tool, yet the recount still needs to set it to `P`.
   Options: (a) fix or annotate the offending history first (preferred where feasible);
   (b) add a narrow, well-guarded **physical-authoritative mode** that bypasses the
   history gates and sets state directly to `P`, recording the full difference as an
   `ADJUSTMENT` with no history-derived `RECONCILIATION`. If (b), it ships with its own
   emulator proof and the same M.8 guardrails, and is likewise deleted in M6.
2. **Per-lot allocation under untrusted history.** When history cannot say which lot
   holds the counted units, decide the allocation rule (e.g. collapse to a single
   recount lot at a chosen cost basis, or distribute by newest-first). This affects
   FIFO/COGS going forward and must be chosen explicitly.

Neither decision changes the M0.5 deliverable. They are the first design step of the
recount execution, taken when Phase 1 is complete and a real count exists.
