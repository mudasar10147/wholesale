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

## Issue #3 prerequisite proof (fill during §0)

| Field | Value |
|---|---|
| Validator SA email | `__________________________________` |
| IAM role granted | `datastore.entities.get` + `list` only (**strict read-only**, no create/update/delete) |
| `prove:validator-readonly` result | ☐ PASS (reads work; create/update/delete on all protected collections DENIED; nothing written) |
| Manual read-only validation | ☐ ran (`validate:inventory --project prod`), no Firestore write |
| Report artifact retained? | ☐ yes — CI run/artifact: `__________________________` |
| Nightly workflow_dispatch run | ☐ green — URL: `__________________________`; artifact retained ☐ |

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
