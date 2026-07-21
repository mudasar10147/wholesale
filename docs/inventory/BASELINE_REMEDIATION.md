# M0.5 — Baseline remediation runbook

**Status:** Tool built and emulator-proven. **No production repair may run until the
M0 baseline has been run, reviewed, and frozen as the authoritative input.**
**Supersedes nothing; implements** [`PHASE1_INTEGRITY_ARCHITECTURE_V2.md`](./PHASE1_INTEGRITY_ARCHITECTURE_V2.md) §19.0.5-M.

**Temporary by construction.** `lib/inventory/reconcileMismatch.ts`,
`lib/inventory/reconciliationPlan.ts` and `scripts/inventory/reconcile-mismatch.mjs`
are **deleted in M6**, when the audited workflow replaces them. Their
`inventory_repairs` records use M6's schema, so the history is continuous.

## Why this milestone exists

M0 measures drift. M1 ships a two-sided transactional assertion that treats drift
as a hard error at posting time. Between them sits a live trading floor: any product
still drifted when the assertion lands **cannot be sold**. M0.5 brings drift to zero —
or to a known, expiring allowlist — first.

A normal adjustment **cannot** do this: it moves book and lots by the same amount, so
`book − lotTotal` is invariant under it, and the two-sided assertion would abort on the
first drifted product (§19.0.5-M.1). A purpose-built reconciliation is required.

## What the tool does

For each drifted product it derives, from append-only history, every lot's
history-implied remaining quantity and corrects to it — lots are **never** chosen by
FIFO or judgement:

```
h_i = qty_in_i − Σ active consumptions − Σ discard allocations + Σ restorations
```

Then, in one transaction per product (product read first as the concurrency anchor):

1. **Lot reconciliation** — set each drifted lot to `h_i`. Lots move, book does not. **L6 green.** `RECONCILIATION`, `movement:false`.
2. **Book reconciliation** — set `stock_quantity` to `Σ h_i`. Book moves, lots do not. **P1 green.** `RECONCILIATION`, `movement:false`.
3. **Physical adjustment** — *only* when a verified count `P ≠ Σ h_i`: apply `P − Σ h_i` through a real `ADJUSTMENT` (`movement:true`). This is genuine shrinkage/surplus and is recorded as a separate, honest event.

The transaction **asserts the post-state**: it refuses to commit unless P1 **and** L6
both hold afterwards. Writes are absolute and keyed by deterministic ids, so re-running
a repaired product is a no-op — no duplicate ledger or repair rows.

### The three concepts, kept separate (M.2)

| Event | Meaning | Ledger |
|---|---|---|
| Lot reconciliation | stored `qty_remaining` was wrong; no goods moved | `RECONCILIATION`, `movement:false` |
| Book reconciliation | `stock_quantity` was wrong; no goods moved | `RECONCILIATION`, `movement:false` |
| Physical adjustment | verified count differs; goods really are missing/found | `ADJUSTMENT`, `movement:true` |

### Refusal (the tool will NOT guess)

It refuses and escalates rather than repair when the history itself is broken:
a lot's `h_i < 0` (consumption exceeds intake), `h_i > qty_in`, a negative lot total,
a lot missing `received_at`, or a consumption/discard/restoration referencing a missing
lot. A tool that papers over a broken history is worse than no tool.

## Guardrails (M.8)

| Constraint | Enforcement |
|---|---|
| Never in the UI | Script only (`scripts/inventory/reconcile-mismatch.mjs`) |
| Dry-run default | Writes only with `--apply` |
| Explicit allowlist | `--allowlist <file>` mandatory; **max 10 products/run** |
| Verified backup | `--apply` requires `--backup <name>`, recorded in the run log |
| Second approver | `administrative` authority requires an approver |
| Repair identity | Admin SDK under `inventory-repair` (§13); never the validator |
| Project guard | `--project` mandatory; must match the credential's project |
| Post-validation | Every applied product re-derived clean, then run the full validator |
| Audit | One immutable `inventory_repairs` record per product, linking every ledger row |

## Operator procedure

**Prerequisite:** the M0 baseline exists, is reviewed, and each drifted product has an
evidence sheet establishing truth (physical count preferred; else reconstruct from
`lot_consumptions`). Triage H1–H5 per product first.

1. **Verified backup.** Export production; note its name.
2. **Build the allowlist** (≤10 products) — a JSON array:
   ```json
   [ { "productId": "abc123",
       "authorityCategory": "physical_count",
       "reasonDetail": "Counted 2026-07-21 by AK; matches shelf",
       "physicalCount": 98,
       "approvedByUid": "uid-of-second-approver" } ]
   ```
   `authorityCategory` ∈ physical_count · purchase_receipt · invoice_history ·
   consumption_history · return_history · discard_history · administrative.
   Omit `physicalCount` for pure book/lot reconciliation. `approvedByUid` is required
   for `administrative`.
3. **Dry-run** and read every plan line:
   ```
   node --import ./scripts/support/registerTsAlias.mjs scripts/inventory/reconcile-mismatch.mjs \
     --project prod --run-id <baselineRunId> --acted-by <uid> --allowlist repairs.json
   ```
   (or `npm run reconcile:mismatch -- --project prod --run-id … --acted-by … --allowlist repairs.json`)
4. **Apply** once the plan is confirmed:
   ```
   … --apply --backup gs://backups/2026-07-21-preremediation
   ```
5. **Post-validate.** The tool re-derives each product clean and halts the batch on any
   that is not. Then run the full validator:
   `npm run validate:inventory -- --project prod`.
6. **Repeat** in batches of ≤10, re-validating after each. A batch that does not reduce
   drift as predicted **stops the milestone**.
7. **Residual register.** Anything deliberately left unrepaired goes on the residual
   register with a reason, a named owner, and an expiry (max 7 days). If the residual set
   is material, the M1 assertion ships behind the expiring allowlist, not on schedule.

## Re-accrual

M0.5 repairs while M2 has not shipped, so some drift may re-accrue before M1. Expected,
not a flaw: detection must precede correction. Re-validate immediately before the
two-sided assertion ships and accept a short second remediation pass.

## Tests

- Pure derivation + gates: `npm run test:reconcile-plan` (in-memory, fast).
- Emulator proof (100/103, ledger honesty, idempotency, concurrency, RECONCILIATION vs
  ADJUSTMENT separation, refusal, dry-run): `npm run test:inventory-reconcile`.
