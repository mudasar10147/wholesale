# M2 deployment record

Immutable audit of the M2 controlled deployment. Fill in at each step; preserve
this file (do not overwrite past deployments — append a new dated section per
attempt). Referenced by `M2_DEPLOYMENT_RUNBOOK.md`.

## Fixed facts (known now)

| Field | Value |
|---|---|
| Validator project id (prod) | `wholesale-b4ff9` |
| Validator schema_version | `1` (`lib/inventory/validationRun.ts` `SCHEMA_VERSION`) |
| Candidate deploy SHA (develop HEAD) | `bf36344c036b001c891a4cef89a4cc6589082a7b` — **re-capture at deploy time** |

## Issue #3 prerequisite proof (§0)

| Field | Value |
|---|---|
| Validator SA email | `inventory-validator@wholesale-b4ff9.iam.gserviceaccount.com` |
| IAM role granted | `roles/datastore.viewer` (`datastore.entities.get` + `list` only — **strict read-only**, no create/update/delete) |
| `prove:validator-readonly` result | ☑ PASS (2026-07-23 — reads work; create/update/delete on all 10 protected collections DENIED; nothing written). Probe uses a non-reserved id so writes reach the IAM layer. |
| Manual read-only validation | ☑ ran 2026-07-23T15:37:10.987Z — `validate:inventory --project prod`, no Firestore write. Legacy baseline: 215 products / 481 lots; Verdict FAIL (pre-existing untrusted-history drift — the legacy set); report `reports/inventory-validation-2026-07-23T15-37-10-987Z.json`. |
| Report artifact retained? | Local report retained (above). CI-retained artifact: **deferred to deploy** — `nightly-validation.yml` is not on the default branch (main) yet, so `workflow_dispatch` is unavailable until the develop→main merge (decision 2026-07-23, "keep main as-is"). |
| Nightly workflow_dispatch run | **Ready, executes at deploy.** The workflow reaches main at the M2 merge; dispatch it immediately as the runbook §1 T−0/T+15 validation → green + retained artifact. Repo secret `INVENTORY_VALIDATOR_SA_KEY` set: ☐. |

## Pre-deployment baseline (T−0, §1.1)

| Field | Value |
|---|---|
| **Pre-deployment validation run_id** | `__________________________________` |
| Baseline `as_of` (watermark) | `__________________________________` |
| Verdict | `______` |
| summary.critical / error / warning | `___ / ___ / ___` |
| **Baseline issue identities** (invariant_id · entity_type · entity_id · first_seen_at) | see attached export / list below |

> Baseline issue identities are the legacy set. Every one of these is pre-existing;
> a post-deploy issue is "new" ONLY if its identity is absent here AND its
> `first_seen_at` is after the deployment timestamp (runbook §2). Export them:
> the persisted `inventory_validation_runs/<run_id>.issues[]` array is the record.

```
# paste baseline issue identities here (invariant_id | entity_type:entity_id | first_seen_at)
```

## Deployment (§1.2)

| Field | Value |
|---|---|
| **Deployment timestamp (UTC)** | `__________________________________` |
| **Deployed commit SHA** | `__________________________________` (the exact main/prod build) |
| Deployed by | `__________________________________` |
| Quiet-period window | `__________________________________` |

## Post-deployment checkpoints

| Checkpoint | run_id | new P1/L6 (by first_seen_at) | retry_rate | p95 total_ms | notes |
|---|---|---|---|---|---|
| T+15 min (incremental) | | | | | |
| T+24 h (full) | | | | | |
| Day 2 nightly | | | | | |
| Day 3 nightly | | | | | |
| Day 4 nightly | | | | | |
| Day 5 nightly | | | | | |
| Day 6 nightly | | | | | |
| Day 7 nightly (gate) | | | | | |

## Outcome

- ☐ 7-day observation clean (no new P1/L6; retry < 5%; p95 within target) → **M2→M3 gate met**
- ☐ Rollback triggered — trigger: `__________`; revert SHA: `__________`; posted invoices preserved (☐ confirmed)
