# Invoice Lifecycle Review — Draft → Post → Payment

**Date:** 2026-07-20
**Scope:** `createDraftInvoice`, `updateDraftInvoice`, `postInvoice`, `voidInvoice`, `recordInvoicePayment`, and the returns-settlement interaction with received amounts.
**Verdict:** The posting transaction is carefully engineered and the money math is exact. The **payment side is the weakest link** — a single mutable counter with no history, no idempotency, and no cash entry.

---

## 1. Executive summary

The invoice module is the most disciplined code in the repo. Totals are computed in integer cents with largest-remainder delivery allocation, posting is resumable and idempotent, void reverses lot consumption in exact opposite order, and Firestore rules pin every immutable field on posted invoices.

Five structural problems:

| # | Finding | Severity |
|---|---|---|
| 4.1 | `recordInvoicePayment` is not idempotent and stores no payment history | **CRITICAL** |
| 4.2 | `updateDraftInvoice` large path is non-atomic — deletes commit before the transaction | **HIGH** |
| 4.3 | Posting reads only *predicted-dirty* lots inside the transaction | **HIGH** (same root as inventory review §3.1) |
| 4.4 | `finalizeCounterSaleReturns` **overwrites** `paid_amount` rather than incrementing | **HIGH** |
| 4.5 | Cash-in-hand counts `paid_amount` but no `cash_entries` doc is ever written | **MEDIUM** |

Grades:

| Dimension | Grade | Notes |
|---|---|---|
| Money arithmetic (totals, discount, delivery) | **A** | Integer cents, largest-remainder allocation, provably exact |
| Posting transaction design | **B+** | Resumable, idempotent, op-budgeted — undermined by the stale-lot window |
| Draft editing | **C** | Full delete-and-rewrite; large path not atomic |
| Void | **B** | Correct lot reversal; leaves `sales`/`invoice_item_cogs` behind |
| **Payment / received amount** | **D** | No history, no idempotency, no cash entry, no method captured |
| Firestore rules coverage | **B** | Genuinely tight field pinning; two guards use the wrong total |

---

## 2. Creation — the draft

`createDraftInvoice` — [invoices.ts:333](../../lib/firestore/invoices.ts#L333)

### 2.1 Numbering

**The invoice document ID *is* the order ID.** There is no counter collection.

`createOrderId()` — [AddInvoiceForm.tsx:67](../../app/components/invoices/AddInvoiceForm.tsx#L67):

```ts
return `INV-${y}${m}${d}-${rand}`;   // rand = 1000..9999
```

Uniqueness is enforced inside the transaction by reading the doc first ([:375](../../lib/firestore/invoices.ts#L375)) → `"Order ID already used. Choose another."`. **The form does not auto-regenerate on collision** — the user is told to pick another ID by hand. At ~90 invoices/day the birthday probability of at least one same-day collision is already >30%.

There is no gapless sequence, so a missing invoice number is undetectable — the same audit weakness noted for `transaction_number` in the inventory review §3.13.

### 2.2 Validation ladder

Three layers, in order:

1. **Pure** — `assertValidCreateInvoiceInput` [contracts.ts:139](../../lib/validation/contracts.ts#L139): non-empty customer, ≥1 line, non-negative finite money, notes ≤500 chars, **duplicate-product guard**, per line `Number.isInteger(quantity) && quantity > 0`, and `line_discount <= quantity * unit_price`.
2. **Preflight (non-transactional)** — `preflightValidateDraftInvoiceLines` [:296](../../lib/firestore/invoices.ts#L296): customer exists and `is_active`; every product exists; `line.quantity > product.stock_quantity` → `"Not enough stock for …"`.
3. **Transactional re-check** — customer existence and active flag are read again inside the transaction ([:370](../../lib/firestore/invoices.ts#L370)).

**The stock check is advisory only.** It is skipped entirely when `options.allowInsufficientStockForDraft === true` ([:319](../../lib/firestore/invoices.ts#L319)), which the UI exposes as a "Force save draft & print" button ([AddInvoiceForm.tsx:695](../../app/components/invoices/AddInvoiceForm.tsx#L695)). And **drafts reserve nothing** — two clerks can each pass the check on the same last unit; only one will post.

### 2.3 Totals

`calculateInvoiceSummary` — [calculations.ts:76](../../lib/invoices/calculations.ts#L76). All arithmetic in **integer cents** (`toCents = Math.round(n*100)`):

- `line_discount` clamped to `min(line_discount, quantity * unit_price)`
- `subtotal_amount = Σ max(0, base − discount)`
- **Delivery is allocated pro-rata by net cents** via `allocateByWeight` ([:36](../../lib/invoices/calculations.ts#L36)) — floor plus largest-remainder, so allocations sum to the delivery total exactly. All-zero weights put the whole charge on line 0.
- `total_amount = max(0, subtotal − invoiceDiscount + delivery)`

This is the correct way to do it and it is done correctly. One consequence worth documenting: the invoice-level `discount_amount` is **not** pushed down to lines, so `Σ line_total ≠ total_amount` whenever an invoice discount exists. Any report summing `invoice_items.line_total` will overstate revenue.

### 2.4 What is written

`invoices/{orderId}` ([:386](../../lib/firestore/invoices.ts#L386)):

```ts
status: "draft",  payment_status: "unpaid",  paid_amount: 0,
stock_reversal_applied: false,
item_ids: itemRefs.map(ref => ref.id),
subtotal_amount, discount_amount, delivery_charge, total_amount,
...returnFields,                  // return_lines, returns_credit_amount (conditional)
created_at, updated_at
```

Line refs are minted **client-side before the transaction**, so `item_ids` can be set in the same write — a neat trick that avoids a second round trip. `ledger_status` and all `posted_*` fields are absent on drafts.

Transaction-size guard: `3 + lines.length > 500` → throws ([:361](../../lib/firestore/invoices.ts#L361)).

---

## 3. Draft editing

`updateDraftInvoice` — [invoices.ts:456](../../lib/firestore/invoices.ts#L456)

**Lines are not diffed. Every line is deleted and rewritten with a new auto-ID.**

`order_id` is immutable ([:469](../../lib/firestore/invoices.ts#L469)). Everything else — customer, lines, discount, delivery, notes, return lines — can change. Absent return lines are removed with explicit `deleteField()` ([:477](../../lib/firestore/invoices.ts#L477)), which is correct and easy to get wrong.

### 3.1 HIGH — the large path is not atomic

[:510–579](../../lib/firestore/invoices.ts#L510). When `3 + oldItems + newItems > 500`, old items are deleted in `writeBatch` chunks that **commit outside any transaction**, then a separate transaction writes the new lines.

> **Failure scenario.** A 200-line draft is edited to 350 lines. The batch deletes commit; the browser tab is closed before the transaction runs. The invoice now has `item_ids` pointing at deleted documents. Posting it fails with `"Invoice items are incomplete. Please recreate draft."` and there is no repair path — the draft must be rebuilt by hand from the customer's memory.

### 3.2 Side effects of the rewrite

- Every line gets a fresh `created_at: serverTimestamp()` ([:573](../../lib/firestore/invoices.ts#L573)). **Original line creation time is destroyed on every edit.**
- `payment_status` and `paid_amount` are unconditionally reset ([:615](../../lib/firestore/invoices.ts#L615)) — harmless today because drafts cannot be paid, but it is a reset that depends on an invariant enforced elsewhere.

---

## 4. Posting

`postInvoice` — [invoices.ts:646](../../lib/firestore/invoices.ts#L646). This is the most complex function in the repo, and the shape is driven by two Firestore constraints: all reads must precede all writes, and a transaction caps at ~500 operations.

### Phase A — auth and pre-checks ([:647](../../lib/firestore/invoices.ts#L647))

Token refresh (`getIdToken(false)` — note void uses `true`), status gate, item fetch with `item.invoice_id === trimmedId` cross-check.

**Resume path** ([:700](../../lib/firestore/invoices.ts#L700)): if the invoice is *already* `posted`, the function re-runs only `fulfillInvoiceSaleLedger` and, if needed, `finalizeCounterSaleReturns`, then returns. This makes posting safely retryable after a ledger or returns failure — a genuinely good design decision.

### Phase B — preflight simulation ([:708](../../lib/firestore/invoices.ts#L708))

1. Fetch all lots per product, all products.
2. Book-stock check against `product.stock_quantity`.
3. `assertBookStockMatchesLots` ([:95](../../lib/firestore/invoices.ts#L95)) — **fires only when `book > lotTotal`**. Lots exceeding book stock pass silently and FIFO consumes the phantom units. (Inventory review §3.2; all 43 drifted products in production were this direction.)
4. FIFO sort ascending by `received_at.toMillis()`, missing timestamps → `0`, no tiebreaker.
5. `simulateFifoForDirtyEstimate` ([:234](../../lib/firestore/invoices.ts#L234)) — replays the drain on a clone and diffs, yielding `dirtyEstimate: Set<lotId>`.
6. Op-count guard ([:771](../../lib/firestore/invoices.ts#L771)): `1 + items + products + dirtyLots + items*3 + dirtySize + products + 1`. The `items*3` term allows exactly one `lot_consumptions` doc per line; real cost is `lots_spanned + 2`, so a line spanning ≥2 lots undercounts.

### Phase C — the transaction ([:787](../../lib/firestore/invoices.ts#L787))

Reads: invoice (posted → silent `return`, treating a concurrent post as success) → items → products (stock re-checked) → **only the predicted-dirty lots** → per-product invariant re-assert.

**HIGH — the stale-lot window.** [:855–872](../../lib/firestore/invoices.ts#L855):

```ts
const lotsByProductId = cloneLotsByProductForSimulation(preflightLotsByProduct);
for (const lotId of dirtyLotIdsToRead) {
  const lotSnap = await tx.get(doc(db, COLLECTIONS.stockLots, lotId));
  ...
}
```

Lots the simulation did *not* predict enter the FIFO drain from the **preflight snapshot**, which was read before the transaction and is never re-read on retry — the whole estimate is computed outside `runTransaction`. A lot written from stale data carries no optimistic-concurrency precondition, so a concurrent decrement to it is silently erased. Full failure scenario in the inventory review §3.1; the production signature is 43 products / 234 units of `lotSum > book` drift.

Writes, in order:

1. **Product decrement** ([:884](../../lib/firestore/invoices.ts#L884)) — `stock_quantity: currentStock - qtyNeeded`.
2. **Per item**: greedy FIFO drain writing `lot_consumptions/{autoId}` per (item, lot) segment, `sales/{autoId}`, and `invoice_item_cogs/{invoice_item_id}` (deterministic ID). COGS is `roundMoney2(unit_cost * take)` per chunk, summed then rounded.
3. **Lot writes** ([:982](../../lib/firestore/invoices.ts#L982)) — diffed against `initialLotQtyMap`.
4. **Status flip** ([:996](../../lib/firestore/invoices.ts#L996)) — `status: "posted"`, `ledger_status: "pending"`, and the immutable `posted_*` financial snapshot.

Note the deliberate non-rounding of `unit_cost` on `sales` rows ([:941](../../lib/firestore/invoices.ts#L941)):

> `// Must match Firestore rule approxMoneyEq(cogs_amount, quantity * unit_cost_snapshot).`
> `// Do not use roundMoney2 here: qty * round(cogs/qty) can differ from cogs by > $0.05 on large lines.`

That comment is exactly right, and it is the kind of thing that gets "cleaned up" by a well-meaning refactor. Leave it.

### Phase D — after commit ([:1015](../../lib/firestore/invoices.ts#L1015))

`fulfillInvoiceSaleLedger` runs **in the browser after the transaction commits**. It writes `unit_cost: 0` on every line ([:106](../../lib/firestore/invoices.ts#L106)) — so the ledger records quantities but not money, and COGS is not derivable from the record that exists to prove it. On failure it marks `ledger_status: "failed"` and throws with stock already committed; recovery requires a human clicking Repair in Inventory Health.

**Posting does not touch `paid_amount`.** A posted invoice is always fully unpaid until someone records a payment separately.

---

## 5. Void

`voidInvoice` — [invoices.ts:1209](../../lib/firestore/invoices.ts#L1209)

Blocked if any posted return exists ("Credit remaining items with returns instead of voiding the whole sale") or any draft return is open. Drafts short-circuit to a status flip with no stock work.

For posted invoices: consumptions are sorted **descending by `created_at`** — reversed in the opposite order of consumption — and restoration is netted against `return_lot_restorations` and `return_lot_write_offs`, with a `next > qty_in` guard. Then `paid_amount: 0`, `payment_status: "unpaid"`, `void_ledger_status: "pending"`.

**Not undone:** `sales` rows and `invoice_item_cogs` docs survive the void. Only `lot_consumptions.reversed_at` marks the reversal. **Every downstream revenue and COGS report must filter voided invoices itself** — if any report forgets, voided sales inflate the numbers. This is a footgun worth either fixing (write reversing `sales` rows) or documenting loudly.

There is no `voidReturn` at all (inventory review §3.11).

---

## 6. Received amount — the payment path

**There is no `received_amount` field.** The canonical field is `paid_amount` on the invoice, with a derived `payment_status`. There is **no payments collection, no receipts collection, no `payment_method`, no payment date, and no stored customer balance.**

### 6.1 Capture

`RecordInvoicePaymentModal` — [RecordInvoicePaymentModal.tsx](../../app/components/invoices/RecordInvoicePaymentModal.tsx). The entire form state is one string:

```ts
const [amountInput, setAmountInput] = useState("");
```

Prefilled to the full amount due. No date, no method, no reference number. Two call sites — [InvoiceDraftList.tsx:649](../../app/components/invoices/InvoiceDraftList.tsx#L649) and [InvoiceDetailView.tsx:1007](../../app/components/invoices/InvoiceDetailView.tsx#L1007) — both call `recordInvoicePayment(getDb(), id, amount)`.

`AddInvoiceForm` and `EditDraftInvoiceForm` capture no payment at all. Drafts are always created unpaid.

### 6.2 The write

`recordInvoicePayment` — [invoices.ts:1036](../../lib/firestore/invoices.ts#L1036):

```ts
const paidNow = getInvoicePaidAmount(invoice);
const nextPaid = roundMoney2(paidNow + amount);
tx.update(invoiceRef, {
  paid_amount: nextPaid,
  payment_status: derivePaymentStatus(invoice, nextPaid),
  updated_at: serverTimestamp(),
});
```

Guards: void rejected, non-posted rejected, nothing-due rejected, `amount > amountDue + 0.01` rejected.

**This writes one field on one document. That is the entire payment system.**

### 6.3 CRITICAL — no idempotency, no history

There is **no payment ID, no dedupe key, and no audit row**. Consequences:

> **Failure scenario.** A customer pays £500 against a £1,000 invoice. The clerk clicks Record; the write lands but the response is lost to a flaky connection. The UI shows an error. The clerk clicks again. `paid_amount` is now £1,000 and the invoice reads **paid in full**. The over-payment guard does not fire, because £500 ≤ £500 due. The business is out £500 with no record that two payments were taken.

The guard only catches double-submits when the amount exceeds the remaining due — i.e. it catches full payments and misses partial ones, which is backwards from what you want.

Equally: with only a running total stored, **payment history is unrecoverable**. You cannot answer "when did this customer pay?", "how many instalments?", "was it cash or transfer?", or "who took the money?" — none of it is written anywhere. For a wholesale business extending credit, that is the single most important thing to be able to answer.

`markInvoicePaid` ([:1158](../../lib/firestore/invoices.ts#L1158)) is **dead code with no callers**.

### 6.4 Derived balance

No stored balance exists. `CustomerDoc` ([firestore.ts:200](../../lib/types/firestore.ts#L200)) has no balance field. Exposure is recomputed on read from invoice docs via [invoiceEffective.ts](../../lib/invoices/invoiceEffective.ts):

- `getInvoicePostedTotal` = `posted_total_amount ?? total_amount`
- `getInvoiceEffectiveTotal` = `max(0, postedTotal − returned_amount)`
- `getInvoicePaidAmount` = **clamps** stored `paid_amount` into `[0, effectiveTotal]` on read
- `getInvoiceAmountDue` = `max(0, effective − paid)`
- `derivePaymentStatus` = unpaid / partial / paid with a 0.01 tolerance

**This is the right call.** Nothing is denormalized, so nothing can drift. The cost is that every customer-balance view ([CustomerLedgerTable.tsx:110](../../app/components/customers/CustomerLedgerTable.tsx#L110), [CustomerKpiCards.tsx:60](../../app/components/customers/CustomerKpiCards.tsx#L60)) scans that customer's invoices — fine at current scale, a problem at 50k invoices.

Note the read-time clamp in `getInvoicePaidAmount` has **no rules equivalent** (see §6.6), so the stored value can legitimately exceed what the app will ever display.

### 6.5 MEDIUM — cash in hand counts money that has no cash entry

`loadCashInHand` — [loadCashInHand.ts:73](../../lib/finance/loadCashInHand.ts#L73):

```ts
const paid = typeof inv.paid_amount === "number" ? inv.paid_amount : 0;
```

Documented at [:33](../../lib/finance/loadCashInHand.ts#L33) as "Invoice revenue uses collections (`paid_amount`), not posted line totals."

So cash-in-hand moves the instant `recordInvoicePayment` runs — **but no `cash_entries` document is ever written**. Two independent sources of cash truth are summed together, and one of them has no per-event record. A cash-drawer reconciliation cannot itemise the invoice half. It also means every payment is implicitly cash: a bank transfer inflates cash in hand identically, because no method is captured.

### 6.6 Firestore rules

[firestore.rules](../../firestore.rules). The posted-invoice update path dispatches to exactly one deep validator ([:718](../../firestore.rules#L718)), an explicit workaround for Firestore's 1000-expression cap:

```
req.status == 'void' ? invoicePostedToVoidOnly
  : invoiceReturnedAmountChanged ? invoicePostedReturnAdjustmentOnly
  : (req.discount_amount != res.discount_amount) ? invoicePostedDiscountUpdateOnly
  : invoicePostedPaymentUpdateOnly
```

`invoicePostedPaymentUpdateOnly` ([:387](../../firestore.rules#L387)) pins customer, order, `item_ids`, and every money field, and enforces **monotonic increase** — `req.paid_amount >= res.paid_amount` — with a carve-out permitting a decrease only when `returned_amount` is non-zero and unchanged (the cash-refund case). This is genuinely well-constructed.

Two gaps:

- `validInvoiceBase` guards `paid_amount <= total_amount` ([:145](../../firestore.rules#L145)) while the payment validator guards `paid_amount <= posted_total_amount` ([:407](../../firestore.rules#L407)). For a posted invoice carrying returns these differ, and **rules permit `paid_amount` up to the pre-return posted total** — above the effective total the app clamps to on read.
- **Payment writes are admin-only.** Clerks get `invoiceDraftToDraftOnly` ([:1040](../../firestore.rules#L1040)); all posted-invoice updates sit behind `isAdmin()` ([:1041](../../firestore.rules#L1041)). A clerk cannot take a payment. Given that in a small wholesaler every owner-operator is admin anyway, this restricts the wrong people.

### 6.7 Returns settlement vs. received amount

`InvoiceReturnSettlementType = "reduce_balance" | "cash_refund" | "credit_note"` ([firestore.ts:335](../../lib/types/firestore.ts#L335)). In `postReturn` ([invoiceReturns.ts:862](../../lib/firestore/invoiceReturns.ts#L862)):

| Type | Effect on `paid_amount` | Effect on due |
|---|---|---|
| `reduce_balance` | untouched | `returned_amount` rises → effective total falls → due falls |
| `cash_refund` | **decremented** by the refund | money handed back; guarded by `refundAmount > paidNow + 0.01` → "Cash refund exceeds amount paid on this invoice" |
| `credit_note` | untouched on the original | credit lands on a counter-sale invoice instead |

`cash_refund` is the only path that lowers `paid_amount` on a live invoice, and it is precisely what the rules' `returned_amount`-guarded decrease exemption exists to permit. The two are correctly matched.

`suggestSettlementType` ([:933](../../lib/firestore/invoiceReturns.ts#L933)) defaults to `cash_refund` if anything is paid, else `reduce_balance`.

### 6.8 HIGH — counter-sale netting clobbers manual payments

`finalizeCounterSaleReturns` — [counterSaleReturns.ts:193](../../lib/firestore/counterSaleReturns.ts#L193):

```ts
await updateDoc(invoiceRef, {
  paid_amount: summary.applied_credit,
  ...
});
```

This is an **assignment, not an increment**. It also runs *after commit*, outside any transaction, via `updateDoc`.

> **Failure scenario.** A counter sale posts. `finalizeCounterSaleReturns` fails partway (network drop) leaving `returns_post_status: "pending"`. The clerk takes £200 cash and records it — `paid_amount = 200`. Someone later reopens the invoice, triggering the resume path at [invoices.ts:700](../../lib/firestore/invoices.ts#L700), which re-runs `finalizeCounterSaleReturns`. `paid_amount` is overwritten with `applied_credit` and **the £200 disappears**.

Excess credit becomes a cash-out at the deterministic ID `cash_entries/counter-refund-{invoiceId}` — that part *is* idempotent, which makes the non-idempotent `paid_amount` write next to it look like an oversight rather than a decision.

---

## 7. Recommendations

### Do this sprint

1. **Make `recordInvoicePayment` idempotent and give it a history (6.3).** Add an `invoice_payments` collection: `{ invoice_id, amount, method, received_at, received_by_uid, note }` with a **client-generated deterministic doc ID** so retries collapse. Write the payment doc and update `paid_amount` **in the same transaction**, deriving `paid_amount` as the sum. This one change fixes the double-charge, restores payment history, and enables the cash-entry fix below at no extra cost.
2. **Capture payment method and date.** The modal needs three more fields. Without method, cash-in-hand is wrong for every non-cash payment (6.5).
3. **Make the counter-sale finalize increment, not assign (6.8)** — or better, move it inside a transaction that reads `paid_amount` first.
4. **Make `updateDraftInvoice`'s large path safe (3.1).** Either reject edits above the op cap outright with a clear message, or write a repair path for orphaned `item_ids`.
5. **Fix the lost-update in posting (4.3)** — move lot loading inside `runTransaction` and `tx.get` every lot of every affected product, so retries re-read fresh data. Fix the op estimate at [:771](../../lib/firestore/invoices.ts#L771) to `lots_spanned + 2`.
6. **Make `assertBookStockMatchesLots` two-sided** — use `!==`, matching `assertStockLotInvariant`.
7. **Align the rules' payment ceiling** — `invoicePostedPaymentUpdateOnly` should cap at the effective total (posted minus returned), not `posted_total_amount` (6.6).

### Do this quarter

8. **Write real `unit_cost` on sale ledger lines** ([:106](../../lib/firestore/invoices.ts#L106)) — the FIFO cost is known at that point. Until then the ledger cannot value anything.
9. **Auto-regenerate order IDs on collision** in the form, and move to a real sequence when convenient (2.1).
10. **Decide what void does to `sales` rows (5).** Either write reversing rows or add a loud shared helper every report must use.
11. **Let clerks record payments** (6.6) behind a dedicated rule, rather than requiring admin.
12. **Add `voidReturn`** — `firestore.rules:465` already anticipates it.

---

## 8. Bottom line

The **sell side is engineered properly**: integer-cent money, largest-remainder delivery allocation, a resumable idempotent post, FIFO cost layering with per-chunk COGS, and a rules layer that pins every immutable field on a posted invoice. The deliberate non-rounding comment at [invoices.ts:941](../../lib/firestore/invoices.ts#L941) is the mark of someone who actually hit the bug and understood it.

The **collect side has not been built to the same standard.** Recording a payment writes one number to one field, with no ID, no history, no method, no date, no cash entry, and no protection against being written twice or being silently overwritten by the counter-sale outbox. For a business that extends credit, "how much has this customer paid us and when" is the question the system exists to answer, and right now it can only answer the first half.

The fix is small and self-contained: an `invoice_payments` collection with deterministic IDs, written in the same transaction as the `paid_amount` update. Do that first — it closes the double-charge hole, restores the audit trail, and makes the cash-in-hand and counter-sale problems tractable rather than structural.
