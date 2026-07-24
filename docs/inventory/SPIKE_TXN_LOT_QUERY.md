# M1.5-S — Transactional lot-query feasibility spike

**Status:** Complete. **Recommendation: GO on Option A**, with anchor-first read
ordering as a hard requirement.
**Gates:** M2 (PHASE1_INTEGRITY_ARCHITECTURE_V2.md §19 M1.5-S, §2.2b, §11.2).
**Evidence:** `test/integration/spikeTxnLotQuery.test.mjs` (`npm run test:spike`),
run against the Firestore emulator with the real Firebase Web SDK (v12.11.0) — the
production client. Interleavings are forced with deterministic barriers, which is
strictly stronger than sampling N random iterations: the exact race is reproduced
every run, not hoped for.

## Why the spike exists

The client Web SDK has **no `transaction.get(query)` overload** [C, §2.2b], so M2's
freshness fix cannot be a transactional query. It rests on **Option A**: a
non-transactional `getDocs(activeLots)` *inside* the transaction callback, plus
`tx.get` on each lot written, plus the product document as the concurrency anchor.
Three assumptions in that chain were unverified and all load-bearing.

## Findings

| # | Assumption | Result | Evidence |
|---|---|---|---|
| **S1** | `getDocs` inside a retried callback returns FRESH data per attempt (not a pinned snapshot) | **HOLDS** | Attempt 1 saw 1 lot; a lot was created concurrently; the forced retry's `getDocs` saw **2 lots**. |
| **S2b (anchor-first)** | `tx.get(product)` → `getDocs` → concurrent new lot → commit **aborts and retries**, and the retry sees the new lot | **HOLDS (safe)** | The transaction retried; the retry observed the new lot. The anchor covered the query. |
| **S2b (query-first)** | `getDocs` → concurrent new lot → `tx.get(product)` → commit **corrupts** (commits stale) | **HOLDS (corrupts)** | The transaction committed **without retry** against a stale 1-lot view — the new lot was missed. |
| **S2** | The product anchor aborts on concurrent new-lot creation | **HOLDS** | Same mechanism as S2b anchor-first: the concurrent stock-in co-writes the product (§11.1), invalidating the anchor precondition. |

**The query-first corruption is the load-bearing negative result.** Had it *not*
corrupted, our model of Firestore preconditions would be wrong and every conclusion
resting on the anchor would need re-examination. It corrupts exactly as §11.2.1
predicts: a precondition acquired *after* a competing write cannot protect a read
issued *before* it. Testing only the safe ordering would have proven nothing.

## Consequence for M2

- **GO on Option A.** Freshness is achievable without a transactional query.
- **Read ordering is mandatory, not stylistic.** Every mutation path must read the
  product anchor with `tx.get` **before** the non-transactional `getDocs(activeLots)`.
  A lint/review rule should enforce anchor-first (§11.2.1).
- The residual window (a new lot created between the query and commit) is closed by
  the anchor: creating a lot co-writes the product, which aborts our transaction and
  forces a retry that re-queries. Proven by S2b anchor-first.

## S3 — op-cost formula (replacing the incorrect `items × 3` estimate)

`items × 3` [C: current estimate] is wrong — cost is driven by how many **lots** a
post spans, not by item count. For an invoice of `I` items spanning `L` distinct
lots total:

| Op | Count | In the 500-op transaction budget? |
|---|---|---|
| `getDocs(activeLots)` | reads `N` active lots | **No** — non-transactional (see S4) |
| `tx.get(product)` (anchor) | 1 | Yes |
| `tx.get(lot)` per written lot | `L` | Yes |
| lot writes | `L` | Yes |
| product write | 1 | Yes |
| ledger outbox (source status) | ~1 | Yes |

**In-transaction ops ≈ `2L + 3`** (plus `I` if per-item consumption docs are written
in-transaction). The binding variable is `L` (lots spanned), so the real bound is a
function of FIFO fragmentation, and an invoice-size limit should be expressed in
*lots spanned*, not line count.

## S4 — does `getDocs` count toward the 500-op transaction budget?

**No — by construction, corroborated by S1.** `getDocs` is a normal, non-transactional
read issued from within the callback; it is not part of the transaction's read/write
set (which is why it is *not* covered by a precondition and why the anchor is needed).
It therefore does not consume the 500-op transaction budget. The `N`-lot query cost is
a separate read charge, not a transaction-size constraint.

## Verdict

**GO on Option A for M2**, conditional on:
1. anchor-first ordering, enforced;
2. bounding invoice size by lots-spanned, using the `2L + 3` formula;
3. the M2 concurrency suite (C1, C2, C9, C11) reproducing these races against the
   real `postInvoice` before the fix is accepted.

No production code was written or run for this spike.
