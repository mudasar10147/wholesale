# M0.5 — Reconciliation tool (validation milestone)

> **STATUS — read first.** M0.5 is now a **tool-validation** milestone, **not** a
> production-remediation milestone. The reconciliation tool is **built, fully
> emulator-proven, production-safe, and INACTIVE.** No production reconciliation
> is performed in this milestone, and no attempt is made to reconstruct historical
> production drift. The future recovery uses a **frozen physical warehouse count**
> as the source of truth — see [`PHYSICAL_RECOUNT_REBASELINE.md`](./PHYSICAL_RECOUNT_REBASELINE.md).

**Implements** [`PHASE1_INTEGRITY_ARCHITECTURE_V2.md`](./PHASE1_INTEGRITY_ARCHITECTURE_V2.md) §19.0.5-M.
**Temporary by construction** — `lib/inventory/reconcileMismatch.ts`,
`lib/inventory/reconciliationPlan.ts` and `scripts/inventory/reconcile-mismatch.mjs`
are **deleted in M6**. Their `inventory_repairs` records use M6's schema, so the
audit history is continuous across the transition.

## Why current production is not historical truth

Before this architecture existed, a one-off script **force-synced production lot
quantities to product stock without validation or audit** (the same class of tool
`reconcile-book-stock.mjs` represents). As a consequence:

- The append-only lot/consumption history **no longer reconciles** with the stored
  lot quantities, so the history-implied derivation (`h_i`, below) **cannot be
  trusted to reconstruct real production drift.**
- Neither book stock, nor lot quantities, nor derived history can be treated as
  authoritative for production. **Only a fresh physical count can.**

Therefore this milestone deliberately does **not** run the tool against production.
The revised objectives are:

1. Finalize the reconciliation implementation. *(done — unchanged since it was proven)*
2. Prove it completely in the emulator. *(done — see Tests)*
3. Finalize all documentation, runbooks, schemas and guardrails. *(this doc + the recount doc)*
4. Keep the tool production-safe but inactive. *(dry-run default; production `--apply` gated to `physical_count`)*
5. Prepare the future physical-recount re-baseline workflow. *(see [`PHYSICAL_RECOUNT_REBASELINE.md`](./PHYSICAL_RECOUNT_REBASELINE.md))*

## What the tool does (unchanged, emulator-proven)

For a product it derives, from append-only history, every lot's history-implied
remaining quantity — lots are **never** chosen by FIFO or judgement:

```
h_i = qty_in_i − Σ active consumptions − Σ discard allocations + Σ restorations
```

Then, in one transaction per product (product read first as the concurrency anchor,
plan recomputed from fresh reads inside the transaction):

1. **Lot reconciliation** — set each drifted lot to `h_i`. Lots move, book does not. **L6 green.** `RECONCILIATION`, `movement:false`.
2. **Book reconciliation** — set `stock_quantity` to `Σ h_i`. Book moves, lots do not. **P1 green.** `RECONCILIATION`, `movement:false`.
3. **Physical adjustment** — *only* when a verified count `P ≠ Σ h_i`: apply `P − Σ h_i` as a real `ADJUSTMENT` (`movement:true`). Genuine shrinkage/surplus, recorded as a separate, honest event.

It **asserts the post-state**: refuses to commit unless P1 **and** L6 both hold
afterwards. Writes are absolute and keyed by deterministic ids, so re-running a
repaired product is a no-op — no duplicate ledger or repair rows.

> **How this maps to the future recount.** When history is untrusted, the truth is
> the physical count `P`. Feeding `P` as `physicalCount` still drives the product to
> `P` as its final state; the `RECONCILIATION` row (often with no lot corrections and
> `book_before == book_after`) honestly records that the internal book/lot figures
> were left as-found, and the `ADJUSTMENT` row carries the entire real difference to
> the counted truth. See the recount workflow for how per-lot semantics and history
> gates are handled in that epoch.

### The three concepts, kept separate (M.2)

| Event | Meaning | Ledger |
|---|---|---|
| Lot reconciliation | stored `qty_remaining` was wrong; no goods moved | `RECONCILIATION`, `movement:false` |
| Book reconciliation | `stock_quantity` was wrong; no goods moved | `RECONCILIATION`, `movement:false` |
| Physical adjustment | verified count differs; goods really are missing/found | `ADJUSTMENT`, `movement:true` |

### Refusal (the tool will NOT guess)

It refuses and escalates rather than repair when the history itself is broken:
a lot's `h_i < 0` (consumption exceeds intake), `h_i > qty_in`, a negative lot total,
a lot missing `received_at`, or a consumption/discard/restoration referencing a
missing lot. A tool that papers over a broken history is worse than no tool.

## Guardrails (M.8)

| Constraint | Enforcement |
|---|---|
| Never in the UI | Script only (`scripts/inventory/reconcile-mismatch.mjs`) |
| Dry-run default | Writes only with `--apply` |
| Explicit allowlist | `--allowlist <file>` mandatory; **max 10 products/run** |
| **Production is physical-count-only** | A production `--apply` refuses any entry that is not `physical_count` with a `physicalCount` |
| Verified backup | `--apply` requires `--backup <name>`, recorded in the run log |
| Second approver | `administrative` authority requires an approver |
| Repair identity | Admin SDK under `inventory-repair` (§13); never the validator |
| Project guard | `--project` mandatory; must match the credential's project |
| Post-validation | Every applied product re-derived clean, then run the full validator |
| Audit | One immutable `inventory_repairs` record per product, linking every ledger row |

## Operating posture in M0.5: INACTIVE

- No production allowlist exists and none should be created in this milestone.
- The tool is exercised **only** against the Firestore emulator (see Tests).
- Any real use is deferred to the physical-recount re-baseline
  ([`PHYSICAL_RECOUNT_REBASELINE.md`](./PHYSICAL_RECOUNT_REBASELINE.md)), after
  Phase 1 is complete and the system is proven stable.

The emulator remains the place to demonstrate the mechanics on demand:

```
# dry-run against the emulator only — NEVER --project prod in this milestone
npm run test:inventory-reconcile      # the full proof suite
npm run test:reconcile-plan           # the pure derivation + gates
```

## Tests

- Pure derivation + gates: `npm run test:reconcile-plan` (in-memory, fast).
- Emulator proof: `npm run test:inventory-reconcile` — the 100/103 proof, ledger
  honesty, idempotency, concurrency, RECONCILIATION vs ADJUSTMENT separation,
  refusal, dry-run, and the **physical-count-authoritative re-baseline** scenario
  (a product with no book/lot drift whose counted quantity differs → a single
  honest `ADJUSTMENT`).
- Rules (append-only `inventory_repairs`, §2.7 ledger): `npm run test:rules:inventory`.
