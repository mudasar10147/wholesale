# §2.7 answered — the ledger `set`-then-`update` pattern is accepted

**Status:** RESOLVED — 2026-07-21, by emulator test.
**Blocking prerequisite:** [`PHASE1_INTEGRITY_ARCHITECTURE_V2.md`](./PHASE1_INTEGRITY_ARCHITECTURE_V2.md) §2.7.

## The question

`recordInventoryTransactionInTx` ([inventoryTransactionService.ts:77,99](../../lib/inventory/inventoryTransactionService.ts#L77))
writes a ledger header with `tx.set(txnRef, header)` and then, in the **same
transaction**, `tx.update(txnRef, { item_ids })` — against a collection ruled:

```
match /inventory_transactions/{docId} {
  allow read:   if isAdmin();
  allow create: if isAdmin();
  allow update, delete: if false;   // firestore.rules:1012-1016
}
```

If Firestore evaluated that pair as create-**then**-update, `update: if false`
would reject the whole commit and **every ledger write would be silently
failing** — presenting exactly as "stock moved, ledger missing". §2.7 made this
a hard gate on all downstream ledger work because the answer changes what that
work *is* (improving a working ledger vs. restoring a broken one + backfilling).

## The answer

**Accepted.** Firestore evaluates multiple writes to the same document in one
commit as a **single write, typed by whether the document existed before the
commit.** A new doc that is `set` then `update`d in one transaction is evaluated
as one `create`, which passes `allow create: if isAdmin()`. The `update: if false`
clause never fires, because there is no standalone update.

Verified empirically against the real `firestore.rules` under the Firestore
emulator, using the Firebase **Web SDK v12.11.0** client transaction — the exact
production path.

## Evidence

- Test: [test/rules/inventory-ledger.rules.test.mjs](../../test/rules/inventory-ledger.rules.test.mjs)
- Command: `npm run test:rules:inventory` (needs Java + the emulator block in `firebase.json`)
- Result: **6/6 pass.**
  - ✅ `set` header + `set` lines + `update(item_ids)` in one transaction → **accepted**
  - ✅ plain `create` with `item_ids` already folded into the initial `set` → **accepted** (the fix is a safe drop-in either way)
  - ✅ standalone `update` of an existing ledger header → **denied** (append-only / G3 preserved)
  - ✅ `delete` of a ledger header → **denied**
  - ✅ clerk `create` of a header / line → **denied**

## Consequences

- **No hotfix.** §2.7's escalation (ship the `item_ids` fold as a standalone
  hotfix, re-run the M0 baseline, re-plan M5 around ledger backfill) is **not
  triggered.** The ledger is working.
- **M5 remains dispatch-reliability**, not ledger backfill.
- Ledger-related refactors (M5 dispatcher, ledger `unit_cost`, `repairDiscardLedger`,
  M0.5's `RECONCILIATION` rows) are **unblocked** with respect to §2.7.
- **Recommended tidy (not required):** fold `item_ids` into the initial `set` so
  the ledger write is a single `create` with no visible `update` at all. It is a
  trivial change, proven equivalent by the second test, and removes the only
  reason this question could ever be re-asked. Deferred to the M5 ledger work so
  it lands with tests, per §2.7's "no ledger refactor before the gate" — which is
  now satisfied.
