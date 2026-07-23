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

- [x] The `inventory-validator` service account exists and is **strictly read-only**
      (`roles/datastore.viewer` — get + list only; no create/update/delete anywhere).
      Permission-verified (not just code-verified): create/update/delete on every
      protected collection returns `PERMISSION_DENIED`.
      *(2026-07-23 — `inventory-validator@wholesale-b4ff9.iam.gserviceaccount.com`.)*
- [x] **Strict read-only proof passes:** `npm run prove:validator-readonly -- --project prod`
      → reads work; create/update/delete on all 10 protected collections DENIED;
      nothing written. *(2026-07-23 — PASS.)*
- [x] **Manual read-only validation works against prod:**
      `GOOGLE_APPLICATION_CREDENTIALS=… npm run validate:inventory -- --project prod`
      → connected, read 215 products / 481 lots, produced a report (NO Firestore
      write); cross-project guard passed. *(2026-07-23 — legacy baseline captured.)*
- [ ] Repo secret `INVENTORY_VALIDATOR_SA_KEY` is set (prod SA JSON) — set before deploy.
- [ ] **CI validation path — executes AT deploy (deferred by decision).**
      `nightly-validation.yml` is not on the default branch (main) yet, so
      `workflow_dispatch` is unavailable until the develop→main merge. At the M2
      merge the workflow reaches main; dispatch it immediately (this IS the §1 T−0
      validation) → green run that **uploads the report as a protected, retained
      artifact**. The read-only credential + validation logic + report generation are
      already proven locally against prod (rows above); CI adds only the runner
      environment and artifact retention.

The fixture run proves validator *logic* only; the rows above prove production
connectivity with the real read-only credential. Firestore run-persistence is NOT
required (§0 — strictly read-only; history retained as the CI artifact).

### §0 — the validator identity is STRICTLY READ-ONLY

**Decision (fixed): the production validator is strictly read-only.** It must NOT
be granted general Firestore write access. Admin-SDK access is governed by IAM,
which is **database-scoped** and receives no collection-level protection from
Firestore rules (§13) — so a "read + append" role would give the validator broader
production write capability than intended. We do not do that.

- **IAM role:** `datastore.entities.get` + `datastore.entities.list` ONLY. No
  `create`, `update`, or `delete` — anywhere.
- **Prove it:** with the validator SA creds,
  `npm run prove:validator-readonly -- --project prod`
  ([`scripts/inventory/prove-validator-readonly.mjs`]) — reads work; create/update/
  delete on every protected collection are DENIED; **nothing is written** (no
  cleanup needed; update/delete probe a non-existent id).
- **Run persistence for the M2 gate = a protected CI artifact, NOT Firestore.**
  The read-only validator cannot (and must not) write `inventory_validation_runs`.
  For the deployment gate, run `validate:inventory --project prod` (read-only,
  emits a report file) inside the workflow and **upload the report JSON as a
  retained GitHub Actions artifact**. Record its run id, timestamp, commit SHA,
  project id (`wholesale-b4ff9`), schema_version (`1`) and **issue identities**
  (invariant_id + entity) in `M2_DEPLOYMENT_RECORD.md`. Legacy-vs-new is then a
  comparison of issue identities across the retained artifacts (§2).
- **Do NOT block M2 on Firestore persistence.** Firestore run-history is
  temporarily unavailable by design; the read-only prod run + artifact retention
  are sufficient for the M2 safety gate.

### §0.4 — Future validation-run persistence (separate trusted writer; NOT this deployment)

Persisted, queryable run history returns via a **separate, minimal ingestion
endpoint** — never by widening the validator's IAM. Design constraints:

- Its own identity may write ONLY `inventory_validation_runs`; it has NO stock/
  ledger access. Its **public interface** accepts only a validation-run submission —
  it cannot be used to mutate inventory.
- Accepts ONLY the **redacted validation-run schema** (invariant_id, severity,
  entity_type/id, first_seen_at, counts — no cost/price/customer/monetary, §14).
- Performs **strict schema + size validation** (reject unknown fields; cap issues
  at the §14 limit; reject payloads over the size cap) before writing.
- **Append-only:** it may create a new run document (deterministic/served id) and
  never update or delete an existing one.
- The read-only validator POSTs its redacted report to this endpoint; the endpoint
  validates and appends. `first_seen_at` carry-forward resumes once this exists.

This is tracked separately and is **not** a prerequisite for the M2 deployment.

---

## §1 — Deployment sequence

**Indexes first (already confirmed N/A):** `postInvoice`'s lot query
(`fetchStockLotsForProduct`) is a single-field equality query — **no composite
index to deploy**. No index step required.

All validations run **read-only** (`validate:inventory --project prod`) and their
report JSON is retained as a protected CI artifact (§0). "run id" below = the CI
run / artifact id recorded in `M2_DEPLOYMENT_RECORD.md`.

1. **T−0: full read-only validation (baseline).** Run `validate:inventory --project prod`
   in the workflow; retain the report artifact. This is the **legacy baseline** —
   record its full **issue identities** (invariant_id + entity). Every issue here is
   pre-existing. If it does not complete cleanly (validator can't connect / partial),
   **do not deploy**.
2. **Deploy during a quiet trading period.** Promote `develop → main`, deploy the
   build. No feature flag (a flag would maintain both buggy and fixed paths). Ship
   M2 **alone** — no other inventory changes in the same release.
3. **T+15 min: read-only validation.** Re-run + retain the artifact. Diff its issue
   identities against the T−0 baseline (§2): **no new P1/L6**. Watch the first
   `[postingMetrics]` events.
4. **T+24 h: read-only validation.** Re-run + retain. Diff against baseline: **zero
   new P1/L6**.
5. **7-day observation window.** Nightly read-only validation each night must be
   green (or explained) with no new P1/L6 identity vs baseline. Watch the metrics
   daily: `retry_count`, p95 `total_ms`, post failure rate. No new P1/L6 for 7
   consecutive days is the M2→M3 gate.

---

## §2 — Legacy vs. new corruption (artifact identity diff)

Firestore `first_seen_at` carry-forward is unavailable during M2 (the validator is
strictly read-only and does not persist). The equivalent, using retained artifacts:

- **Legacy** = an issue identity (`invariant_id` + entity) present in the **T−0
  baseline artifact**. Pre-existing (untrusted-history drift), addressed by the
  future physical recount — **not** a rollback trigger.
- **New** = an issue identity in a post-deploy artifact that is **absent from the
  T−0 baseline**. A new P1 or L6 identity is post-deployment corruption and **is** a
  rollback trigger (§3).

Compare **identities**, never raw counts. Once the §0.4 ingestion endpoint exists,
`first_seen_at` resumes and supersedes the manual artifact diff. (Original
`first_seen_at` note retained below for when persistence returns.)

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
