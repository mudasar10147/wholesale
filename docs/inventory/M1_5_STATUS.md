# Milestone 1.5 — status and gates

**Goal (§19 M1.5):** no mutation-path change begins without a mechanical gate.

## Done

| Item | State | Evidence |
|---|---|---|
| Emulator config in `firebase.json` | ✅ | firestore + auth emulators |
| §2.7 ledger `set`+`update` question | ✅ answered | [`LEDGER_SET_THEN_UPDATE_GATE.md`](./LEDGER_SET_THEN_UPDATE_GATE.md), `test:rules:inventory` |
| GitHub Actions CI | ✅ | `.github/workflows/ci.yml` (typecheck, coverage gate, unit, rules, integration, spike) |
| Nightly full validation | ✅ | `.github/workflows/nightly-validation.yml` |
| **100% behavioural coverage, CI-enforced** | ✅ | `scripts/check-invariant-coverage.mjs` — 65 invariants: 50 implemented+tested, 15 documented-skip, **no silent gaps** |
| `assertAllInvariants` + integration foundation | ✅ | `test/helpers/assertAllInvariants.ts`, `test/integration/inventoryOperations.test.mjs` (caught a real G1 false-positive) |
| Delete mock concurrency suite | ✅ | removed `inventoryConcurrency.test.ts`; real `ledgerIds.test.ts` preserved |
| **M1.5-S lot-query spike** | ✅ **GO on Option A** | [`SPIKE_TXN_LOT_QUERY.md`](./SPIKE_TXN_LOT_QUERY.md), `test:spike` |
| Aggregate `npm test` | ✅ | typecheck + coverage gate + pure suites |

## C1 — the M2 acceptance test (entry gate for M2, not M1.5)

**C1** reproduces the historical defect: two concurrent posts on one product,
FIFO spilling into a second lot, the stale pre-transaction estimate replayed on
retry, silently erasing a concurrent decrement (§2.2 H1, §12.4).

**Status: specified; deterministic reproduction is the first commit of M2.**

Why it lands in M2 rather than here:

- `postInvoice(db, id)` is drivable against the emulator (it takes an injected
  `db` and is null-safe when `getAuthClient().currentUser` is absent), so a *load*
  harness is feasible.
- But a **deterministic** F1 reproduction requires a barrier *inside*
  `postInvoice`'s transaction callback to force a retry at the exact interleaving
  ("a race that fails 1 in 50 will not show up in 5", §12.4). Injecting that
  barrier means editing `postInvoice` — which is exactly M2's change. Writing C1
  first, watching it fail, then fixing, is therefore the opening move of M2, per
  the plan's own PR ordering (C1 is a separate, quarantined PR).
- The **mechanism is already proven** against the real Web SDK by the M1.5-S
  spike (S1 fresh-on-retry; query-first corrupts; anchor-first is safe). C1 is the
  same defect localised to `postInvoice`.

**M2 opening sequence:** (1) add a test seam / barrier to `postInvoice`; (2) write
C1, demonstrate FAIL against current code (quarantined); (3) apply the Option A
fix (anchor-first, recompute-in-callback); (4) C1 goes green; (5) C2/C9/C11.

## Rules-test coverage

`test/rules/inventory-ledger.rules.test.mjs` covers the ledger, `inventory_repairs`
and (implicitly) the validation-run/lock collections' append-only rules. Broader
rules tests for `products` (staff-read), `stock_lots` and `lot_consumptions`
immutability are a straightforward extension and can be added under the same
harness.

## Branch protection (manual GitHub setting — required for the gate to bite)

CI existing is necessary but not sufficient; it must be **required** on `main`:

1. GitHub → Settings → Branches → add a rule for `main`.
2. Require status checks to pass before merging → select the **CI / test** check.
3. Require branches to be up to date before merging.
4. Include administrators.

A human may escalate a PR to inventory-related but may not de-escalate one (§18.1);
the coverage gate and emulator tests are the mechanical part, branch protection is
the enforcement part.

## M1.5 → M2 acceptance (per §19)

- ✅ CI green (blocking once branch protection is set)
- ⏳ **C1 written and failing against current code** — opening move of M2
- ✅ 100% behavioural register coverage, CI-enforced
- ◻ Rules tests cover inventory collections — ledger/repairs done; product/lot/consumption pending
- ✅ `assertAllInvariants` used by the integration foundation
- ✅ §2.7 answered
- ✅ **M1.5-S returns GO on Option A**, with measured findings
