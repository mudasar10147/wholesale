# Phase 1 — Inventory Integrity Architecture (Revision 2, implementation-ready)

**Status:** Final — for approval before implementation
**Date:** 2026-07-20
**Supersedes:** `PHASE1_INTEGRITY_ARCHITECTURE.md` (revision 1)
**Scope:** Inventory integrity only.

**Evidence convention used throughout:**

| Tag | Meaning |
|---|---|
| **[C]** | **Confirmed** — verified by reading the code at the cited line during this revision |
| **[I]** | **Inference** — reasoned from confirmed facts; not directly observed |
| **[R]** | **Recommendation** — a design choice, not a finding |
| **[D]** | **Deferred** — real, out of Phase 1 scope, with a stated destination |

---

## 1. Executive summary

Revision 1 was approved in direction. This revision applies ten corrections, of which two changed the technical design and one changed a factual claim.

**What changed as a result of re-inspecting the repository:**

1. **`ProductDoc` has no `updated_at` field, and not one of the six product stock-write sites writes a timestamp. [C]** This makes the obvious design for incremental validation — "query products modified since the last run" — **impossible**. Incremental validation must derive its working set from the append-only movement records instead. §9 sets this out. This is the single most important new finding in this revision.
2. **`StockLotDoc.updated_at` is a required field and all six lot-mutation sites write it. [C]** Lots *are* a reliable change feed. Products are not. The asymmetry drives the whole incremental design.
3. **Correction to revision 1:** I stated that the consumption-chain invariant (L6) was not implemented. **That was wrong.** `validateInventory.ts:180` already emits `LOT_BALANCE_VS_CONSUMPTIONS`, and the validator already carries ~14 issue codes. [C] Milestone 1 is therefore **extend, restructure and test an existing validator**, not build one from scratch. This materially lowers M1's risk and cost.

**What changed by instruction:**

4. The mutation-gateway refactor is split: primitives first (used only in the defective posting path), then one-path-at-a-time migration. The all-at-once rewrite is abandoned.
5. Basic CI moves to Milestone 1.5, before any mutation-path change.
6. Validation gains full and incremental modes.
7. The production validator gets a dedicated read-only identity, separate from repair.
8. Production reports never enter Git.
9. Deployment gating becomes risk-based rather than "full scan before every deploy".
10. Repair requires a declared evidence authority, not free text.

**The Phase 1 goal, restated honestly.** Making inventory inconsistency *structurally impossible* is not achievable while writes originate in the browser — Firestore rules evaluate one document at a time and can never express a cross-document aggregate. [C, by construction] The achievable and correct target is:

> Every **known** corruption mechanism is eliminated at its source. Every **unknown** corruption is detected within one nightly cycle, attributed to a source operation, and repaired only through an audited path that cannot itself introduce drift.

Where this document says *guarantee* it means the first clause; *detect* means the second. The distinction is load-bearing: conflating them is precisely how a validation control came to be documented in three places, surfaced in the UI, and never once executed.

---

## 2. Confirmed findings from the current code

Every item verified by reading the cited line during this revision.

### 2.1 The concurrency anchor already exists

All seven live stock-mutating paths read their product document inside the transaction and also write it. **[C]**

| Path | Reads product in txn | Writes product |
|---|---|---|
| `postInvoice` | yes — [invoices.ts:844](../../lib/firestore/invoices.ts#L844) | [:887](../../lib/firestore/invoices.ts#L887) |
| `voidInvoice` | yes | [:1410](../../lib/firestore/invoices.ts#L1410) |
| `stockIn` | yes — [inventory.ts:158](../../lib/firestore/inventory.ts#L158) | [:109](../../lib/firestore/inventory.ts#L109) `increment` |
| `stockOut` | yes — [inventory.ts:~285](../../lib/firestore/inventory.ts#L285) | [:332](../../lib/firestore/inventory.ts#L332) `increment` |
| `postInventoryDiscard` | yes — [inventoryDiscards.ts:171](../../lib/firestore/inventoryDiscards.ts#L171) | [:258](../../lib/firestore/inventoryDiscards.ts#L258) `increment` |
| `postReturn` | yes | [invoiceReturns.ts:825](../../lib/firestore/invoiceReturns.ts#L825) |
| `postStockAdjustment` | yes | [stockAdjustment.ts:90](../../lib/inventory/stockAdjustment.ts#L90), [:158](../../lib/inventory/stockAdjustment.ts#L158) |

In Firestore, `tx.get()` places an optimistic-concurrency precondition on the document; a write alone does not. Because every lot mutation co-writes its product **and** every path reads that product first, the product document already serialises the whole lot set of that product. [I, from documented Firestore semantics] Two concurrent operations on the same product cannot both commit.

**Three of these write the product with `increment()`, which is a blind field transform carrying no precondition of its own. [C]** The safety comes entirely from the separate `tx.get`. That is fragile — the necessary read is not visibly connected to the write — and it is why §11 makes the anchor structural rather than incidental.

### 2.2 The leading hypothesis for the historical drift — H1, NOT yet established

**This section is deliberately labelled a hypothesis. It remains one until C1 proves it.** The mechanism below is the most plausible explanation available, but the plan must not treat it as settled, because acting on a wrong root cause would leave the real defect in place while everyone believes it was fixed.

**What is confirmed [C]:**

- `postInvoice` fetches lots and runs its FIFO dirty-estimate **before** `runTransaction` ([invoices.ts:708–770](../../lib/firestore/invoices.ts#L708)).
- The transaction callback closes over that snapshot ([:855](../../lib/firestore/invoices.ts#L855)).
- Only lots the pre-computed estimate flagged are re-read via `tx.get` ([:857–864](../../lib/firestore/invoices.ts#L857)); the rest are used from the stale snapshot.
- The estimate lives outside the callback and is never recomputed, so a Firestore-initiated retry replays the same lot data.
- The production signature is 43 products / 234 units, **every one** in the direction `lotSum > book`.

**Hypothesis H1 [I]:** on retry, FIFO spills into a lot that the stale estimate did not flag; that lot is written from stale data, silently erasing a concurrent decrement and leaving phantom lot quantity. This produces exactly the observed `lotSum > book` direction.

**Competing hypotheses that C1 must also discriminate against:**

| ID | Alternative mechanism | Would also produce `lotSum > book`? |
|---|---|---|
| **H2** | A void or return restored lot quantity without a matching book-stock increase | Yes |
| **H3** | A historical `syncProductStockFromLots` or manual lot edit ran before direct lot edits were blocked | Yes |
| **H4** | An interrupted multi-transaction counter-sale left a partially applied return leg | Yes |
| **H5** | The 2026-07-10 reconcile itself wrote book stock while lots continued moving | Yes |

**Falsification criteria — how we will know:**

- **H1 is supported** if C1 (two concurrent posts, same product, FIFO spilling into a second lot) reproduces drift against current code and stops reproducing after the M2 fix, with no other change.
- **H1 is insufficient** if C1 does *not* reproduce drift. In that case M2 still ships — the stale snapshot is a genuine defect regardless of whether it caused this incident — but **the incident investigation reopens**, and M0's baseline plus ledger reconciliation (G4) become the primary evidence.
- **H1 is incomplete** if C1 reproduces but M0's baseline shows drift on products with no concurrent posting in their history. That would indicate H2–H5 contribute as well.

**[R]** Until C1 runs, every document, commit message and status report should say *"leading hypothesis"* and not *"root cause"*. The cost of the discipline is a word; the cost of skipping it is a closed investigation into an open defect.

### 2.2b The client SDK cannot query inside a transaction — new in this revision, and consequential

**The Firebase Web SDK (v12.11.0, the version in use) exposes exactly one `Transaction` read overload: [C]**

```
get<AppModelType, DbModelType>(documentRef: DocumentReference<...>): Promise<DocumentSnapshot<...>>
```

**There is no `get(query: Query)` overload.** [C — verified against `node_modules/@firebase/firestore/dist/index.d.ts`] The Node **Admin** SDK does provide `transaction.get(query)`; the browser SDK does not.

**This invalidates the literal instruction "load active lots inside the transaction" as a *transactional query*.** Inside a client transaction we can only read documents whose IDs we already hold. The instruction is still achievable in substance — the lot data must be *fresh on every attempt* — but the mechanism has to change, and the options carry materially different risk:

| Option | Mechanism | Preconditions on lots | Assessment |
|---|---|---|---|
| **A** | Non-transactional `getDocs(activeLotsQuery)` **inside** the callback, then `tx.get` every lot we intend to write | Only on lots we write | **[R] Recommended.** Fresh per attempt; discovery gap covered by the product anchor |
| **B** | Denormalised `active_lot_ids[]` on the product, read with the anchor, then `tx.get` each | Yes, on all | Adds a fourth denormalised structure and a new drift class. **Rejected for Phase 1** |
| **C** | Move posting to the Admin SDK server-side, where `transaction.get(query)` exists | Yes, on all | The cleanest mechanism, but it is the deferred server migration (§5) |

Option A restores freshness (the actual defect) and relies on the product anchor to cover the window in which a *newly created* lot is invisible to the in-callback query. That reliance is sound only if the anchor property holds strictly — which is precisely why §11 makes it structural rather than incidental.

**[I]** Note that this finding is a genuine argument in favour of the eventual server-side migration: the Admin SDK offers a strictly stronger transactional primitive than the browser. It does not change the Phase 1 deferral — a rewrite during stabilisation remains the wrong order — but it should be recorded as input to the Phase 2/3 decision.

**M1.5 carries a feasibility spike (§19) to validate Option A empirically before M2 depends on it.**

### 2.3 Products have no modification timestamp — new in this revision

**`ProductDoc` ([firestore.ts:18–38](../../lib/types/firestore.ts#L18)) declares `created_at` and no `updated_at`. [C]**

None of the six product stock-write sites writes any timestamp: [invoices.ts:887](../../lib/firestore/invoices.ts#L887), [invoices.ts:1410](../../lib/firestore/invoices.ts#L1410), [invoiceReturns.ts:825](../../lib/firestore/invoiceReturns.ts#L825), [inventoryDiscards.ts:257](../../lib/firestore/inventoryDiscards.ts#L257), [stockAdjustment.ts:90](../../lib/inventory/stockAdjustment.ts#L90), [stockAdjustment.ts:158](../../lib/inventory/stockAdjustment.ts#L158). **[C]**

By contrast `StockLotDoc` ([firestore.ts:446–464](../../lib/types/firestore.ts#L446)) declares `updated_at` as **required**, and all six lot-update sites write `updated_at: serverTimestamp()`. **[C]**

**Consequence:** "find products changed since the last run" is not answerable from the products collection. §9 derives the working set from movement records instead. **[R]** I recommend *against* adding `products.updated_at` in Phase 1 — it would require touching all six write sites (the exact code we are trying to stabilise) and would still be a mutable field trusted for a correctness decision. Movement-derived discovery is both safer and more honest.

### 2.4 Correction to revision 1 — the validator is further along than stated

`lib/inventory/validateInventory.ts` already emits ~14 issue codes including `STOCK_LOT_MISMATCH`, `LOT_BALANCE_VS_CONSUMPTIONS` (the L6 chain), `LOT_QTY_EXCEEDS_IN`, `COGS_MISMATCH`, `DUPLICATE_LEDGER_BY_SOURCE` and `MISSING_LEDGER_FOR_POSTED_DOC`. **[C]**

Revision 1 said the consumption chain was unimplemented. That was wrong. M1 is an **extension and restructure**, not a build. The real gaps are: no register, no severity model, no modes, no attribution, ~20% test coverage, and no schedule.

### 2.5 Dead and dangerous write paths

| Location | What it does | Reachable? |
|---|---|---|
| [sales.ts:57](../../lib/firestore/sales.ts#L57) | `stock_quantity: increment(-quantity)`, **no lot write** | No UI caller found **[C]** |
| [walkInSessions.ts:215,327](../../lib/firestore/walkInSessions.ts#L215) | Same, both directions, **no lot write** | No UI caller found **[C]** |
| [lotAdmin.ts:158](../../lib/firestore/lotAdmin.ts#L158), [:234](../../lib/firestore/lotAdmin.ts#L234) | `stock_quantity: sum` forced from lot total, no ledger, no reason, no uid | Only `convertOpeningBalanceLotToStockIn` is imported **[C]** |

The first two break P1 by construction on every call. The third is precisely what `MIGRATION_RUNBOOK.md:87` forbids. All are compiled and one import away from being live. **[C]**

### 2.6 Other confirmed defects

| # | Finding | Location |
|---|---|---|
| 1 | Invoice-path invariant is one-sided (`book > lotTotal` only) | [invoices.ts:95](../../lib/firestore/invoices.ts#L95) **[C]** |
| 2 | Two adjustment implementations with different audit guarantees; the main UI button uses the weaker one | [StockAdjustModal.tsx:58](../../app/components/inventory/StockAdjustModal.tsx#L58) **[C]** |
| 3 | Adjustment ledger writes operator-typed `unit_cost`, not FIFO cost | [stockAdjustment.ts:172](../../lib/inventory/stockAdjustment.ts#L172) **[C]** |
| 4 | Discard has no contention retry loop — the only path without one | [inventoryDiscards.ts:167](../../lib/firestore/inventoryDiscards.ts#L167) **[C]** |
| 5 | Sale/return/discard ledger lines carry `unit_cost: 0` | [invoices.ts:106](../../lib/firestore/invoices.ts#L106) **[C]** |
| 6 | `finalizeCounterSaleReturns` **assigns** `paid_amount` post-commit, outside a transaction | [counterSaleReturns.ts:193](../../lib/firestore/counterSaleReturns.ts#L193) **[C]** |
| 7 | Op estimate budgets one consumption per line; true cost is `lots_spanned + 2` | [invoices.ts:776](../../lib/firestore/invoices.ts#L776) **[C]** |
| 8 | `firebase.json` has **no emulators block** | [firebase.json](../../firebase.json) **[C]** |
| 9 | `test:rules` covers only `social.rules`; no aggregate `npm test`; no CI | package.json **[C]** |
| 10 | `products` rule is `allow read: if true` | [firestore.rules:934](../../firestore.rules#L934) **[C]** |
| 11 | Rules cap `paid_amount <= posted_total_amount`, not the effective (post-returns) total | [firestore.rules:407](../../firestore.rules#L407) **[C]** |
| 12 | All four rollout flags are `NEXT_PUBLIC_*` → build-time inlined; runbook claims env override works | config.ts **[C]** |
| 13 | `nightly-validate.mjs` sets `INVENTORY_VALIDATION_MODE` which nothing reads | scripts **[C]** |

### 2.7 BLOCKING PREREQUISITE — the ledger `set`-then-`update` question

[inventoryTransactionService.ts:99](../../lib/inventory/inventoryTransactionService.ts#L99) performs `tx.set(txnRef, header)` then `tx.update(txnRef, { item_ids })` on the same document in one commit, against a collection ruled `allow update, delete: if false` ([firestore.rules:1006](../../firestore.rules#L1006)). **[C on the code; UNVERIFIED on the rules outcome]**

Whether Firestore evaluates the pair as a single create or as create-then-update determines whether **every ledger write is currently failing** — which would present exactly as "stock moved, ledger missing". There is no emulator test covering inventory rules **[C]**, so this cannot be settled statically.

**This is now a hard blocking prerequisite, not merely an M1.5 acceptance item:**

> **No ledger-related refactor may begin — in any milestone — until this question is answered by an emulator test.** That includes the M5 dispatcher, the ledger `unit_cost` work, `repairDiscardLedger`, and the `item_ids` fold itself.

The reasoning is that the answer changes what the work *is*. If the pattern currently fails, we are not improving a working ledger — we are restoring a broken one, the historical ledger has gaps that G1/G4 will surface en masse, and the M0 baseline must be re-read in that light. Building a dispatcher on top of an unanswered question risks constructing elaborate delivery machinery for writes that are being rejected.

The check itself is ~30 minutes once the emulator harness exists (M1.5). The fix — fold `item_ids` into the initial `set` — is trivial in either outcome. **The asymmetry between the cost of asking and the cost of assuming is why this is a gate.**

**Escalation:** if the pattern is confirmed to fail, stop the milestone sequence, ship the `item_ids` fold as a standalone hotfix, re-run the M0 baseline, and re-plan M5 around ledger backfill rather than dispatch reliability.

---

## 3. Assumptions

Stated so they can be challenged rather than silently relied upon.

| # | Assumption | Basis | If wrong |
|---|---|---|---|
| A1 | Firestore `tx.get` places a precondition; a blind write does not | Documented semantics | The anchor model collapses; M2 must read every active lot via `tx.get` |
| A2 | All operators are trusted employees; the threat is accident, not malice | Business context | Server-side enforcement moves into Phase 1 |
| A3 | Products rarely exceed a few hundred lots | Not measured — **verify in M0** | Active-lot querying may still be large; bound it harder |
| A4 | Daily mutation volume is small enough that nightly full validation completes in minutes | Not measured — **verify in M0** | Full validation becomes weekly; incremental carries more weight |
| A5 | The 2026-07-10 reconcile left no residual drift | Unverified — **M0 baseline settles this** | M1's two-sided assertion could block trading |
| A6 | `sales.ts` / `walkInSessions.ts` are genuinely unreachable | Grep found no callers **[C]** | Deleting them breaks a live path — mitigated by typecheck + build + smoke |
| A7 | Counter-sale volume is low | Not measured — **verify in M0** | The multi-transaction exchange gap needs restructuring sooner |

---

## 4. Scope

**In scope:** the invariant register; a read-only validator with full and incremental modes; the two-sided invariant; the `postInvoice` stale-snapshot fix; correcting the adjustment and discard paths; shared mutation primitives with gradual migration; ledger dispatch reliability; audited repair; CI and risk-based deployment gates; performance instrumentation; minimum cash-integrity rules.

**Boundary rule:** if a change does not make an existing number more correct, or make an incorrect number detectable, it is not Phase 1.

---

## 5. Explicit non-goals

| Non-goal | Why | Destination |
|---|---|---|
| Server-side enforcement of stock writes | Would not have prevented the actual bug — a logic error moves with the code. Buys authority, not correctness. Large rewrite during stabilisation. | Phase 2/3 **[D]** |
| Stock reservations on drafts | Not an integrity defect; posting fails safe. Adds a fourth denormalised quantity and a new drift class. | Phase 3 **[D]** |
| `voidReturn` | Correct diagnosis, but a **new write path** — the thing Phase 1 must not add. Detect via R2/R3 meanwhile. | Phase 2 **[D]** |
| Reversing `sales` rows on void | Reporting-semantics change touching every consumer. | Phase 2 **[D]** |
| Gapless ledger sequence numbers | Ledger is already append-only with deterministic IDs; a global counter adds a write hotspot to re-prove a stronger guarantee. Fix the random-suffix collision risk with ULID instead. | Rejected **[R]** |
| Reading every historical lot in the transaction | Does not scale (300 lots × 20 products = 6,000 reads vs a 500-op cap) and buys nothing over the anchor. | Rejected **[R]** |
| Multi-warehouse, purchase returns, stock take, barcode, master-data fields, reporting, CSV export | Real needs; none makes an existing number more correct. | Phase 2+ **[D]** |
| Any payment-method model | Cash only. | Out **[D]** |

---

## 6. Threat and failure model

We defend against accident, not adversaries. **[A2]**

| # | Failure mode | Likelihood | Impact | Primary defence |
|---|---|---|---|---|
| F1 | Stale snapshot replayed on transaction retry | **Occurred** | Phantom stock, wrong FIFO | M2 — load lots inside the callback |
| F2 | Lot mutated without its product read | Latent | Lost update | M4 primitives + lint |
| F3 | Non-lot-aware writer invoked | Latent, catastrophic | P1 broken instantly | M0 deletion |
| F4 | Stock commits, ledger fails | Routine | Audit gap | Outbox + M5 dispatcher |
| F5 | Multi-transaction exchange interrupted | Occasional | Cash netting unapplied | M5 idempotent resume |
| F6 | Repair tool writes outside the ledger | **Occurred** (2026-07-10) | Unexplainable stock | M6 audited repair |
| F7 | Drift accrues undetected | **Occurred** | Compounding error | M1 two-sided + nightly |
| F8 | Bad deploy corrupts at scale | Possible | Severe | M1.5 CI + M7 gates |
| F9 | Malformed `received_at` corrupts FIFO order | Latent | Silent COGS error | L4 enforcement |
| F10 | Malicious insider | Very low **[A2]** | Severe | Accepted; Phase 2/3 |

**F9 deserves emphasis.** FIFO ordering depends entirely on `received_at`; today a missing or invalid value sorts to `0` ([invoices.ts:178](../../lib/firestore/invoices.ts#L178)) **[C]** and is consumed *first*, at whatever cost it carries. One malformed lot silently corrupts COGS for every later sale of that product, and nothing currently detects it.

---

## 7. Complete invariant register

Each invariant carries: ID, description, severity, enforcement point, test requirement, investigation action, deploy-blocking status.

**Enforcement:** **T** = asserted in the mutating transaction · **R** = Firestore rule · **V** = validator only.
**Severity:** **CRITICAL** = stock/cost/money already wrong, wake someone · **ERROR** = internally inconsistent, fix this week · **WARNING** = leading indicator, review periodically.

**Deploy-blocking:** CRITICAL and ERROR block; WARNING does not.

### 7.1 Product stock

| ID | Description | Sev | Enf | Investigation |
|---|---|---|---|---|
| P1 | `stock_quantity == Σ qty_remaining` (**two-sided**) | CRITICAL | T+V | Movements in window; then §15 repair |
| P2 | `stock_quantity >= 0` | CRITICAL | T+R+V | Find the over-consuming write |
| P3 | `stock_quantity` is an integer | ERROR | T+R+V | Find the fractional writer |
| P4 | `cost_price >= 0`, finite | ERROR | R+V | Check last receipt |
| P5 | `cost_price` matches newest live lot cost | WARNING | V | Informational only |
| P6 | Referenced products exist | ERROR | V | Check deletion history |

**P1 is the constitution.** The current invoice-path check fires only when `book > lotTotal` **[C]**, and *all 43 production cases were the opposite direction* — which is exactly why it went undetected.

### 7.2 FIFO lots

| ID | Description | Sev | Enf | Investigation |
|---|---|---|---|---|
| L1 | `0 <= qty_remaining <= qty_in` | CRITICAL | T+R+V | Restoration or lost update |
| L2 | `qty_in > 0` | ERROR | R+V | Check creating operation |
| L3 | `unit_cost >= 0`, finite | CRITICAL | R+V | Check receipt |
| L4 | `received_at` present and valid | ERROR | T+R+V | **FIFO order at risk** |
| L5 | `product_id` resolves | ERROR | V | Orphan lot |
| L6 | `qty_in − qty_remaining == Σ active consumptions + Σ discard allocations − Σ restorations` | CRITICAL | V | The chain check |
| L7 | Lots are never deleted | CRITICAL | R | Rule must forbid delete |
| L8 | `trader_id` on receipt-origin lots | WARNING | V | Sourcing gap |

**L6 is the second constitution** and is **already implemented** as `LOT_BALANCE_VS_CONSUMPTIONS` [validateInventory.ts:180](../../lib/inventory/validateInventory.ts#L180) **[C]**. It detects a lost update immediately, even while P1 still balances — it would have caught the historical drift on day one had it been running.

### 7.3 Consumptions

| ID | Description | Sev | Enf |
|---|---|---|---|
| C1 | Σ active consumption qty == invoice item qty | CRITICAL | T+V |
| C2 | `quantity > 0` | ERROR | T+V |
| C3 | `lot_id` / `invoice_item_id` resolve | ERROR | V |
| C4 | `cogs_amount == round2(unit_cost × quantity)` | CRITICAL | T+V |
| C5 | `consumption.unit_cost == lot.unit_cost` at consumption time | CRITICAL | T+V |
| C6 | Voided invoice → all consumptions carry `reversed_at` | CRITICAL | V |
| C7 | Consumptions exist only for posted/void invoices | CRITICAL | V |
| C8 | Never deleted | CRITICAL | R |

**C5 is the cost-basis guarantee** — the property that lets returns restore stock at original cost. **C7 detects a torn post**: a draft owning consumptions means stock moved but the status flip did not commit.

### 7.4 Invoices, sales, COGS

| ID | Description | Sev | Enf |
|---|---|---|---|
| I1 | Posted invoice has all `posted_*` fields | ERROR | T+R |
| I2 | Every item of a posted non-void invoice has ≥1 active consumption | CRITICAL | V |
| I3 | **Draft immobility** — no consumptions, no sales, no COGS rows | CRITICAL | V |
| I4 | `item_ids` all resolve | CRITICAL | T+V |
| I5 | `posted_cogs_amount == Σ invoice_item_cogs.cogs_amount` | CRITICAL | T+V |
| I6 | Item COGS == Σ that item's consumption COGS | CRITICAL | T+V |
| I7 | Σ sales qty == Σ invoice item qty (posted) | ERROR | V |
| I8 | Exactly one sales row per posted item | ERROR | V |
| I9 | Voided invoice has `stock_reversal_applied == true` | CRITICAL | T+R |
| I10 | `order_id` unique | CRITICAL | T (doc ID) |

**I3 is the draft firewall.** Every recovery procedure assumes drafts are inert; if I3 breaks, deleting a draft destroys stock. **I7/I8 are ERROR, not CRITICAL** — `sales` is a reporting projection rebuildable from `lot_consumptions`, which is the true record. Stock is unaffected. Grading them CRITICAL would dilute the signal.

### 7.5 Returns, restorations, exchanges

There is **no separate exchange entity [C]** — the counter-sale flow *is* the exchange.

| ID | Description | Sev | Enf |
|---|---|---|---|
| R1 | Returned qty ≤ sold − already returned | CRITICAL | T+V |
| R2 | Σ restorations per consumption ≤ consumption qty | CRITICAL | T+V |
| R3 | restorations + write-offs ≤ consumed | CRITICAL | T+V |
| R4 | Restored qty returns to the **original lot at original cost** | CRITICAL | T+V |
| R5 | Restoration never pushes `qty_remaining` above `qty_in` | CRITICAL | T+R |
| R6 | Written-off returns never restock | CRITICAL | T+V |
| R7 | Posted return has its ledger row | ERROR | V |
| R8 | Counter-sale: Σ attached credit == `returns_credit_amount` | ERROR | V |
| R9 | Voided invoice has no posted returns | CRITICAL | T |
| R10 | `returns_post_status: pending` older than 1h | ERROR | V |

**R10 is new in this revision.** An unfinalised counter sale is currently invisible — it appears nowhere in Inventory Health. **[C]**

### 7.6 Discards and adjustments

| ID | Description | Sev | Enf |
|---|---|---|---|
| D1 | Σ discard lot allocations == discard item qty | CRITICAL | T+V |
| D2 | Discard allocations follow FIFO | ERROR | V |
| D3 | Discard COGS == Σ(lot cost × qty), rounded 2dp | ERROR | T+V |
| D4 | Every discard has a `DAMAGE` ledger row | ERROR | V |
| A1 | Adjustment carries reason **category + detail** | CRITICAL | T |
| A2 | Adjustment carries `posted_by_uid` | CRITICAL | T |
| A3 | Ledger line records `before_on_hand` / `after_on_hand` | ERROR | T |
| A4 | Negative adjustment ledger cost is **FIFO cost consumed** | ERROR | T |
| A5 | Adjustments emit `ADJUSTMENT` — never `PURCHASE_RECEIPT` / `STOCK_ISSUE` | CRITICAL | T |

**A5 and A4 are violated today. [C]** A shrinkage write-off through the main inventory screen is indistinguishable in the ledger from a genuine purchase receipt.

### 7.7 Ledger

| ID | Description | Sev | Enf |
|---|---|---|---|
| G1 | Every committed movement has exactly one ledger transaction | CRITICAL | V |
| G2 | No source doc `pending`/`failed` beyond 1h (CRITICAL beyond 24h) | ERROR | V |
| G3 | Ledger is append-only | CRITICAL | R |
| G4 | **`net change in stock_quantity == Σ movement line quantities + Σ reconciliation corrections`** (revised — §19.0.5-M.6) | CRITICAL | V |
| G8 | `RECONCILIATION` rows carry `movement: false` and never enter movement sums | ERROR | V |
| G5 | No orphan ledger row | ERROR | V |
| G6 | Line `unit_cost > 0` where a cost basis exists | WARNING→ERROR at M5 | V |
| G7 | `posted_by_uid` non-empty | ERROR | V |

**G4 is the ledger's purpose** — an independently maintained second opinion.

**G4 was restated in revision 4** because M0.5's reconciliation operation changes `stock_quantity` without any physical movement (§19.0.5-M.6). Under the original wording that would have registered as a G4 violation, creating the perverse outcome that *repairing* drift breaks a CRITICAL invariant. The two-term form keeps the arithmetic closed while distinguishing units that physically moved from units that were mis-recorded — a distinction the original had no vocabulary for. **[R]** The revised form is strictly more expressive, not a weakening.

**G6 starts as WARNING deliberately:** sale/return/discard lines carry `unit_cost: 0` today **[C]**, so grading it ERROR before M5 would start the validator red, and a validator that is never green is one people learn to ignore.

### 7.8 Cash-only invoice constraints

| ID | Description | Sev | Enf |
|---|---|---|---|
| K1 | `paid_amount >= 0` | CRITICAL | T+R+V |
| K2 | `paid_amount <= effective invoice total` (posted − returned) | CRITICAL | T+V |
| K3 | Voided invoice handles recorded cash per approved rule | CRITICAL | T+V |
| K4 | Counter-sale finalize never reduces `paid_amount` it did not record | CRITICAL | T+V |
| K5 | Cash mutation attributable to user + timestamp where practical | WARNING | T |

**K2 is not enforced by rules today** — they cap at `posted_total_amount` **[C]**, which for an invoice carrying returns is higher than the effective total. The app clamps on read; the database does not.

### 7.9 Register mechanics

The register lives in **one machine-readable file**, `lib/inventory/invariants.ts`: ID, description, severity, enforcement, check function, investigation action, deploy-blocking flag. The validator iterates the register and never carries its own list. Documentation and the CI coverage check are both generated from it. **[R]**

This is what makes coverage a countable number rather than a belief — the failure mode that produced a validator asserting 3 of 15 issue codes. **[C]**

---

## 8. Validator architecture

### 8.1 Principles

1. **Read-only, always.** Detection and repair are separate programs with separate credentials (§13). Merging them is how `reconcile-book-stock.mjs` became able to cause the drift it reports. **[C]**
2. **Attribution over detection.** "Product X drifted by 3" is far less useful than "…and the only movements in the window were INV-…4471 and DSC-118; the invoice's consumption sum is 3 short."
3. **One implementation.** Nightly, CI, dashboard and pre-deploy all call the same function.
4. **Deterministic.** Same data and same `as_of` produce the same report.

### 8.2 Passes

Ordered cheapest-first so a structural failure short-circuits an expensive join.

| Pass | Checks | Complexity |
|---|---|---|
| 1 Structural | P2–P4, L1–L5, C2, K1 | O(n), no joins |
| 2 Core balance | **P1** | O(products + lots) |
| 3 Consumption chain | **L6**, C1, C4–C7, R1–R6, D1–D3 | O(consumptions) |
| 4 Document coherence | I1–I10, R7–R10, K2–K4, G5 | O(invoices) |
| 5 Ledger reconciliation | G1, G2, G4, G6, G7 | O(ledger lines) |

### 8.3 Report shape

```
InventoryValidationReport {
  schema_version, run_id, mode: "full" | "incremental",
  started_at, finished_at, project_id, as_of,
  scope: { product_ids?, discovered_from?, since? },   // incremental only
  counts: { products, lots, consumptions, invoices, ledger_transactions },
  summary: { critical, error, warning },
  issues: [ { invariant_id, severity, entity_type, entity_id,
              expected, actual, delta, context[], suggested_action,
              first_seen_at } ],
  truncated: boolean, issues_total: number,
  verdict: "PASS" | "PASS_WITH_WARNINGS" | "FAIL"
}
```

Three non-negotiables: `invariant_id` joins to the register so severity can never disagree; `first_seen_at` carries forward so new drift is distinguishable from known-unrepaired drift (without it the report is re-triaged nightly and abandoned within a fortnight); `suggested_action` is advisory and never triggers anything.

`verdict` is `FAIL` on any CRITICAL or ERROR.

---

## 9. Full versus incremental validation

### 9.1 The discovery problem — and why the obvious design fails

**Incremental validation cannot query products by modification time, because `ProductDoc` has no `updated_at` and no stock-write site sets one. [C]**

**[R] The working set is derived from the append-only movement records instead.** This is not a workaround; it is the better design. Movement records are immutable and timestamped at write, whereas a mutable `updated_at` is a field we would have to *trust* for a correctness decision.

### 9.2 Discovery sources

Given `since` (the previous successful run's `as_of`), the candidate product set is the **union** of:

| # | Source | Field | Confirmed available |
|---|---|---|---|
| 1 | `stock_lots` | `updated_at > since` | **Yes — required field, all 6 mutation sites write it [C]** |
| 2 | `lot_consumptions` | `created_at > since` | Yes — written on post **[C]** |
| 3 | `inventory_transactions` | ledger rows since | Yes |
| 4 | `invoices` | `updated_at > since` | Yes |
| 5 | `return_lot_restorations` / `_write_offs` | created since | Yes |
| 6 | `inventory_discards` | created since | Yes |
| 7 | **Stuck work, regardless of time** — `ledger_status` in (pending, failed), `returns_post_status: pending` | — | Yes |

Source 1 alone catches every lot mutation, and since a product's stock cannot change without a lot changing (once M0 removes the non-lot-aware writers), **source 1 is close to sufficient**. The others provide defence in depth and catch document-level issues that do not touch a lot.

Each discovered product is then validated **in full** — all its lots, consumptions, and related invoices. Incremental narrows *which products*, never *which checks*.

### 9.3 The blind spot, stated honestly

Incremental validation cannot detect corruption that left **no timestamped trace** — a direct console write, a restored backup, or a lot mutated without `updated_at`. **[I]**

This is exactly what nightly full validation exists to cover. **Incremental never replaces full.** A full run is mandatory nightly and after any mutation-engine change.

Additionally: **the first incremental run after any gap must fall back to full.** If `since` is missing, older than 48 hours, or the previous run failed, the mode silently upgrades to full and says so in the report. A stale watermark must never produce a falsely narrow green result.

### 9.4 Mode selection

| Trigger | Mode |
|---|---|
| Nightly 02:00 | **Full** (mandatory) |
| Post-deploy +15 min | Incremental |
| Dashboard button | Incremental (full available explicitly) |
| Pre-deploy, inventory change | Full |
| Pre-deploy, non-inventory change | None — recency check only (§18) |
| Pre/post migration | Full both sides |
| After repair | Incremental scoped to the repaired products |
| CI | Fixtures only, never production |

### 9.5 Watermark, overlap and the completion manifest

The `as_of` watermark is stored in `inventory_validation_runs/{runId}` and advanced **only on a run whose completion manifest is complete** (below). A run that fails to read any source does not advance it. Advancing on partial success is how gaps become permanently invisible.

#### 9.5.1 Overlap window — never query from the exact watermark

**[R] Discovery queries use `since = previous_as_of − OVERLAP`, with `OVERLAP = 15 minutes`.**

The reason is a real Firestore behaviour, not defensiveness. `serverTimestamp()` resolves at **commit** time, but a transaction may *begin* well before it commits — and under contention with three retries plus backoff, seconds to tens of seconds can separate the two. A document whose write began before the watermark can therefore land with a timestamp after it, or be committed after our discovery query has already scanned past that range. **[I]** Querying from the exact watermark leaves a silent hole of exactly one commit-latency window per run, every run, forever.

Overlap makes discovery idempotent rather than exact: re-validating a product that was already clean is cheap and harmless; missing one is not. 15 minutes comfortably exceeds any plausible commit latency including retries, while keeping incremental scopes small.

**Corollary:** the *only* cost of overlap is re-validating a handful of products. There is no correctness cost, because validation is read-only and `first_seen_at` de-duplicates repeat findings.

#### 9.5.2 Pagination

Every discovery query and every validation read **must paginate with an ordered cursor** — order by the timestamp field plus document ID as a tiebreak, page size 500, cursor carried in the run state.

Requirements:
- **Resumable.** A run interrupted mid-pagination records its cursor; the next run resumes rather than restarting.
- **No unbounded `getDocs`.** The current validator and several screens read whole collections **[C]**; the new validator must not.
- **Deterministic ordering** so two runs over identical data produce identical reports.
- **Page-level failure is source-level failure** — a failed page marks its source incomplete in the manifest.

#### 9.5.3 Completion manifest

Every run writes a manifest recording, per discovery source, what actually happened:

```
manifest: {
  sources: [ { source, since, until, pages_read, docs_scanned,
               status: "complete" | "partial" | "failed",
               last_cursor?, error? } ],
  products_discovered, products_validated,
  invariants_evaluated[],        // register IDs actually run
  invariants_skipped[],          // with reason
  complete: boolean
}
```

**`complete` is true only when every source is `complete` and every register invariant either ran or is explicitly and justifiably skipped.**

The manifest governs three things:

| Consumer | Rule |
|---|---|
| Watermark | Advances **only** if `complete == true` |
| Deploy gate | Treats `complete == false` as **not green** — never as pass |
| Dashboard | Shows partial runs distinctly from green runs, with which source failed |

**[R] This is the mechanism that makes "the validator ran" a verifiable claim rather than an assumption.** The failure this system has already experienced is a control believed to be running while it was not **[C]**; a manifest makes the difference machine-checkable. A run that scanned four of seven sources must never be indistinguishable from one that scanned all seven.

### 9.6 On-demand validation — authorization, rate limits and concurrency

The dashboard button and its API route are the only operator-triggered path into the validator. A full scan is expensive, so the endpoint needs real controls.

| Control | Rule |
|---|---|
| **Authorization** | `verifyRequestRoles(request, ["admin"])`. Clerks and social have no access. Enforced server-side; the UI check is cosmetic |
| **Credentials** | Runs under the **read-only validator identity** (§13). Never the repair identity. The route holds no stock-write capability |
| **Default mode** | **Incremental.** Full requires an explicit, separately-labelled action |
| **Rate limit — incremental** | 1 per 5 minutes per project, 12 per hour |
| **Rate limit — full** | **1 per hour per project**, and refused entirely if a full run finished within 15 minutes |
| **Concurrency lock** | A Firestore lock document; only **one** validation run at a time regardless of trigger. A second request returns the in-progress `run_id` rather than starting a parallel scan |
| **Lock expiry** | 30 minutes, so a crashed run cannot block forever |
| **Timeout** | Full runs cap at 10 minutes; on expiry the run is recorded `partial`, the manifest is incomplete, and the watermark does not advance |
| **Audit** | Every invocation records uid, mode, timestamp, `run_id`, outcome |
| **Scheduled runs win** | A manual request that would collide with the nightly full run is queued behind it, not run alongside |

**[R] Rate limits are about cost and noise, not abuse.** The realistic scenario is an anxious operator clicking Refresh during an incident — precisely when the system is least able to absorb redundant full scans. Returning the in-progress `run_id` gives them what they actually want (progress) instead of a second scan.

---

## 10. Inventory lifecycle review

Condensed from revision 1; unchanged assessments are summarised, changes flagged.

| Operation | Assessment | Phase 1 action |
|---|---|---|
| **Stock In** | Reference implementation — ledger inside the transaction, two-sided assertion, mandatory trader, never merges lots | M4 migration only |
| **Invoice Post** | **The one operation that corrupted production.** Stale snapshot (F1), one-sided invariant, op-estimate undercount | **M2 — the core fix** |
| **Invoice Void** | Correct on stock; reverses in exact opposite consumption order with a `qty_in` guard. `sales`/`invoice_item_cogs` survive the void **[C]** | Detect via I7/I8; write path unchanged **[D]** |
| **Return** | Best-engineered operation — LIFO unwinding over consumption chunks preserves exact cost basis | No change; M4 migration last |
| **Exchange (counter-sale)** | **Weakest sequence** — multi-transaction by construction; `finalizeCounterSaleReturns` assigns `paid_amount` post-commit outside a transaction **[C]** | **M5 — K4 fix**; detect via R8/R10 |
| **Discard** | FIFO correct, three-tier trail, append-only. No retry loop; no ledger repair; COGS unrounded **[C]** | **M3** |
| **Adjustment** | **Two implementations; the main UI uses the weaker one.** Wrong ledger type, no reason, operator-typed cost **[C]** | **M3** |

**Design decision — ledger placement in `postInvoice`. [R]** `stockIn` writes its ledger row inside the transaction; `postInvoice` uses the post-commit outbox. Inside is strictly safer but costs ~2 ops per product against a 500-op cap large invoices already approach, reducing maximum invoice size. **Keep the outbox; fix its recovery with a server-side dispatcher (M5).** The outbox design — deterministic IDs, dedupe-by-source, short-circuit — is sound; its only real flaw is depending on a browser tab staying open.

**Rollback and recovery doctrine:**

| Situation | Doctrine |
|---|---|
| Transaction fails mid-flight | Firestore rolls back atomically |
| Contention | 3 attempts, backoff + jitter, retry only `aborted`/`failed-precondition` |
| Invariant violation | **Never retry** — deterministic failure |
| Stock committed, ledger failed | **Never roll back stock.** Mark failed, dispatcher retries |
| Multi-transaction interrupted | Idempotent resume from a persisted marker — never a compensating write |
| Drift detected | **Never auto-repair.** §15 |

---

## 11. Concurrency model

### 11.1 The rule

> **The product document is the concurrency anchor for its entire lot set.**
> No transaction may mutate a `stock_lot` without reading **and** writing that lot's product document in the same transaction.

Reading establishes the precondition; writing invalidates competitors' preconditions. Together they serialise all mutations of that product's lots while leaving different products fully parallel.

**This holds today by accident. [C]** Phase 1 makes it explicit (documented), structural (M4 primitives), and enforced (lint + tests). The accidental status is the danger: nothing stops the next change from writing a lot without touching its product, and nothing would detect it until stock drifted.

### 11.2 Eliminating stale reads (M2) — revised for the client SDK constraint

**The client SDK cannot query inside a transaction (§2.2b) [C].** The design below achieves freshness without a transactional query, and is the subject of the M1.5 spike.

##### 11.2.1 Read ordering is mandatory, not stylistic

**The product anchor must be `tx.get`-ed BEFORE the non-transactional lot query. Reversing these two reads reintroduces the lost update in a new form.**

Why — the unsafe ordering, step by step:

```
T1  getDocs(active lots)              → sees lot set S
T2  concurrent stock-in commits: creates lot X, writes product → version V+1
T3  tx.get(product)                   → reads V+1  (the ALREADY-UPDATED value)
T4  commit                            → product is still V+1, precondition HOLDS
                                      → commits using lot set S, which is missing X
```

The transaction never conflicts, because it read the product *after* the competing write. **A precondition can only protect against changes that happen after the read that established it.** The anchor is real, but it was acquired too late to cover the query.

The safe ordering:

```
T1  tx.get(product)                   → reads version V, precondition established
T2  getDocs(active lots)              → fresh, and now covered by that precondition
T3  concurrent stock-in commits       → product becomes V+1
T4  commit                            → V ≠ V+1, precondition FAILS → retry
                                      → retry re-reads product and re-queries lots
```

Any lot mutation after T1 co-writes the product (§11.1) and therefore invalidates our precondition. The window between T1 and T2 is covered because a write landing there still bumps the product past V.

**Ordered sequence for every mutation path:**

1. `tx.get(product)` — **first**, establishing the anchor
2. `getDocs(active lots)` — non-transactional, inside the callback, fresh per attempt
3. `tx.get(each lot to be written)` — preconditions on the write set
4. FIFO selection and simulation — recomputed per attempt **[C: today computed once, outside, never recomputed]**
5. Two-sided invariant assertion against the fresh data
6. Writes — product and lots together

**Bounding rules:** query `qty_remaining > 0` ordered by `received_at` (composite index, deployed in a prior PR); never `tx.get` every historical lot — it does not scale and buys nothing under the anchor.

**The residual window, stated plainly. [I]** Between step 2 and commit, another transaction may create a new lot. That lot is invisible to our query and carries no precondition of its own. The anchor closes it: creating a lot co-writes the product, invalidating our step-1 precondition and forcing a retry, at which point the fresh query sees it. **This holds only under the ordering above.**

**This is the single load-bearing assumption in M2**, which is why it is settled by measurement (M1.5-S) rather than by argument, and why C2, C9 and the new C11 are all mandatory.

### 11.3 Retry classification

Uniform: 3 attempts, exponential backoff with jitter. **Retry only transient contention.** Never retry an invariant violation or a validation failure — that is a slower failure with a worse message. Discard gains this loop in M3. **[C: it has none today]**

### 11.4 Residual risks accepted

| Risk | Why accepted |
|---|---|
| Counter-sale spans transactions | Single-transaction would breach the op cap. Idempotent resume + R8/R10 detection **[D]** |
| No draft reservation | Not an integrity defect; posting fails safe **[D]** |
| Client-side transactions | Same atomicity as server; §5 **[D]** |

---

## 12. Testing architecture

### 12.1 Governing principle

> **A test that exercises a reimplementation of the code under test is not a test.**

`inventoryConcurrency.test.ts` tests a local `consumeFifo` mock described as *"mirrors stockOut / postInvoice logic"* **[C]** — it will keep passing if the real FIFO diverges, which is exactly why F1 was invisible. Its "idempotency" test asserts that a JavaScript `Map` deduplicates.

**That suite is deleted and replaced with emulator tests against the real functions.** Not extended — deleted.

### 12.2 Layers

| Layer | Target | Environment | Gate |
|---|---|---|---|
| Unit | FIFO ordering, COGS rounding, allocation, invariant predicates | In-memory | Every PR |
| Rules | Every inventory collection, allow and deny | Emulator | Every PR |
| Integration | Each operation end-to-end + full register assertion | Emulator | Every PR |
| Concurrency | Real functions, parallel writers | Emulator | Every PR |
| Regression | One per historical defect, named for it | Emulator | Every PR |
| Retry | Forced contention; assert fresh reads per attempt | Emulator | Every PR |
| Ledger idempotency | Repeat fulfilment, no duplicates | Emulator | Every PR |
| Repair workflow | Drift → detect → approve → adjust → re-validate | Emulator | Every PR |
| Op-cap | Boundary invoices | Emulator | Nightly |
| Randomised | Random sequences, register after each step | Emulator | Nightly |
| Stress | Many lots, many products | Emulator | Nightly |

**`firebase.json` has no emulators block [C]** — adding Firestore and Auth emulator config is a M1.5 prerequisite.

### 12.3 The invariant assertion helper

`assertAllInvariants(db)` runs the **entire register** against emulator state and is called after **every** mutation in **every** integration test. Highest-leverage item in the plan: a new operation cannot break an old invariant without a test failing, even when nobody thought to write that specific test.

### 12.4 Required concurrency tests

| # | Scenario | Asserts |
|---|---|---|
| **C1** | Two invoices, same product, FIFO spilling into a second lot | **The historical defect.** P1 + L6 |
| C2 | Post vs stock-in | Both succeed; P1 |
| C3 | Post vs discard | Serialise; P1 |
| C4 | Post vs return | P1 + L6 |
| C5 | Post vs adjustment | P1 |
| C6 | Double post, same invoice | Idempotent; stock moves once |
| C7 | Two voids, same invoice | One succeeds; no double restoration |
| C8 | Ten concurrent posts, overlapping products | P1 + L6 for all |
| C9 | Forced retry | Second attempt reads **fresh** lots |
| C10 | Op-cap boundary | Clean failure, no partial commit |

**C1 is the acceptance test for M2. It must be written first and demonstrated to FAIL against current code.** A regression test that has never failed is an assumption wearing a lab coat.

### 12.5 Coverage requirement

**100% behavioural coverage of the register:** every invariant has at least one test that deliberately violates it and proves the validator reports it. Enforced in CI by comparing register IDs against test-declared IDs. This is the one number to hold firm on.

---

## 13. Production credential and permission model

**[R] Three separate identities. No identity may both detect and repair.**

| Identity | Purpose | Permissions | Secret location |
|---|---|---|---|
| **`inventory-validator`** | Read-only validation | **Read only**, restricted to the validated collections. No write, update, delete anywhere | CI secret store; never in `.env`, never in Git |
| **`inventory-repair`** | Audited adjustments (M6) | Write to `stock_lots`, `products`, `inventory_transactions`, `inventory_repairs` | **Not available to CI.** Operator-invoked only |
| **`ledger-dispatcher`** | Outbox fulfilment (M5) | Write `inventory_transactions` + status fields only. **No stock write** | Server runtime secret |

**Enforcement:** IAM custom roles at the GCP level with `datastore.entities.get`/`list` only for the validator. Collection scoping is achieved by validating with a service account whose role grants read on the database and by the validator code touching only its declared collections — **[I]** Firestore IAM is database-scoped, not collection-scoped, so the read restriction is real but the collection restriction is code-level plus audit-log verified, not IAM-enforced. Stating this honestly matters: it is a genuine limitation, and the mitigation is that a read-only role cannot damage anything regardless of which collection it touches.

**Secret handling:** CI secret store only; distinct secrets per environment; rotation every 90 days; never echoed to logs; never written to disk in CI beyond the job's lifetime.

**Environment separation:** test (`rastaa-421b8`) and production (`wholesale-b4ff9`) have entirely separate service accounts. Every script retains the existing cross-project guard **[C — already present]**. The validator refuses to run if the resolved project ID does not match an explicit `--project` argument.

**Logging and audit:** every validation run logs run ID, mode, identity, project, timing, and counts — never document contents. GCP audit logs for the validator identity are reviewed if any unexpected write ever appears (there should never be one).

**If the validator cannot reach production:** the run is recorded as `INFRASTRUCTURE_FAILURE`, **the watermark does not advance** (§9.5), and the deploy gate treats it as **not green** — not as pass. Three consecutive failures alert the owner. An unreachable validator must never read as a passing validator; that failure mode is how the current situation arose. **[C]**

---

## 14. Reporting and retention policy

**Production reports never enter Git. [R]** They contain product IDs, invoice IDs, stock quantities, costs and internal references.

| Destination | Contents | Retention | Access |
|---|---|---|---|
| `inventory_validation_runs/{runId}` | Summary + issue **metadata** (invariant ID, severity, entity type/ID, delta, `first_seen_at`) | 180 days | Admins in-app |
| Private cloud storage | Full detailed report | 90 days, lifecycle-deleted | Owner + engineer, audit-logged |
| CI artifacts | Fixture-based reports only | 14 days | CI users |
| Git | **Sanitised fixtures and example reports only** | Permanent | Repo |

**Redaction:** no cost prices, no customer identifiers, no monetary totals in the Firestore summary. IDs are retained — they are needed for attribution and are not independently sensitive to an authenticated admin.

**Size limits:** maximum **500 issues** in the Firestore document; beyond that `truncated: true` with `issues_total` set and the full detail in cloud storage. Issues are ordered severity-first so truncation never hides a CRITICAL. Payload capped at 400 KB against Firestore's 1 MiB limit.

**Dashboard shows:** last run time and age, mode, verdict, counts by severity, the issue list with entity links, `first_seen_at`, and a link to full detail for those authorised. **It does not show** cost prices or aggregate valuations.

**Also removed in M0:** `firestore-debug.log` (132 KB, committed, contains emulator document contents) is deleted and gitignored. **[C]**

---

## 15. Repair authority and approval model

### 15.1 The principle

When book stock and lot stock disagree, **neither is presumed correct.** The operator must declare what evidence establishes the truth.

This is not procedural ceremony. All 43 production drift cases were `lotSum > book` **[C]**, which invites the conclusion that the lot layer is authoritative and book stock should be synced up to it. **That conclusion would have been wrong** — the lot sum was inflated by phantom quantity from the lost update, and syncing book stock upward would have made the error permanent and doubled it. **[I]** Requiring declared evidence is what prevents that reasoning.

### 15.2 Authority categories

| Category | Meaning | Strength |
|---|---|---|
| `physical_count` | Someone counted the shelf | **Strongest** |
| `purchase_receipt` | Verified against supplier documentation | Strong |
| `invoice_history` | Reconstructed from posted invoices | Strong |
| `consumption_history` | Reconstructed from `lot_consumptions` | Strong |
| `return_history` | Verified against posted returns | Moderate |
| `discard_history` | Verified against discards | Moderate |
| `administrative` | No external evidence; judgement | **Weakest — requires approval** |

`administrative` requires a second approver. **[R]** It is the category that will be over-used under time pressure, and making it the only one needing a second signature is the cheapest available brake.

### 15.3 The repair record

Written to `inventory_repairs/{repairId}`, immutable:

```
validation_run_id, product_id, invariant_id,
before_book_stock, before_lot_total,
physical_count?, approved_final_quantity, adjustment_delta,
authority_category, reason_detail,
related_document_ids[],
acted_by_uid, approved_by_uid?,
created_at, ledger_transaction_id
```

`ledger_transaction_id` is mandatory — **a repair that produced no ledger row is not a repair.**

### 15.4 The flow

1. Validator reports drift with attribution.
2. Operator investigates the named source documents.
3. Operator establishes truth and declares the authority category.
4. If `administrative`, a second admin approves.
5. System posts a **stock adjustment** — normal path, mandatory reason, correct `ADJUSTMENT` ledger type, real FIFO cost.
6. Repair record written with the ledger transaction ID.
7. **Incremental validation re-runs automatically, scoped to the repaired product**, and its verdict is attached to the repair record.

**No automated repair. Ever. [R]** An automatic repairer that mis-diagnoses converts a detection system into a corruption system. `reconcile-book-stock.mjs` is the cautionary example: on 2026-07-10 it rewrote 43 products with plain `batch.update` — no ledger, no reason, no user — in direct violation of `MIGRATION_RUNBOOK.md:87`. **[C]** It is replaced in M6 and stays dry-run-only until then.

---

## 16. Cash-only integrity rules

Payment redesign is out of scope. These are correctness constraints on the existing single `paid_amount` field, treated as **lifecycle bugs, not payment features**.

| ID | Rule | Status | Milestone |
|---|---|---|---|
| K1 | `paid_amount >= 0` | Enforced by rules **[C]** | — |
| K2 | `paid_amount <= effective total` (posted − returned) | **Rules cap at `posted_total_amount` instead [C]**; app clamps on read | M5 |
| K3 | Void handles recorded cash per approved rule | Void sets `paid_amount: 0` **[C]** — confirm this is the intended business rule | **M0 question** |
| K4 | Counter-sale finalize never overwrites recorded cash | **Violated — blind assignment post-commit [C]** | **M5** |
| K5 | Cash mutation attributable | Partial | M5 best-effort |

**K4 in detail.** [counterSaleReturns.ts:193](../../lib/firestore/counterSaleReturns.ts#L193) executes `updateDoc(invoiceRef, { paid_amount: summary.applied_credit, ... })` — an **assignment**, post-commit, outside any transaction. **[C]** Combined with the resume path at [invoices.ts:700](../../lib/firestore/invoices.ts#L700), a re-post after a partial failure re-runs finalize and overwrites any cash recorded in between. The adjacent excess-credit cash-out uses a deterministic ID and *is* idempotent **[C]**, which makes the non-idempotent sibling look like an oversight rather than a decision.

**Fix:** a transaction that reads the invoice, computes the correct netting relative to what is already recorded, and writes once — idempotent under repeated resume. No new collection, no payment-method model, no schema change.

### 16.1 K3 — a blocking business decision, not an engineering choice

**Void currently sets `paid_amount: 0` and `payment_status: "unpaid"`. [C — [invoices.ts:1419](../../lib/firestore/invoices.ts#L1419)]**

If cash was physically taken and the invoice is later voided, this **erases the record that money changed hands.** The invoice then reads as though no cash was ever received, while the cash is either in the drawer or was refunded — and nothing in the system distinguishes those two cases.

**[R] This must be resolved before M5 begins. It is a hard gate.**

The reason it cannot be deferred: M5 touches the cash-handling paths (K2 and K4). Encoding behaviour around K3 while K3's intended semantics are unknown means either building on a rule that turns out to be wrong, or building around it and revisiting the same code twice — in a live system where every touch of the payment field is a risk.

Three candidate rules, for the business to choose between:

| Option | Behaviour on void | Implication |
|---|---|---|
| **K3-a** — current | `paid_amount → 0` | Simple. **Loses the audit trail of cash received.** Cannot answer "was this refunded?" |
| **K3-b** | Preserve `paid_amount`; void records `cash_disposition: "refunded" \| "retained"` | Keeps the record. Requires one new field and a prompt at void time |
| **K3-c** | Block voiding any invoice with `paid_amount > 0`; require a return with `cash_refund` first | Strongest audit. Most operational friction. Consistent with the existing rule that a posted return blocks void **[C]** |

**[R] My recommendation is K3-b.** K3-a loses information the business will eventually need and cannot reconstruct. K3-c is the most correct but adds friction to an error-correction path, which is where friction causes the most damage — operators under time pressure will find another way, usually a manual adjustment that unwinds nothing. K3-b preserves the audit trail at the cost of one field and one prompt.

**What is needed from the business:** which of the three, and — if K3-b — whether the void prompt should default to refunded or retained. This is a five-minute conversation that blocks a milestone; it should happen in M0.

**Until it is answered, M5's cash work is limited to K4 (the counter-sale overwrite), which is unambiguously a bug under all three options.**

---

## 17. Performance instrumentation plan

**Instrument before optimising.** No performance change is in Phase 1's scope; M2 adds measurement so that Phase 2 optimises against data rather than intuition.

**Structured logs, one event per post**, not scattered `console.log`:

| Field | Purpose |
|---|---|
| `auth_ms`, `invoice_read_ms`, `items_read_ms`, `products_read_ms`, `lots_query_ms` | Where preflight time goes |
| `fifo_sim_ms`, `txn_attempts`, `retry_count`, `txn_duration_ms` | Contention behaviour — the key new signal |
| `product_count`, `active_lots_read`, `lot_spans`, `reads`, `writes` | Op-cap headroom |
| `ledger_fulfil_ms`, `returns_finalize_ms`, `total_ms` | End-to-end |
| `invoice_id`, `uid`, `outcome` | Correlation |

**Never logged:** cost prices, sale prices, customer identifiers, monetary totals. IDs and counts only.

**Targets [R]** — indicative, subordinate to correctness: p50 total < 2s, p95 < 5s, retries < 5% of posts, op-cap utilisation < 60%. **A target is never a reason to weaken an invariant.** If the two-sided assertion or in-transaction lot loading costs latency, that cost is accepted.

`retry_count` deserves particular attention: it is the direct observable for anchor contention, and a sustained rise after M2 is the earliest warning that something in the concurrency model is wrong.

---

## 18. CI and deployment gates

### 18.1 What counts as an inventory-related change

**[R] Explicit definition — a PR is inventory-related if it touches any of:**

| Category | Paths / concerns |
|---|---|
| Stock fields | Any write to `products.stock_quantity`, `stock_lots.*` |
| Core modules | `lib/firestore/invoices.ts`, `inventory.ts`, `invoiceReturns.ts`, `inventoryDiscards.ts`, `counterSaleReturns.ts`, `lotAdmin.ts`, `sales.ts` |
| Inventory lib | `lib/inventory/**` |
| FIFO / COGS | Selection, ordering, cost computation, rounding |
| Ledger | `inventory_transactions`, outbox, dispatcher, repair |
| Rules | Any `firestore.rules` hunk touching products, lots, consumptions, invoices, ledger, discards, returns |
| Indexes | Any `firestore.indexes.json` change |
| Validator / register | `validateInventory.ts`, `invariants.ts`, validation scripts |
| Types | `ProductDoc`, `StockLotDoc`, consumption, invoice, ledger types |

**CI computes this from the diff and labels the PR.** A human may escalate a PR to inventory-related but may not de-escalate one. **[R]** Asymmetry is deliberate: the failure mode is under-classification.

### 18.2 Risk-based gates

| Gate | Non-inventory PR | Inventory PR |
|---|---|---|
| Typecheck, lint, build | Yes | Yes |
| Unit tests | Yes | Yes |
| Rules tests | Yes | Yes |
| Integration (emulator) | Yes | Yes |
| Concurrency tests | No | **Yes** |
| Register coverage 100% | Yes | Yes |
| **Recent full validation** (< 36h, no unresolved CRITICAL) | **Yes — recency check only, no new scan** | Yes |
| **Pre-deploy full production validation** | **No** | **Yes** |
| Post-deploy incremental (+15 min) | Yes | Yes |
| Post-deploy full | No | **Yes, for mutation-engine changes** |
| Indexes deployed first | N/A | **Yes** |
| Rollback plan in PR | No | **Yes** |
| Observation window | 24h | **7 days** |

**This is the correction to revision 1**, which required a full production scan before every deploy. That would make a CSS change wait on a full database scan — slow, costly, and noisy enough that people would route around it. A recency check gives most of the protection at negligible cost.

**Indexes before code** is a real failure mode: deploying code that needs an index before the index exists produces `FAILED_PRECONDITION` at runtime for every affected user.

### 18.3 Emergency stop

Halt deploys and roll back on: any new CRITICAL invariant violation; P1 drift on a product with no explaining movement; ledger failure rate above baseline; any report of stock moving without a ledger row; `retry_count` sustained above 20%.

### 18.4 Rollback documentation correction

**All four rollout flags are `NEXT_PUBLIC_*` and are inlined into the client bundle at build time. [C]** `config.ts` claims *"Override via env for rollback without redeploying"* and the runbook instructs operators to edit `.env.local`. **This is false and must be corrected.** A rollback procedure that fails at the moment it is needed is worse than no documented procedure.

**[R]** Correct the documentation to state plainly that changing a flag requires a rebuild and redeploy, and document all four in `.env.example`. Do not build a runtime flag system in Phase 1 — that is new infrastructure during stabilisation. Where a true runtime kill-switch is needed (M5 dispatcher), use a server-read Firestore config document, which is server-side and genuinely runtime.

Related: **shadow mode is vacuous as written** — `actual` is hardcoded to `{ persisted: false }` while `expected` is the full input, so they can never match and every operation logs a diff. **[C]** Fix or delete; do not leave it looking like a control.

---

## 19. Revised milestones

Order: M0 → **M0.5** → M1 → M1.5 → M2 → M3 → M4 → M5 → M6 → M7.

**M0.5 is new in this revision.** M0 discovers pre-existing drift; M1's two-sided transactional assertion will start *refusing to post* on any product that carries it. Without a remediation step between them, turning on the assertion converts a silent data problem into a trading-floor outage. M0.5 exists to close that gap under control, before the assertion exists.

---

### Milestone 0 — Freeze, baseline and demolition

**Goal:** Know the true state; remove everything that can corrupt stock without touching lots.

**Work:** freeze unrelated inventory feature work · verified production export · run the existing validator read-only against production · enumerate every writer of `stock_quantity`, `qty_remaining`, lots, consumptions, ledger, and trace every caller · classify active / inactive / dead · delete dangerous unused writers · close the public product read · record baseline drift · measure A3/A4/A7 (lots per product, mutation volume, counter-sale volume) · confirm the K3 void-cash business rule.

**Files:** delete `lib/firestore/walkInSessions.ts`, `recordSale` in `sales.ts`, `AddSaleForm`, and the uncalled `lotAdmin.ts` exports (`syncProductStockFromLots`, `updateLotAndSyncProduct`, `deleteLotAndSyncProduct`, `createAdjustmentLot` — **keep `convertOpeningBalanceLotToStockIn`, it is imported [C]**); `firestore.rules`; `.gitignore` + remove `firestore-debug.log`; new `docs/inventory/WRITER_INVENTORY.md`.

**Risks:** Low. Deleting something reachable — mitigated by grep, typecheck, build, and full manual smoke. Baseline may reveal unknown drift (that is the point).

**Rollback:** `git revert`. No production data written.

**Success:** every writer catalogued; no non-lot-aware writer remains; baseline recorded; `products` requires auth; **no production data changed**.

**PRs:** (1) rules + gitignore + log removal — ship today; (2) writer inventory doc; (3) deletions; (4) baseline report.

---

### Milestone 0.5 — Controlled baseline remediation

**Goal:** Bring pre-existing drift to zero — or to a known, explicitly accepted set — **before** any transactional assertion can refuse a sale because of it.

**Why this milestone exists.** M0 measures drift. M1 ships an assertion that treats drift as a hard error at posting time. Between those two facts sits a live trading floor. If 43 products still carry drift when the assertion lands, those 43 products **cannot be sold** until someone repairs them — during business hours, under pressure, through whatever path is available. That is a worse outcome than the drift itself. **[I]**

**The constraint that shapes this milestone:** the audited repair workflow is M6, so M0.5 cannot use it.

> **CORRECTION (revision 4).** Revision 3 proposed repairing through the existing `postStockAdjustment` path. **That was wrong, and not marginally so — it was unimplementable.** §19.0.5-M below sets out the mathematics and the replacement design. The short version: a normal adjustment moves book stock *and* lot quantities by the same amount, so it preserves `book − lotTotal` rather than closing it; and because `assertStockLotInvariant` is two-sided and evaluated on the post-state, the transaction would have **aborted on the first drifted product**. M0.5 now requires a purpose-built reconciliation operation, and it is **not** a documentation-only milestone.

`reconcile-book-stock.mjs` remains excluded — it writes outside the ledger **[C]** and is exactly what M6 replaces.

**Work:**

1. **Triage the baseline.** Classify each drifted product by likely cause, testing H1–H5 (§2.2) against its movement history. Products whose drift has no concurrent-posting explanation are evidence that H1 is incomplete and must be escalated.
2. **Establish truth per product.** Physical count wherever feasible — this is the only category of evidence that is independent of the software. Where counting is impractical, reconstruct from `lot_consumptions`, which is append-only and the most trustworthy internal record.
3. **Record a pre-repair evidence sheet** per product: product ID, book stock, lot total, delta, evidence category, resolved quantity, who established it. This is the M6 repair record in manual form, and it is what makes these repairs reconstructable later.
4. **Post adjustments in small batches** — no more than 10 products per batch, validating after each — with a reason referencing the M0 baseline run.
5. **Re-validate after every batch.** A batch that does not reduce drift as predicted stops the milestone.
6. **Produce a residual register** of anything deliberately left unrepaired, with the reason and an owner.

---

#### §19.0.5-M — M0.5 Reconciliation Mathematics and Write Semantics

**This section exists because revision 3's repair mechanism was arithmetically incapable of doing the job. It is the design that replaces it.**

##### M.1 Why a normal adjustment cannot repair a mismatch — confirmed

`postStockAdjustment` moves **both** representations by the same quantity **[C]**:

| Direction | Lot layer | Book layer | Source |
|---|---|---|---|
| Positive `+q` | Creates a lot with `qty_remaining: q` | `increment(q)` | [stockAdjustment.ts:82](../../lib/inventory/stockAdjustment.ts#L82), [:90](../../lib/inventory/stockAdjustment.ts#L90) |
| Negative `−q` | FIFO-consumes `q` across lots | `increment(−q)` | [:149](../../lib/inventory/stockAdjustment.ts#L149), [:158](../../lib/inventory/stockAdjustment.ts#L158) |

Therefore, for any adjustment of size `q`:

```
(B ± q) − (L ± q)  ==  B − L
```

**The mismatch is invariant under the operation.** Given `B = 100, L = 103`, a `−3` adjustment yields `97 / 100` — still off by 3.

**And it is worse than ineffective. [C]** `assertStockLotInvariant` compares `book !== lotSum` ([invariantCheck.ts:38](../../lib/inventory/invariantCheck.ts#L38)) and is invoked on the **post-state** ([stockAdjustment.ts:131](../../lib/inventory/stockAdjustment.ts#L131), [:184](../../lib/inventory/stockAdjustment.ts#L184)). Since the delta survives the operation, a product that is drifted before is drifted after, so **the assertion throws and the transaction aborts**. The error would read `Inventory invariant violated for product X: book stock 100 != lot sum 103`.

`postStockAdjustment` is not broken. It is simply the wrong instrument: it is designed for *physical* stock change on a **consistent** product. It has no capability to alter the relationship between the two layers, by design — which is correct behaviour for the normal path, and exactly why a separate operation is required.

##### M.2 The three concepts the repair must keep separate

| Concept | Definition | Ledger treatment |
|---|---|---|
| **Lot reconciliation** | A stored `qty_remaining` disagrees with the lot's own consumption history. No goods moved. | `RECONCILIATION`, `movement: false` |
| **Book reconciliation** | `stock_quantity` disagrees with the (now-corrected) lot total. No goods moved. | `RECONCILIATION`, `movement: false` |
| **Physical adjustment** | Verified physical count differs from the corrected internal figure. **Goods really are missing or found.** | `ADJUSTMENT`, `movement: true` — a real movement |

Collapsing these into one "adjustment" is what makes an audit trail dishonest: it reports goods as having moved when only a stored number was wrong.

##### M.3 Lot selection is *derived*, never chosen

This is the heart of the design, and it is what makes the repair fix **L6** and not merely **P1**.

For every lot `i` of the product, its history-implied remaining quantity is computable from append-only records:

```
h_i  =  qty_in_i
        − Σ active lot_consumptions on lot i
        − Σ inventory_discard_lots allocations on lot i
        + Σ return_lot_restorations to lot i
```

This is precisely the L6 identity rearranged. Then:

- `a_i` = the currently stored `qty_remaining`
- `c_i = h_i − a_i` = that lot's correction
- `L_hist = Σ h_i` = the history-implied lot total

**Lots are not selected by FIFO, by recency, or by operator judgement. Every lot is corrected to its own history-implied value.** The phantom quantity is wherever `a_i ≠ h_i`, and the correction is exactly `c_i`.

**Consequences:** after applying every `c_i`, `a_i == h_i` for all lots, so **L6 is green by construction** — not incidentally, but because the correction is defined as the L6 residual. And the new lot total is exactly `L_hist`.

This is the answer to "which lots are wrong and by how much": the system derives it, the operator confirms it. A repair that guessed which lots to reduce could make P1 green while leaving L6 broken — the exact trap the review identified.

##### M.4 The algorithm, and how `B − L` reaches zero

Given `B` (book), `L` (lot total), optional verified physical count `P`:

**Step 1 — Derive.** Compute `h_i` for every lot; `L_hist = Σ h_i`.

**Step 2 — Sanity gates. Refuse to proceed if any hold:**
- any `h_i < 0` (consumption history exceeds intake — a worse, different defect)
- any `h_i > qty_in_i`
- `L_hist < 0`
- the product has lots with no `received_at` **[C: these sort first in FIFO and corrupt costing]**
- consumption records referencing missing lots or invoices

These are escalations, not auto-corrections. A tool that papers over a broken history is worse than no tool.

**Step 3 — Lot reconciliation.** Apply `c_i` to each lot where `c_i ≠ 0`.
→ `L' = L_hist`. Book untouched. **L6 green.** No movement.

**Step 4 — Book reconciliation.** `book_reconciliation = L_hist − B`. Apply to `stock_quantity` only; lots untouched.
→ `B' = L_hist = L'`. **P1 green.** No movement.

**Step 5 — Physical adjustment**, only when a count was performed and `P ≠ L_hist`.
`physical_delta = P − L_hist`, applied through the **normal `postStockAdjustment` path** — which now works correctly, *because steps 3 and 4 restored the invariant it asserts*.
→ `B'' = L'' = P`. Real `ADJUSTMENT` ledger row, real movement.

**Where the mismatch actually goes:** steps 3 and 4 change `B − L` from nonzero to zero, because step 3 moves `L` alone and step 4 moves `B` alone. **Neither step moves both.** That is the single property revision 3's design lacked.

##### M.5 The four cases, worked

| Case | Before | `L_hist` | Step 3 (lots) | Step 4 (book) | Step 5 (physical) | After |
|---|---|---|---|---|---|---|
| **Book right, lots wrong** | B=100, L=103, P=100 | 100 | −3 on phantom lots | 0 | 0 | 100 / 100 |
| **Lots right, book wrong** | B=100, L=103, P=103 | 103 | 0 | +3 | 0 | 103 / 103 |
| **Both wrong, physical differs** | B=100, L=103, P=98 | 100 | −3 | 0 | **−2 shrinkage** | 98 / 98 |
| **History itself broken** | B=100, L=103 | invalid | **REFUSE** | — | — | escalate |

The third row is the review's Case A, and it produces **two distinct records**: a `RECONCILIATION` for the 3 phantom units that never existed, and an `ADJUSTMENT` for the 2 units of genuine shrinkage. They are different events and the ledger says so.

##### M.6 Ledger semantics — and a required change to invariant G4

Steps 3 and 4 must **not** post `ADJUSTMENT`, `PURCHASE_RECEIPT`, `STOCK_ISSUE` or `DAMAGE`. Nothing was purchased, sold, issued or damaged. They post a new ledger type:

```
type: "RECONCILIATION"
movement: false
product_id, warehouse_id
book_before, book_after
lot_total_before, lot_total_after
lot_corrections: [ { lot_id, qty_in, before, after, delta, history_implied } ]
validation_run_id, authority_category, reason_detail
posted_by_uid, approved_by_uid
```

**This forces G4 to be restated. [R]** G4 currently says *"Σ ledger line quantity per product == net stock movement"*. A book reconciliation changes `stock_quantity` while posting no movement, which would break it. G4 becomes a closed two-term equation:

> **G4 (revised):** `net change in stock_quantity == Σ movement line quantities + Σ reconciliation corrections`

Movement lines and reconciliation corrections are summed separately and must jointly account for every unit of book-stock change. This keeps the ledger's arithmetic closed **and** keeps it honest about which units physically moved — strictly better than the original formulation, which had no vocabulary for a correction.

##### M.7 The write-semantics guarantee that makes a bypass tool acceptable

The reconciliation operation is the only code in the system permitted to move one layer without the other. That capability is contained by three rules:

1. **It asserts the post-state, never the pre-state.** It must begin from a violating state — that is its purpose — but it **refuses to commit unless P1 *and* L6 both hold afterwards**. This is a *stronger* guarantee than the normal path, which asserts P1 only.
2. **It is a single transaction per product**, with the product read first as the concurrency anchor (§11.2), so a concurrent sale cannot interleave.
3. **Every correction is derived and recorded per lot** — before, after, delta, and history-implied value — so the repair is reconstructable without the tool.

##### M.8 Tool lifecycle — temporary by construction

**M0.5 is therefore not a documentation-only milestone.** It ships `scripts/inventory/reconcile-mismatch.mjs` plus `lib/inventory/reconcileMismatch.ts`, under these constraints:

| Constraint | Rule |
|---|---|
| Exposure | **Never in the UI.** Script only |
| Default mode | **Dry-run mandatory**; `--apply` requires an explicit product allowlist file |
| Batch size | **Maximum 10 products per run** |
| Backup | A verified export must exist and be named in the run log |
| Approval | `approved_by_uid` required for every product; recorded before apply |
| Identity | Runs under `inventory-repair` (§13) — **never** the validator identity |
| Project guard | Refuses to run unless `--project` matches the resolved project ID **[C: guard pattern already exists]** |
| Validation | **Full validation after every batch**; a batch that does not reduce drift as predicted halts the milestone |
| Records | Writes to `inventory_repairs` — **the same schema M6 will use**, so repair history is continuous across the transition |
| **Disposal** | **Deleted in M6**, when the audited workflow replaces it. M6's exit criteria include *"`reconcile-mismatch.mjs` no longer exists in the tree"* |

**[R] Writing M0.5's records into M6's schema is deliberate.** It means the emergency tool and the permanent workflow produce identical audit records, so the baseline repairs remain first-class history rather than a footnote — and it forces us to design M6's schema now, while the requirements are concrete.

---

**Files:** `scripts/inventory/reconcile-mismatch.mjs` (new, temporary — deleted in M6) · `lib/inventory/reconcileMismatch.ts` (new, temporary) · `lib/types/firestore.ts` (`RECONCILIATION` ledger type, `inventory_repairs`) · `firestore.rules` (`inventory_repairs`) · new `docs/inventory/BASELINE_REMEDIATION.md` + evidence sheets.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| **The reconciliation tool is the only code allowed to move one layer without the other** | **High** | Post-state assertion of P1 **and** L6; one transaction per product; anchor-first ordering; **deleted in M6** |
| Repairing to the wrong number, cementing the error | **High** | Corrections are **derived** from consumption history (M.3), not chosen; physical count preferred; second approval; dry-run mandatory |
| History itself is broken, so `h_i` is not derivable | Medium | Sanity gates (M.4 step 2) refuse and escalate rather than guess |
| Drift re-accrues while repairing, because M2 is not shipped | **High — expected** | Repair close to M1; re-validate immediately before the assertion ships; accept a second small pass |
| A large residual set makes M1's assertion unshippable | Medium | The residual register is the decision input; see the branch below |
| Manual process is slow | Low | 10-product batches; it is bounded by the baseline size |

**The re-accrual problem is real and must be stated plainly. [I]** M0.5 repairs drift while the mechanism that (hypothetically) causes it is still live, because M2 has not shipped. Some re-accrual between M0.5 and M1 is expected. This is not a flaw in the ordering — it is the unavoidable consequence of needing detection before correction. It is handled by re-validating immediately before the two-sided assertion ships and accepting a short second remediation pass at that point.

**Decision branch — if the residual set is large.** If drift cannot be brought near zero, do **not** ship M1's two-sided transactional assertion on schedule. Instead: keep the validator (which is inert and safe), ship the assertion **behind an explicit allowlist** of known-drifted products.

**The allowlist is an emergency bridge with a hard expiry, not a tolerance mechanism. [R]** Left unbounded it becomes a permanent list of products where corruption is officially accepted — the precise failure this plan exists to end. Its constraints are therefore part of the design, not operational detail:

| Constraint | Rule |
|---|---|
| Entry contents | Product ID · exact mismatch at entry · why repair is blocked · **named owner** · created-at · **expiry date** |
| Maximum life | **7 days.** No extension without a written, owner-signed exception recorded in the runbook |
| On expiry | The assertion **activates regardless**. An expired entry does not silently continue |
| Auto-removal | A product that validates clean is removed **automatically** on the next run — never manually, never left lingering |
| Visibility | A **persistent warning in Inventory Health** listing every entry, its age and its owner. Never a config file nobody reads |
| Creation freeze | **No new entries may be created after M2 ships.** From that point the allowlist can only shrink |
| Empty-state goal | The list reaching zero is an explicit M2 exit criterion |

**[R] The creation freeze is the load-bearing rule.** Expiry alone is insufficient if new entries can be added — the list would simply churn while never emptying. Freezing creation at M2 makes it strictly monotonic toward zero.

**Rollback:** adjustments are ledger-posted and reversible only by compensating adjustments. This is why batches are small and validated. **There is no undo — that is the point of the audit trail.**

**Success:**
- **The reconciliation operation is proven in the emulator to take a nonzero `B − L` to zero while leaving L6 green** — this is the gate that revision 3 could not have passed
- Every drifted product from the M0 baseline is repaired, or is on the residual register with a reason, an owner and an expiry
- Every repair has an evidence sheet, an `inventory_repairs` record, and the correct ledger rows — `RECONCILIATION` for corrections, `ADJUSTMENT` only where stock physically moved
- Post-remediation full validation shows zero CRITICAL P1/L6, or a documented residual set
- H1's explanatory coverage is quantified: what fraction of drifted products had concurrent posting in their history

**PRs:** (1) `RECONCILIATION` type + `inventory_repairs` schema + rules; (2) `reconcileMismatch.ts` with emulator tests **proving the mismatch closes**; (3) the script with dry-run and allowlist; (4) triage and evidence sheets; (5) remediation log; (6) residual register.

---

### Milestone 1 — Make corruption visible

**Goal:** Detect every invariant violation. **Change no write path.**

**Work:** build `invariants.ts` register · restructure `validateInventory.ts` to iterate it · **extend** existing checks (~14 codes already exist **[C]**) to the full register · full and incremental modes with movement-derived discovery (§9) · structured reports to `inventory_validation_runs` · attribution · `first_seen_at` carry-forward · severity model · nightly schedule · dashboard: run button, last-run age with amber past 48h, per-invariant issues, stuck-work queue · **make `invariantCheck` two-sided everywhere**.

**Files:** new `lib/inventory/invariants.ts`; `lib/inventory/validateInventory.ts`; `lib/inventory/invariantCheck.ts`; `scripts/inventory/validate.mjs`, `nightly-validate.mjs`; new `.github/workflows/nightly-validation.yml`; `InventoryHealthDashboard.tsx`; new API route for on-demand validation.

**Risks:** **The two-sided assertion is the only real risk** — it can make posts *fail* on already-drifted products. Correct behaviour, but it must land after M0's baseline and after any pre-existing drift is repaired, or it blocks trading. **[R] Ship the validator first; ship the two-sided transactional assertion as a separate, later PR in this milestone.**

**Rollback:** revert. Validator is additive. The two-sided assertion reverts independently.

**Success:**
- Every register invariant has an **implemented check** and the validator detects a hand-crafted violation of it
- Full and incremental modes produce reproducible reports; incremental falls back to full on a stale or missing watermark
- Overlap, pagination and the completion manifest (§9.5) all working; watermark advances only on a complete manifest
- On-demand endpoint enforces admin-only access, rate limits and the concurrency lock (§9.6)
- Validator provably never writes, verified by running under the read-only identity
- Nightly scheduled and green (or explained) for 3 consecutive nights

> **Moved to M1.5:** *100% behavioural invariant coverage* is **no longer an M1 acceptance condition.** Coverage is a property of the test suite and is meaningless without CI to enforce it — M1 has no CI. M1 requires each invariant to be *implemented and demonstrably detecting*; **M1.5 requires each to be covered by an automated test that fails when the invariant is violated, and enforces that as a merge gate.** Keeping the requirement in M1 would mean either delaying M1 for test infrastructure that belongs in M1.5, or declaring coverage on the honour system — which is precisely the failure mode this plan exists to correct. **[R]**

**PRs:** (1) register; (2) validator restructure onto register; (3) full mode + report schema; (4) incremental mode + discovery + overlap/pagination/manifest; (5) on-demand endpoint with authz and limits; (6) dashboard; (7) nightly workflow; (8) **two-sided assertion, separately and last**.

---

### Milestone 1.5 — Basic CI and safety gate

**Goal:** No mutation-path change begins without a mechanical gate.

**Work:** emulator config in `firebase.json` **[C: absent]** · aggregate `npm test` · GitHub Actions CI · inventory rules tests · unit test consolidation · integration foundation with `assertAllInvariants` · **100% behavioural invariant coverage, enforced** (moved from M1) · **write C1 and prove it fails** · branch protection · **§2.7 ledger rules question** · **the transactional lot-query feasibility spike**.

#### M1.5-S — Transactional lot-query feasibility spike

**This spike gates M2. M2 must not begin until it reports.**

**Why.** §2.2b confirms the client SDK has no `transaction.get(query)` overload **[C]**, so M2's freshness fix rests on Option A: a non-transactional `getDocs` inside the callback, plus `tx.get` on every lot we write, plus the product anchor covering newly-created lots. **Three assumptions in that chain are unverified**, and all three are load-bearing:

| # | Assumption to test | If false |
|---|---|---|
| S1 | A `getDocs` issued inside a transaction callback returns **fresh** data on each retry, not a cached or transaction-pinned snapshot | Option A does not fix staleness at all — **M2's entire approach is invalid** |
| S2 | The product anchor reliably aborts a transaction when a **new lot** is created concurrently for that product | The discovery gap is real and unguarded |
| **S2b** | **Read ordering matters as §11.2.1 predicts**: anchor-first is safe, query-first is not | If anchor-first also fails, the anchor does not cover the query at all — **Option A is invalid** |
| S3 | Query + per-lot `tx.get` stays within the op cap for realistic invoices | Need harder bounds or invoice-size limits |

**Method — all against the emulator, all measured rather than reasoned:**

1. **S1:** force a transaction retry (concurrent writer on the product), log the `getDocs` result on each attempt, assert attempt 2 observes attempt 1's committed change. **If this fails, stop and re-plan M2 around Option B or C.**
2. **S2:** post an invoice while concurrently creating a new lot for the same product; assert the post either aborts and retries (seeing the new lot) or completes with P1 and L6 intact. Run 100 iterations — a race that fails 1 in 50 will not show up in 5.
2b. **S2b — the ordering race, tested both ways.** Build the exact interleaving of §11.2.1 with deterministic barriers, and run it under **both** orderings:
   - **Query-first** (`getDocs` → concurrent stock-in → `tx.get(product)` → commit): this **must be demonstrated to corrupt**. If it does not, our model of Firestore preconditions is wrong and every conclusion resting on the anchor needs re-examination.
   - **Anchor-first** (`tx.get(product)` → `getDocs` → concurrent stock-in → commit): this **must abort and retry**, and the retry must observe the new lot.

   Testing only the safe ordering would confirm nothing — a passing test proves the ordering matters only if the other ordering demonstrably fails. **[R]** 100 iterations each.
3. **S3:** measure actual read/write counts for invoices at 1, 10, 25 and 50 lines against products carrying 1, 10, 50 and 200 lots. Produce the real op-cost formula, replacing the current incorrect `items × 3` estimate **[C]**.
4. **S4 (bonus, cheap):** confirm whether `getDocs` inside a callback counts toward the 500-op transaction budget at all. **[I]** It should not — it is not part of the transaction — but the M2 op accounting depends on the answer.

**Deliverable:** `docs/inventory/SPIKE_TXN_LOT_QUERY.md` — findings, measured numbers, and a go/no-go recommendation for Option A. Throwaway code, kept only as tests where it proves useful.

**Timebox: 2 days.** If S1 or S2 fails, M2 is re-planned before any production code is written — which is the entire purpose of spending the two days.

**Files:** `firebase.json`; `package.json`; new `.github/workflows/ci.yml`; new `test/rules/inventory.rules.test.mjs`; new `test/integration/**`; new `test/helpers/assertAllInvariants.ts`; new `scripts/check-invariant-coverage.mjs`; new `docs/inventory/SPIKE_TXN_LOT_QUERY.md`; **delete `lib/inventory/inventoryConcurrency.test.ts`** (mock-based).

**Risks:** Low on production — no runtime change. Emulator flakiness in CI (pin the version; retry only infrastructure errors). **The real risk is a spike finding that invalidates M2's design** — which is a milestone-planning risk, not a production one, and is far cheaper discovered here.

**Rollback:** N/A — no production code.

**Success:**
- A deliberately broken inventory mutation cannot merge (proven by attempt)
- **100% behavioural invariant coverage, enforced by CI** — every register ID has a test that violates it and proves detection
- **C1 exists and fails against current code**
- CI exercises real functions; the mock suite is deleted
- **§2.7 answered** — the ledger `set`+`update` question is settled
- **M1.5-S reports go or no-go on Option A, with measured numbers**

**PRs:** (1) emulator + aggregate test; (2) CI skeleton; (3) rules tests; (4) integration foundation + helper; (5) **coverage enforcement (moved from M1)**; (6) **C1 (failing, quarantined)**; (7) **spike findings doc**; (8) branch protection.

---

### Milestone 2 — Fix invoice posting

**Goal:** Eliminate the stale-snapshot lost update. **This fixes the incident.**

**Work:** move active-lot loading inside the transaction callback · recompute FIFO per attempt · preserve and assert the anchor · two-sided assertion in this path · fix the op estimate to `lots_spanned + 2` · scope lot queries to `qty_remaining > 0` · add indexes (**deploy first**) · add performance instrumentation (§17) · **no unrelated refactoring**.

**Files:** `lib/firestore/invoices.ts` (`postInvoice` only); `lib/firestore/stockLotsQuery.ts`; `firestore.indexes.json`; new `lib/inventory/postingMetrics.ts`.

**Risks:** **Highest in the plan.** The most complex function, on the path of every sale. Higher latency; more retries; changed op-cap behaviour on large invoices; index dependency.

**Release:** ship **alone**, on the quietest trading day. Indexes deployed and confirmed **before** code. Full validation before; incremental at +15 min; full at +24h. Observe 7 days. **[R] No feature flag** — a flag would mean maintaining both the buggy and fixed paths simultaneously, doubling the surface during the highest-risk release. Rollback is `git revert` + redeploy, which is fast and complete because **no data migration is involved and data written by the fixed path stays correct**.

**Emergency stop:** any new CRITICAL; `retry_count` > 20%; p95 > 10s; any post failure rate above baseline.

**Success:** **C1 fails before and passes after**; C2–C10 pass; 100 concurrent posts leave P1 and L6 intact; no new drift for 7 days; retries < 5%.

**PRs:** (1) indexes alone; (2) instrumentation alone; (3) **the fix**; (4) op-estimate correction.

---

### Milestone 3 — Correct adjustment and discard paths

**Goal:** Every adjustment auditable; discard robust.

**Work:** repoint the main adjustment UI to `postStockAdjustment` · require reason **category + detail** · record before/after · correct `ADJUSTMENT` ledger type · real FIFO cost on outbound adjustments (A4) · discard retry loop · round discard COGS · `repairDiscardLedger` · attribution throughout.

**Files:** `app/components/inventory/StockAdjustModal.tsx`; `app/components/products/StockAdjustControls.tsx`; `lib/inventory/stockAdjustment.ts`; `lib/firestore/inventoryDiscards.ts`; `lib/inventory/repairLedger.ts`; new reason-category enum.

**Risks:** Medium. UI behaviour changes for daily operators — mandatory reason will feel slower. Brief them before release.

**Release:** flag-free; ship adjustment and discard in separate PRs a few days apart.

**Rollback:** per-PR revert. Adjustments already posted remain valid.

**Success:** no active path records shrinkage as a receipt or plain issue; no adjustment without a reason; discard contention handled; register green.

---

### Milestone 4 — Shared mutation primitives (Stage A + Stage B)

**Goal:** Centralise the invariant-critical mechanics **without a big-bang rewrite.**

**Stage A — primitives**, extracted from the now-proven M2 posting path: anchor read · active-lot loading inside the transaction · FIFO selection · FIFO cost · paired lot+product application · two-sided invariant · retry classification · ledger source-ID derivation.

**Stage B — migration, one operation per PR, released and observed independently:**

1. **Stock In** — simplest, already correct; validates the primitive shape
2. **Stock Adjustment** — freshly corrected in M3
3. **Discard**
4. **Return** — most subtle (LIFO unwinding); migrate late
5. **Invoice Void**

**Each migration must have its own regression, integration and concurrency tests merged and green before the next begins.**

**Files:** new `lib/inventory/primitives/*`; then one mutation module per PR; new lint rule restricting stock-field writes by path.

**Risks:** Medium overall, **low per PR** — that is the point of the split. `postReturn` carries the most subtlety.

**Rollback:** per-operation revert; unmigrated paths are untouched.

**Success:** no unauthorised direct stock/lot write remains; lint enforces it; every migrated path has integration + concurrency coverage; **Phase 1 success does not depend on completing Stage B** — each migration is independently valuable and the milestone can stop after any of them.

---

### Milestone 5 — Ledger reliability and cash-safe recovery

**Goal:** Every movement gets its ledger row; retries never overwrite cash.

**Work:** server-side/scheduled outbox dispatcher (idempotent, deterministic IDs, **no stock-write permission**) · stuck-work monitoring · discard ledger repair · acting identity on repairs (`posted_by_uid` is empty on repairs today **[C]**) · real `unit_cost` on sale/return/discard lines · **K4: counter-sale finalize → transactional read-then-write** · K2 rules alignment to the effective total · promote G6 to ERROR.

**Files:** new dispatcher (scheduled function or API route + cron); `lib/inventory/repairLedger.ts`; `lib/inventory/ledgerOutbox.ts`; `lib/firestore/counterSaleReturns.ts`; `lib/firestore/invoices.ts` (ledger line costs); `firestore.rules`; `lib/inventory/inventoryTransactionService.ts` (fold `item_ids` into the initial `set`).

**Risks:** Medium. First scheduled server component. Contained by construction — the dispatcher writes **ledger rows only** and holds no stock-write permission.

**Release:** dispatcher behind a **server-read Firestore config flag** (genuinely runtime, unlike `NEXT_PUBLIC_*`). K4 ships separately from the dispatcher.

**Rollback:** disable via the config flag; manual repair still works.

**Success:** nothing stuck beyond threshold; retried fulfilment creates no duplicate; **cash cannot be silently overwritten**; dispatcher failure cannot corrupt stock; G6 green as ERROR.

---

### Milestone 6 — Audited repair workflow

**Goal:** No correction without evidence, attribution and a ledger row.

**Work:** remove/replace unsafe direct-sync tooling · human-approved repair flow (§15) · evidence category required · validation-run reference required · second approver for `administrative` · `inventory_repairs` collection · automatic scoped re-validation · full repair history in the dashboard.

**Files:** rewrite `scripts/inventory/reconcile-book-stock.mjs`; new `lib/inventory/repairWorkflow.ts`; new repair UI in Inventory Health; `MIGRATION_RUNBOOK.md`; `firestore.rules` for `inventory_repairs`.

**Risks:** Low — dry-run default, cross-project guards already present **[C]**.

**Rollback:** old script retained dry-run-only until the new flow is proven.

**Success:** every correction reconstructable; no tool can silently force one representation to the other; repair never bypasses ledger or attribution; runbook and tooling finally agree.

---

### Milestone 7 — Production hardening

**Goal:** Make regression structurally difficult.

**Work:** finalise risk-based gates (§18) · post-deploy incremental · periodic full · named alert ownership · retention policy (§14) · generated invariant docs · **correct the runtime-vs-build-time rollback documentation** · indexes-before-code enforcement · observation windows · emergency rollback and data-investigation procedures.

**Files:** `.github/workflows/**`; `docs/inventory/RUNBOOK.md`; `.env.example`; generated `docs/inventory/INVARIANTS.md`; `config.ts` comment correction.

**Risks:** Low — process only.

**Success:** inventory code cannot reach production without required tests and validation; **silence is visibly different from success**; rollback instructions are technically accurate; operators can inspect integrity without a developer laptop.

---

## 20. Files expected to change, by milestone

| Milestone | Primary files |
|---|---|
| **M0** | `walkInSessions.ts` (delete) · `sales.ts` (`recordSale` delete) · `AddSaleForm` (delete) · `lotAdmin.ts` (4 exports delete) · `firestore.rules` · `.gitignore` · `firestore-debug.log` (delete) · new `WRITER_INVENTORY.md` |
| **M0.5** | **Temporary code — not documentation-only.** New `scripts/inventory/reconcile-mismatch.mjs` + `lib/inventory/reconcileMismatch.ts` (both **deleted in M6**) · `lib/types/firestore.ts` (`RECONCILIATION` type, `inventory_repairs`) · `firestore.rules` · new `BASELINE_REMEDIATION.md` + evidence sheets + residual register |
| **M1** | new `invariants.ts` · `validateInventory.ts` · `invariantCheck.ts` · `scripts/inventory/*.mjs` · new nightly workflow · `InventoryHealthDashboard.tsx` · new validation API route (authz + limits) |
| **M1.5** | `firebase.json` · `package.json` · new `.github/workflows/ci.yml` · new `test/rules/inventory.rules.test.mjs` · new `test/integration/**` · new `assertAllInvariants.ts` · new `scripts/check-invariant-coverage.mjs` · new `SPIKE_TXN_LOT_QUERY.md` · delete `inventoryConcurrency.test.ts` |
| **M2** | `invoices.ts` (`postInvoice`) · `stockLotsQuery.ts` · `firestore.indexes.json` · new `postingMetrics.ts` |
| **M3** | `StockAdjustModal.tsx` · `StockAdjustControls.tsx` · `stockAdjustment.ts` · `inventoryDiscards.ts` · `repairLedger.ts` |
| **M4** | new `lib/inventory/primitives/**` · then one mutation module per PR · new lint rule |
| **M5** | new dispatcher · `ledgerOutbox.ts` · `repairLedger.ts` · `counterSaleReturns.ts` · `invoices.ts` (ledger costs) · `inventoryTransactionService.ts` · `firestore.rules` |
| **M6** | `reconcile-book-stock.mjs` (rewrite) · new `repairWorkflow.ts` · repair UI · `MIGRATION_RUNBOOK.md` · `firestore.rules` |
| **M7** | `.github/workflows/**` · `RUNBOOK.md` · `.env.example` · generated `INVARIANTS.md` · `config.ts` |

---

## 21. Risks per milestone

| M | Top risk | Severity | Mitigation |
|---|---|---|---|
| 0 | Deleting a reachable path | Medium | Grep + typecheck + build + full smoke |
| 0 | Baseline reveals large drift | Medium | Expected; **M0.5 handles it** |
| **0.5** | **Repairing to the wrong number, cementing the error** | **High** | Physical count preferred; evidence sheet per product; 10-product batches |
| **0.5** | **Drift re-accrues before M2 ships** | **High — expected** | Re-validate immediately before the assertion; accept a second pass |
| **0.5** | Residual set too large for M1's assertion | Medium | Allowlist branch; shrinking and visible |
| 1 | Two-sided assertion blocks trading on existing drift | **High** | Separate PR, last in M1, **after M0.5** |
| 1 | Validator too slow at full scale | Low | Measure in M0 (A4); incremental + pagination |
| 1 | Watermark advances over an incomplete scan | **High** | Completion manifest gates advancement (§9.5.3) |
| 1 | On-demand full scans overwhelm the system during an incident | Medium | Rate limits + concurrency lock (§9.6) |
| 1.5 | Emulator flakiness | Low | Pinned version; retry infra errors only |
| **1.5** | **Spike invalidates M2's design (S1/S2 fail)** | **Medium — planning risk, not production** | Timeboxed 2 days; re-plan before any production code |
| 2 | **Regression in the sale path** | **High** | C1 first; ship alone; quiet day; 7-day watch |
| 2 | Latency / retry increase | Medium | Instrumentation; emergency-stop thresholds |
| 2 | Index missing at deploy | Medium | Indexes in a prior PR, confirmed built |
| 3 | Operator friction from mandatory reason | Low | Brief before release |
| 4 | Primitive abstraction is wrong | Medium | Extract from proven M2 code; Stock In first |
| 4 | `postReturn` migration breaks cost basis | Medium | Migrate last; heaviest test coverage |
| 5 | Dispatcher misconfigured | Medium | Ledger-only permissions; runtime config flag |
| 5 | K4 fix mishandles existing netting | Medium | Emulator tests over real counter-sale fixtures |
| 6 | Repair flow too heavy, gets bypassed | Medium | Only `administrative` needs a second approver |
| 7 | Gates too strict, routed around | Medium | Risk-based; non-inventory PRs stay fast |

---

## 22. Rollback strategy per milestone

| M | Code rollback | Data rollback | Limitation |
|---|---|---|---|
| 0 | `git revert` | None needed | Deleted code is in history |
| **0.5** | Revert the tool (it is never UI-exposed) | **Compensating reconciliation only** | **No undo.** Each repair is ledger-posted; reversal is another reconciliation. Hence dry-run default, verified backup, 10-product batches, validation after each |
| 1 | Revert; assertion reverts separately | None — read-only | Reports remain (harmless) |
| 1.5 | Revert workflow | None | — |
| 2 | `git revert` + redeploy | **None required** — data written by the fixed path is correct | Data written by the **old** path during the window may be drifted; incremental validation over the window finds it |
| 3 | Per-PR revert | None | Adjustments already posted remain valid and correctly typed |
| 4 | Per-operation revert | None | Unmigrated paths untouched |
| 5 | Runtime config flag off | Ledger rows already written are valid and idempotent | Stuck items revert to manual repair |
| 6 | Old script, dry-run only | Repair records are immutable | A completed repair is undone only by a compensating repair |
| 7 | Revert workflow | None | — |

**The general rule: rolling back code does not roll back data.** This is why detection (M1) precedes correction (M2), and why every risky milestone carries an observation window rather than a same-day sign-off.

---

## 23. Success and failure criteria

| M | Success | Failure (stop and reassess) |
|---|---|---|
| 0 | Writers catalogued; dead writers gone; baseline recorded; no data changed | A deleted path proves reachable |
| **0.5** | **Reconciliation proven to close a nonzero mismatch with L6 green**; drift at zero or on an expiring residual register; every repair has an evidence sheet and correct ledger rows; H1 coverage quantified | **The operation cannot close the mismatch** (revision 3's failure); a repair increases drift; history not derivable for a material number of products |
| 1 | Every invariant implemented and detecting; modes working with overlap/pagination/manifest; on-demand controls enforced; validator provably never writes; nightly green 3 nights | Validator writes anything; full run exceeds the nightly window; watermark advances on an incomplete manifest |
| 1.5 | Broken mutation cannot merge; **100% register coverage enforced**; **C1 exists and fails**; real functions under test; **§2.7 answered**; **spike reports go/no-go** | CI routinely bypassed; **spike S1 or S2 fails → M2 re-planned** |
| 2 | **C1 passes**; C2–C10 pass; P1+L6 hold under 100 concurrent posts; no drift for 7 days; retries < 5% | Any new CRITICAL; retries > 20%; p95 > 10s; any new drift |
| 3 | No shrinkage mis-typed; no reasonless adjustment; discard contention handled | Operators bypass the reason requirement |
| 4 | No unauthorised stock write; lint enforces; each migrated path covered | Any migration introduces drift → halt Stage B |
| 5 | Nothing stuck beyond threshold; no duplicate on retry; **cash never overwritten** | Dispatcher writes stock; duplicate ledger rows; any cash loss |
| 6 | Every correction reconstructable; no silent sync tool remains | Operators route around the repair flow |
| 7 | Inventory code cannot reach production ungated; silence ≠ success | Gates routinely overridden |

---

## 24. Recommended pull-request boundaries

**Principles [R]:** one concern per PR · never mix a mutation change with a refactor · indexes and instrumentation ship *before* the change that needs them · anything that can block trading ships alone · a PR that cannot be reverted independently is too big.

| M | PR sequence |
|---|---|
| 0 | 1 rules+gitignore+log · 2 writer inventory · 3 deletions · 4 baseline |
| **0.5** | 1 `RECONCILIATION` type + `inventory_repairs` schema + rules · **2 `reconcileMismatch.ts` + emulator proof the mismatch closes** · 3 script (dry-run + allowlist) · 4 triage+evidence sheets · 5 remediation log · 6 residual register |
| 1 | 1 register · 2 validator onto register · 3 full mode+schema · 4 incremental+discovery+overlap/pagination/manifest · 5 on-demand endpoint (authz+limits) · 6 dashboard · 7 nightly · **8 two-sided assertion (alone, last)** |
| 1.5 | 1 emulator+aggregate test · 2 CI skeleton · 3 rules tests · 4 integration foundation · **5 coverage enforcement (moved from M1)** · **6 C1 failing/quarantined** · **7 spike findings** · 8 branch protection |
| 2 | **1 indexes alone** · 2 instrumentation alone · **3 the fix alone** · 4 op-estimate |
| 3 | 1 reason categories · 2 adjustment repoint+A4 · 3 discard retry+rounding · 4 discard ledger repair |
| 4 | 1 primitives (unused) · 2 Stock In · 3 Adjustment · 4 Discard · 5 Return · 6 Void · 7 lint rule |
| 5 | 1 `item_ids` fold · 2 ledger unit_cost · **3 K4 cash fix alone** · 4 dispatcher · 5 stuck monitoring · 6 discard repair · 7 K2 rules |
| 6 | 1 repair schema+rules · 2 workflow lib · 3 UI · 4 reconcile rewrite · 5 runbook |
| 7 | 1 risk-based gates · 2 post-deploy validation · 3 generated docs · 4 doc corrections · 5 runbook |

---

## 25. Final approval checklist

Before implementation begins:

- [ ] The revised Phase 1 goal (detect-and-repair, not provably-impossible) is accepted
- [ ] Deferral of server-side enforcement to Phase 2/3 is accepted
- [ ] The 20-item non-goal list is accepted
- [ ] Severity assignments in the register are accepted (especially I7/I8 as ERROR, P5 and G6 as WARNING)
- [ ] Movement-derived incremental discovery is accepted, given products have no `updated_at` **[C]**
- [ ] The read-only validator identity can be created in GCP
- [ ] Production reports moving out of Git is accepted
- [ ] Risk-based deploy gating is accepted (no full scan for non-inventory changes)
- [ ] Evidence-based repair authority is accepted, including a second approver for `administrative`
- [ ] The K3 void-cash business rule is confirmed by the business
- [ ] A quiet trading day is identified for M2
- [ ] CRITICAL alert ownership and channel are named
- [ ] The M4 Stage B migration order is accepted
- [ ] It is accepted that Phase 1 succeeds even if Stage B does not complete

**Added in revision 3:**

- [ ] **M0.5 is accepted as a distinct milestone**, including that it repairs through `postStockAdjustment` rather than waiting for M6's workflow
- [ ] It is accepted that **some drift may re-accrue between M0.5 and M2**, and that a second remediation pass may be needed
- [ ] The **allowlist branch** is accepted as the fallback if the residual set is too large for M1's assertion
- [ ] **M1.5-S (the lot-query spike) is accepted as a hard gate on M2**, with a 2-day timebox
- [ ] It is accepted that **a spike no-go re-plans M2** rather than proceeding on the current design
- [ ] **100% invariant coverage moving from M1 to M1.5 acceptance** is accepted
- [ ] The **overlap window (15 min), pagination and completion manifest** design is accepted, including that the watermark advances only on a complete manifest
- [ ] **On-demand validation limits** are accepted: admin-only, incremental by default, 1 full run per hour, single concurrent run
- [ ] It is accepted that the drift mechanism is a **hypothesis (H1)** until C1 proves it, and that language in reports will say so
- [ ] **K3 will be decided by the business before M5 begins** — K3-a, K3-b (recommended) or K3-c
- [ ] **§2.7 is accepted as a blocking prerequisite for all ledger work**, not merely an M1.5 checkbox

**Added in revision 4:**

- [ ] The finding is accepted that **a normal adjustment cannot repair a P1 mismatch** and would have **aborted on the two-sided assertion** **[C]**
- [ ] **§19.0.5-M reconciliation mathematics** is accepted — three separated concepts, derived lot corrections, staged algorithm
- [ ] It is accepted that **lot corrections are derived from consumption history**, not selected by FIFO or operator judgement, and that this is what fixes L6 rather than only P1
- [ ] **`RECONCILIATION` as a distinct, non-movement ledger type** is accepted
- [ ] **The revised G4** (`net book change == Σ movement + Σ reconciliation`) is accepted, plus new **G8**
- [ ] It is accepted that **M0.5 ships temporary code**, not documentation only, and that the tool is **deleted in M6**
- [ ] The **M0.5 tool constraints** are accepted: never UI-exposed, dry-run default, explicit allowlist, max 10 products/run, verified backup, second approval, repair identity only, full validation per batch
- [ ] **Anchor-first read ordering (§11.2.1)** is accepted as mandatory, and **S2b** tests both orderings — including proving the unsafe one corrupts
- [ ] **Allowlist expiry rules** are accepted: 7-day maximum, named owner, auto-removal when clean, persistent dashboard warning, **creation freeze at M2**, empty as an M2 exit criterion
- [ ] It is accepted that **no production repair begins until the reconciliation operation is emulator-proven** to close a nonzero mismatch with L6 green

---

## Architecture Approval Decision

### Is Phase 1 ready for implementation?

**Yes, with one qualification.** The plan is implementation-ready in structure, sequencing and risk control. The qualification is that **three assumptions remain unverified and Milestone 0 exists specifically to settle them.** M0 is deliberately designed so that nothing irreversible depends on those answers: it changes no production data and deletes only code proven unreferenced.

I would not describe any later milestone as ready until M0's baseline exists. The baseline is not a formality — if pre-existing drift is substantial, the M1 two-sided assertion becomes a trading-floor risk rather than a safety improvement, and the sequencing changes.

**Revision 3 changes the answer in one respect.** The eight required additions are incorporated, and one of them surfaced a finding that alters M2's design rather than merely validating it: **the client SDK has no `transaction.get(query)` overload [C]**, so "load lots inside the transaction" cannot mean a transactional query. M2 now rests on Option A (§2.2b), whose three load-bearing assumptions are unverified — which is exactly what M1.5-S exists to settle. **I would not have called M2 ready without that spike, and I would not have known to add it without the review comment.**

### Which milestone should begin first?

**Milestone 0**, and within it, in this order:

1. **Today, independently of approval:** `firestore.rules:934` → `allow read: if isSignedIn()`. One line. It exposes cost prices, stock and margins to the open internet. **[C]** It is not an integrity issue, which is exactly why it should not wait for an integrity plan.
2. **Production baseline validation, read-only.** The validator has apparently never run against production. **[C]** Everything else is measured against this.
3. **Writer inventory and caller trace**, producing `WRITER_INVENTORY.md`.
4. **Deletion of the dead writers**, after the trace proves them unreferenced.

### Which assumptions still need verification?

| # | Assumption | How M0 settles it | Consequence if wrong |
|---|---|---|---|
| **A5** | No residual drift after the 2026-07-10 reconcile | Baseline validation | M1's two-sided assertion must go behind a flag or wait for repair |
| **A3** | Products have at most a few hundred lots | Measure max lots/product | M2's active-lot query needs harder bounds |
| **A4** | Full validation completes in minutes | Time the baseline run | Full goes weekly; incremental carries more weight |
| **A6** | `sales.ts` / `walkInSessions.ts` unreachable | Caller trace | Deletion becomes a behaviour change needing its own plan |
| **A7** | Counter-sale volume low | Count posted counter-sales | Exchange restructuring moves into Phase 1 |
| **§2.7** | `tx.set`+`tx.update` passes the append-only rule | **Emulator test in M1.5 — blocking for all ledger work** | **Every ledger write may be failing now** — halt the sequence, hotfix, re-baseline |
| **K3** | Which void-and-cash rule the business wants | **Business decision, needed in M0, blocking M5** | M5 encodes the wrong behaviour into a live cash path |
| **S1** | `getDocs` inside a transaction callback returns fresh data per retry | **M1.5-S spike** | **M2's entire approach is invalid** — re-plan around Option B or C |
| **S2** | The product anchor aborts on concurrent **new lot** creation | **M1.5-S spike, 100 iterations** | The discovery gap is real and unguarded |
| **S3** | Query + per-lot `tx.get` stays within the op cap | **M1.5-S spike, measured** | Need harder bounds or an invoice-size limit |
| **H1** | The stale snapshot caused the historical drift | **C1 in M2** | Investigation reopens; H2–H5 examined; M2 still ships as a genuine defect fix |

**§2.7 is the one I would check this week regardless of milestone scheduling.** Thirty minutes, and if it fails, the ledger has been silently broken for some time and that reprioritises everything.

### Which changes are too risky to combine in one release?

Never combine:

0. **M0.5's remediation with M1's two-sided assertion.** Repair while the assertion does not yet exist; ship the assertion only once drift is at zero or allowlisted. Combining them means discovering residual drift by watching sales fail.

1. **The M2 posting fix with anything else.** Not instrumentation, not the op-estimate, not a refactor. It ships alone, on a quiet day, after its indexes.
2. **The M1 two-sided transactional assertion with the validator itself.** The validator is inert; the assertion can block sales. Separate PRs, separate releases.
3. **Index deployment with the code that requires it.** Indexes first, build confirmed, then code.
4. **Any two Stage B migrations.** One operation per PR, released and observed before the next.
5. **The M5 dispatcher with the K4 cash fix.** One is new infrastructure, the other is a correctness fix to a live path. Different failure modes, different rollbacks.
6. **M3's adjustment repoint with M3's discard changes.** Both are M3, but they touch different operators and different code; a few days apart.

### Acceptance conditions for milestone transitions

**M0 → M1**
- Baseline recorded and reviewed; drift quantified and either repaired or explicitly accepted with a documented plan
- `WRITER_INVENTORY.md` complete; every writer classified active/inactive/dead
- Dead writers deleted; typecheck, build and full manual smoke green
- Public product read closed
- A3, A4, A7 measured; K3 confirmed
- **No production data changed by M0**

**M0 → M0.5**
- Baseline complete; every drifted product listed with its movement history
- H1–H5 triage complete per product
- Physical-count capability confirmed for the products where it will be used
- **The reconciliation operation is designed, built and emulator-proven BEFORE any production repair.** Specifically, a fixture with `B=100, L=103` must end at `B=L=100` with L6 green and honest ledger rows. **No production repair begins until this test passes** — the whole point of revision 4
- Verified backup exists and is named in the run log

**M0.5 → M1**
- Drift at zero, **or** a residual register exists with a reason, an owner and an **expiry date (max 7 days)** per entry
- Every repair has an evidence sheet and a corresponding `ADJUSTMENT` ledger row
- Post-remediation full validation shows no CRITICAL P1/L6, or a documented residual
- **H1's explanatory coverage quantified** — the fraction of drifted products with concurrent posting in their history. A low fraction reopens the investigation before M2 is designed around H1
- If the residual set is material, the allowlist branch is agreed **in writing** before M1's assertion is scheduled

**M1 → M1.5**
- Every register invariant is **implemented and demonstrably detects** a hand-crafted violation
- Validator demonstrably never writes (verified under the read-only identity)
- Full and incremental modes reproducible; incremental falls back to full on a stale or missing watermark
- **Overlap, pagination and completion manifest working**; watermark advances only on `complete == true`
- **On-demand endpoint enforces admin-only, rate limits and the concurrency lock**
- Nightly green (or explained) for 3 consecutive nights
- Dashboard shows last-run age with the stale warning working
- *(Coverage enforcement is explicitly NOT required here — it moved to M1.5)*

**M1.5 → M2**
- CI green and blocking on `main`
- **C1 written and failing against current code** — the primary gate
- **100% behavioural register coverage, CI-enforced** (moved from M1)
- Rules tests cover inventory collections
- `assertAllInvariants` used by every integration test
- **§2.7 answered** — and if the ledger pattern fails, the sequence is halted and re-planned per §2.7's escalation
- **M1.5-S returns go on Option A**, with measured op counts. **A no-go on S1 or S2 means M2 does not start** — it is re-planned around Option B or C first

**M2 → M3**
- **C1 passes**; C2–C11 pass
- **The P1 allowlist is empty**, and no new entries can be created (creation freeze active)
- 7 days in production with no new P1 or L6 violation
- Retry rate < 5%; p95 within target or a documented, accepted exception
- Full validation green post-release
- No emergency-stop condition triggered

**M3 → M4**
- No active UI path can record an adjustment without a reason category and detail
- All adjustments emit `ADJUSTMENT` with real FIFO cost
- Discard retry and rounding verified under emulator contention
- 7 days production-clean

**M4 Stage A → Stage B**
- Primitives extracted from the proven M2 path, with unit and integration coverage
- Lint rule active and failing on a deliberate violation

**Each Stage B migration → the next**
- That operation has regression, integration and concurrency tests merged and green
- Released and observed for at least 3 days with no new invariant violation
- The register remains 100% covered

**M4 → M5**
- No unauthorised direct stock or lot write remains, or the remainder is documented and scheduled
- **§2.7 is answered** (blocking prerequisite for all ledger work)
- **K3 is decided by the business** — K3-a, K3-b or K3-c — and the decision is recorded in the runbook

**M5 → M6**
- Nothing stuck beyond the approved threshold for 7 days
- Repeated fulfilment provably creates no duplicate
- **K4 verified: a resumed counter-sale finalize cannot overwrite recorded cash** — emulator-proven
- Dispatcher demonstrably cannot write stock (permission-verified, not just code-verified)

**M6 → M7**
- **`reconcile-mismatch.mjs` and `reconcileMismatch.ts` no longer exist in the tree** — M0.5's temporary tool is deleted, its capability absorbed into the audited workflow
- M0.5's `inventory_repairs` records remain readable and continuous with M6's, since both use one schema
- No tool remains that can force `stock_quantity = Σ qty_remaining` without a ledger row
- A full repair cycle demonstrated end-to-end in the emulator: drift → detect → approve → adjust → re-validate green
- Every historical repair since M6 is reconstructable from `inventory_repairs`

**M7 complete**
- An inventory PR without required tests cannot merge (proven by deliberate attempt)
- A stale validation is visibly distinguishable from a successful one in the dashboard
- Rollback documentation is technically accurate — no claim that a `NEXT_PUBLIC_*` change avoids a rebuild **[C: currently false]**
- An operator can inspect integrity without a developer laptop

### Revision 4 — disposition of the review findings

| # | Finding | Verdict | Where |
|---|---|---|---|
| 1 | A normal adjustment preserves `B − L` and cannot repair a mismatch | **Confirmed, and worse than stated** — the two-sided assertion on the post-state would have **aborted the transaction [C]**, making M0.5 unimplementable rather than merely ineffective | §19.0.5-M.1 |
| 2 | Reconciliation mechanics must be defined before M0.5 | **Accepted** — new §19.0.5-M answers all eleven questions: staged algorithm, derived lot selection, three separated concepts, per-case worked examples, ledger semantics, tool lifecycle | §19.0.5-M |
| 3 | Option A's read ordering must be explicit | **Confirmed.** Query-first leaves a real hole: a precondition acquired *after* a competing write cannot protect a query issued *before* it. Anchor-first is now mandatory, with S2b proving both orderings | §11.2.1, M1.5-S |
| 4 | M0.5 must not claim "No code" | **Accepted** — M0.5 ships a temporary, constrained tool, deleted in M6 | §19 M0.5, §20 |
| 5 | The allowlist needs expiry | **Accepted** — 7-day max, named owner, auto-removal, dashboard warning, **creation freeze at M2**, empty as an M2 exit criterion | §19 M0.5 |

**A consequence the review did not ask for but which follows from it:** the `RECONCILIATION` ledger type breaks invariant **G4** as originally written, because a book reconciliation changes `stock_quantity` with no movement line. Under the old wording, *repairing* drift would have registered as a CRITICAL violation. G4 is now a two-term equation and a new **G8** constrains reconciliation rows. **[R]** This is a strengthening — the original had no vocabulary for the difference between goods moving and a number being wrong.

### Revision 3 — disposition of the eight required changes

| # | Required change | Where | Note |
|---|---|---|---|
| 1 | M1.5 transactional lot-query feasibility spike | §19 **M1.5-S**, §2.2b, §11.2 | **Surfaced a design-level finding:** the client SDK has no `transaction.get(query)` **[C]**. M2 re-specified around Option A; the spike now gates it |
| 2 | M0.5 controlled baseline remediation | §19 **M0.5** | Repairs via `postStockAdjustment`, not the reconcile script. Re-accrual risk stated; allowlist fallback defined |
| 3 | Move 100% coverage from M1 to M1.5 | §19 M1 and M1.5 acceptance | Coverage is meaningless without CI to enforce it |
| 4 | Watermark overlap, pagination, completion manifest | §9.5.1–9.5.3 | 15-min overlap justified by commit-vs-start latency; manifest gates watermark advancement and the deploy gate |
| 5 | Authorization and rate limits for on-demand validation | §9.6 | Admin-only, incremental default, 1 full/hour, single concurrent run, read-only identity |
| 6 | Root cause stays a hypothesis until C1 | §2.2 | Relabelled **H1**, with H2–H5 alternatives and explicit falsification criteria |
| 7 | Resolve K3 before M5 | §16.1, M4→M5 gate | Three options presented; **K3-b recommended**; business decision needed in M0 |
| 8 | Confirm ledger `set`+`update` before any ledger refactor | §2.7, M4→M5 gate | Promoted from acceptance item to **blocking prerequisite** with an escalation path |

### Closing judgement

The system's accounting model is professional-grade — FIFO cost layers, preserved cost basis on returns, LIFO unwinding of consumption chunks, an immutable ledger with deterministic idempotency keys. That foundation is worth protecting, and Phase 1 is not about replacing it.

Phase 1 is about three things: **deleting the code that can bypass the model**, **closing the one hole that has already cost real money**, and **switching on the controls that were designed, documented, and never run**.

The largest risk in this plan is not technical. It is that Milestone 2 — a change to the function that posts every sale in a live business — is attempted before Milestone 1.5 gives us the instrument to prove it worked. **C1 failing before the fix is the single most important gate in this document.** Everything else is sequencing around it.

Revision 3 adds a second gate of nearly equal weight. The review comment asking for a lot-query spike turned out to be load-bearing: verifying it revealed that **the client SDK cannot query inside a transaction at all [C]**, which means the previous revision's central M2 instruction was not implementable as written. The fix is straightforward, but the fact that a plan reviewed twice still contained an unimplementable instruction is the argument for spikes generally — and for treating H1 as a hypothesis rather than a conclusion.

Revision 4 adds a third lesson, and it is the least comfortable. The M0.5 repair mechanism was **arithmetically incapable** of its stated purpose, and would have aborted on its first product. It survived two review cycles because it *sounded* right — "repair through the existing audited adjustment path" has the shape of a good answer. The review caught it by doing what no amount of prose review can substitute for: **working the arithmetic on a concrete example.**

`B=100, L=103`, post `−3`, get `97/100`. Twelve characters of arithmetic falsified a paragraph of plausible design.

That is now embedded in the plan as a gate rather than a hope: **M0.5's operation must be emulator-proven to take a nonzero mismatch to zero, on a fixture, before it touches a production product.**

**Status: approved for implementation from Milestone 0.**

- **M0** — approved, begin now
- **M0.5** — approved **in design** (§19.0.5-M); production repair gated on the emulator proof
- **M1, M1.5, M1.5-S** — approved
- **M2** — conditional on M1.5-S returning go, including S2b confirming the read-ordering model
- **M3–M7** — direction approved, subject to milestone gates

Three things could still change the plan materially: the M0 baseline (if drift is large or unexplained by H1), §2.7 (if ledger writes are currently failing), and M1.5-S (if the anchor does not behave as modelled). Each has a defined escalation. **None of them is discovered by more reviewing — they are discovered by measuring**, which is what M0, M1.5-S and the M0.5 emulator proof exist to do.
