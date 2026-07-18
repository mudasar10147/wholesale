# Inventory stress testing

## What runs in CI (no emulator)

```bash
npm run test:inventory-stress
```

[`lib/inventory/inventoryConcurrency.test.ts`](../lib/inventory/inventoryConcurrency.test.ts) verifies:

- Deterministic ledger document IDs (concurrent duplicate prevention)
- FIFO oldest-first consumption
- Last-stock double-sale rejection (serialized)
- 20 sequential consumptions without negative balances
- Idempotency key collapse under 20 parallel logical writers

## What requires Firebase Emulator (optional)

Full concurrent Firestore tests (20 parallel `postInvoice`, transaction abort/retry) need:

1. `firebase emulators:start --only firestore,auth`
2. A script that spawns N parallel Admin SDK writers against the emulator

This is **not** wired in CI by default — run manually before major releases.

## Nightly validation

```bash
npm run validate:inventory:nightly
```

Fails CI/cron if validation errors > 0.

## Recovery without manual DB edits

| Failure | Stock state | Ledger state | Recovery |
|---------|-------------|--------------|----------|
| Stock tx fails | Rolled back | Not written | Retry post |
| Stock ok, ledger fails | Committed | `ledger_status: failed` | Inventory Health → Repair |
| Already posted, ledger missing | Committed | `pending` / `failed` | Re-open post (idempotent) or Repair |
| Concurrent duplicate fulfill | Committed | Single `ldg_*` doc | Deterministic ID prevents duplicate |

## Retry policy

| Path | Max attempts | Backoff |
|------|--------------|---------|
| stockIn / stockOut / adjustment | 3 | None (immediate) |
| fulfillLedgerOutbox | 3 | 0ms, 100ms, 300ms |

Failed ledgers remain visible via `ledger_status: failed` and Inventory Health dashboard.
