# M2 — controlled deployment runbook (invoice-posting stale-snapshot fix)

**Status:** PREPARED — **not approved for deployment.** Do not deploy, do not
reconcile production, do not enter the physical warehouse count. Stop for
deployment approval once this runbook and the production read-only validation
prerequisite (§0) are complete.

**What ships:** the M2 fix to `postInvoice` (anchor-first, fresh FIFO recompute per
retry) + the conservative op-cap estimate + posting instrumentation. Merged on
`develop`; promoted to `main`/production only via this runbook.

**What does NOT ship:** the two-sided POST-STATE transactional assertion (gated to
post-recount, [#4]) and any production reconciliation.

---

## Pre-flight code review — confirmed

| # | Check | Result |
|---|---|---|
| 1 | **Op-count formula conservative** for the actual reads+writes | ✅ `2 + 4·I + 2·P + 3·A + dirtyEstimate.size` ≥ worst case (reads `1+I+P+A`; writes `P + C + 2I + D + 1` with `C ≤ I+A`, `D ≤ A`). `getDocs` is non-transactional (S4), not counted. |
| 2 | **Metrics emitted exactly once** per final success/failure; `retry_count` reflects all internal attempts | ✅ Two emit sites only — success path (after the ledger step) and the `catch`. `txn_attempts` increments at every transaction-callback attempt; `retry_count = txn_attempts − 1`. Pre-flight validation errors and the idempotent already-posted early-return intentionally do **not** emit (no transaction ran). |
| 3 | **Metrics can never fail a post** | ✅ `emitPostingMetrics` wraps `JSON.stringify` + `console.info` in its own try/catch and never throws; `nowMs()` cannot throw. |

---

## §0 — Deployment prerequisite (BLOCKING): production read-only validation ([#3])

**Deployment MUST NOT begin until all of the following are proven in production
(`wholesale-b4ff9`):**

- [ ] The `inventory-validator` service account exists and is **read-only** on the
      validated collections + write **only** on `inventory_validation_runs`.
      Prove it: attempt a write to `stock_lots`/`products`/`inventory_transactions`
      with that identity and confirm it is DENIED (permission-verified, not just
      code-verified).
- [ ] Repo secret `INVENTORY_VALIDATOR_SA_KEY` is set (prod SA JSON).
- [ ] **Manual read-only run works against prod:**
      `GOOGLE_APPLICATION_CREDENTIALS=… npm run validate:run -- --project prod --mode full`
      → connects, reads, and persists an `inventory_validation_runs` record; the
      cross-project guard passes.
- [ ] **Nightly path works:** trigger `.github/workflows/nightly-validation.yml`
      via `workflow_dispatch` → green run + a persisted run doc.

The fixture run proves validator *logic* only, never production connectivity. Until
§0 is green, the deployment's before/after full validations cannot be trusted.

### §0 tooling + the read-only-vs-persist decision

- **Prove read-only:** with the validator SA creds,
  `npm run prove:validator-readonly -- --project prod`
  ([`scripts/inventory/prove-validator-readonly.mjs`]). It confirms read works and
  that create/update/delete on every protected collection (products, stock_lots,
  lot_consumptions, inventory_transactions[_lines], inventory_discards[_lots],
  invoice_returns, return_lot_restorations) are DENIED.
- **Decision — the validator persists run records, but IAM is database-scoped**
  (§13): a single admin-SDK identity cannot both (a) have ALL stock/ledger writes
  denied by IAM and (b) create its own `inventory_validation_runs` record. Choose:
  - **Option A — strict read-only** (`datastore.entities.get` + `list` only): every
    write is denied (cleanest proof), but `validate:run` cannot persist. Use
    `validate:inventory --project prod` (read-only report) for the before/after
    validations and capture the run summary into `M2_DEPLOYMENT_RECORD.md` by hand.
    Nightly persistence is deferred to a scoped append-only writer.
  - **Option B — read + append** (`get` + `list` + `create`, NO `update`/`delete`):
    `validate:run` persists run records; UPDATE/DELETE on stock/ledger are denied
    (the real damage vectors), but CREATE is not IAM-denied — collection scoping is
    then code-level + audit-log verified (§13). The proof script reports this.
  - **Recommended:** Option B for the deployment (you need persisted run history for
    the 7-day observation), documenting the code+audit mitigation, with an
    audit-log alert on any create by the validator SA outside
    `inventory_validation_runs`.
- **Record everything** in [`M2_DEPLOYMENT_RECORD.md`]: SA email, IAM role, the
  proof result, the pre-deployment run_id, deployment timestamp, deployed SHA,
  baseline issue identities, project id (`wholesale-b4ff9`), schema_version (`1`).

---

## §1 — Deployment sequence

**Indexes first (already confirmed N/A):** `postInvoice`'s lot query
(`fetchStockLotsForProduct`) is a single-field equality query — **no composite
index to deploy**. No index step required.

1. **T−0: full read-only validation (baseline).** `validate:run --project prod --mode full`.
   Record the `run_id`. This is the **legacy baseline**: every issue here is
   pre-existing, dated by `first_seen_at`. If it does not complete cleanly (the
   validator can't connect / manifest incomplete), **do not deploy**.
2. **Deploy during a quiet trading period.** Promote `develop → main`, deploy the
   build. No feature flag (a flag would maintain both buggy and fixed paths). Ship
   M2 **alone** — no other inventory changes in the same release.
3. **T+15 min: incremental validation.** `validate:run --project prod --mode incremental`.
   Confirm it discovers the products touched since T−0 and reports **no new**
   P1/L6 (see §2). Watch the first posting-metrics events land.
4. **T+24 h: full validation.** `validate:run --project prod --mode full`. Compare
   against the T−0 baseline by `first_seen_at`: **zero new P1/L6**.
5. **7-day observation window.** Nightly full validation each night must be green
   (or explained). Watch the metrics dashboard daily: `retry_count`, p95
   `total_ms`, post failure rate. No new P1/L6 for 7 consecutive days is the M2→M3
   gate.

---

## §2 — Legacy vs. new corruption (`first_seen_at`)

The validator carries `first_seen_at` forward across runs (M1). Use it as the sole
discriminator:

- **Legacy** = an issue whose `first_seen_at` ≤ the T−0 baseline run time. These are
  pre-existing (untrusted-history drift) and are addressed by the future physical
  recount — **not** a rollback trigger.
- **New** = an issue whose `first_seen_at` > the deployment time. A new P1 or L6 is
  post-deployment corruption and **is** a rollback trigger (§3).

Never compare raw issue counts between runs — compare **new** issues only. A rising
total with no new `first_seen_at` is legacy drift resurfacing in scope, not regression.

---

## §3 — Rollback triggers (any one ⇒ roll back)

- **Any newly created P1 or L6** (new `first_seen_at`, per §2) — the fix failed to
  prevent drift.
- **Abnormal invoice-post failure rate** — post failures above the pre-deploy
  baseline.
- **Unexpected retry rate** — `retry_count > 0` on **> 5%** of posts (sustained), or
  any sharp rise vs. baseline (`retry_count` is the direct anchor-contention signal).
- **Transaction resource-limit errors** — any "transaction too big / 500 ops /
  DEADLINE_EXCEEDED" surfacing from posting (indicates the op-cap estimate or a
  large-invoice case is wrong).
- **Significant posting-latency regression** — p95 `total_ms` materially above
  baseline (e.g. > 2× the pre-deploy p95, or an absolute p95 > 10 s).

Escalation is immediate for a new CRITICAL; the others are judged over a short
sustained window (not a single outlier).

---

## §4 — Rollback procedure

M2 involves **no data migration**, so rollback is code-only and complete.

1. **Revert the code:** `git revert <M2 merge commit(s)>` on `main` (the `postInvoice`
   fix + op-estimate + instrumentation), or redeploy the last-known-good build.
   Redeploy. `postInvoice` returns to its prior behaviour.
2. **Confirm** posts resume on the reverted path; run an incremental validation to
   confirm no *new* issues from the revert itself.
3. **Leave all posted invoices in place.** See below.

**Rollback does NOT undo legitimate invoices already posted.** Every invoice posted
by the M2 code committed atomically with correct stock/lot/consumption/ledger state
(that is exactly what C1–C11 prove). Reverting only changes the *code path for future
posts*; it touches **no** existing documents. There is no compensating write, no
un-posting, no stock rewind. Data written by the fixed path stays correct after
rollback — which is precisely why a code revert is safe and sufficient.

---

## §5 — Constraints (non-negotiable)

- **No production reconciliation** and **no physical warehouse count** as part of
  this deployment. Pre-existing drift is left to the future recount ([#4]); M2 only
  stops *new* drift.
- **No two-sided transactional assertion** in this release (gated, [#4]).
- Ship M2 alone; observe 7 days before M3.

---

## Sign-off checklist (all required before deployment approval)

- [ ] §0 production read-only validation prerequisite green ([#3])
- [ ] PR #5 merged to `develop`; `develop` full test suite green in CI
- [ ] Baseline (T−0) full validation completes cleanly; `run_id` recorded
- [ ] Quiet-period window scheduled; on-call aware
- [ ] Metrics dashboard/log query ready for `[postingMetrics]` (retry_count, p95)
- [ ] Rollback commit(s) identified; revert rehearsed on a staging/preview build
