# Writer Inventory — every code site that mutates stock

**Milestone 0 deliverable** (Phase 1 inventory integrity). See
[`PHASE1_INTEGRITY_ARCHITECTURE_V2.md`](./PHASE1_INTEGRITY_ARCHITECTURE_V2.md) §2.5, §10.

**Purpose.** A single catalogue of every site that writes stock state, with its ultimate
caller traced and a classification. Anything writing `products.stock_quantity`,
`stock_lots.qty_remaining` / `qty_in`, `lot_consumptions`, or the `inventory_transactions`
ledger appears here. If a new write site is added, it must be added here in the same PR.

**Date:** 2026-07-21. Line numbers are current as of this revision.

## Classification legend

| Tag | Meaning |
|---|---|
| **ACTIVE** | Reachable from a live UI component / API route / operational script |
| **INACTIVE** | Compiled and reachable in principle, but hard-gated off (`assertLegacyInventoryApiAllowed`, `directLotEditsDisabled`, shadow mode) |
| **DEAD** | No caller anywhere in `app/`, `lib/`, `scripts/` |
| **DELETED-M0** | Was DEAD and has been removed in this milestone |

## In-transaction legend

**TX** = inside a `runTransaction` callback · **BATCH** = admin-SDK `writeBatch` (scripts only) · **NONE** = plain `updateDoc`/`setDoc`.

---

## 1. `products.stock_quantity` (book stock)

| Site | Write | TX | Function (exported) | Ultimate caller | Class |
|---|---|---|---|---|---|
| [inventory.ts:109](../../lib/firestore/inventory.ts#L109) | `increment(qty)` | TX | `applyStockInInTransaction` | `stockIn` ← [StockAdjustControls.tsx:90](../../app/components/products/StockAdjustControls.tsx#L90); `createProduct` ← [AddProductForm.tsx:92](../../app/components/products/AddProductForm.tsx#L92) | ACTIVE |
| [inventory.ts:332](../../lib/firestore/inventory.ts#L332) | `increment(-qty)` | TX | `stockOut` | [StockAdjustControls.tsx:113](../../app/components/products/StockAdjustControls.tsx#L113) | ACTIVE |
| [invoices.ts:888](../../lib/firestore/invoices.ts#L888) | `currentStock - qtyNeeded` (blind) | TX | `postInvoice` | [InvoiceDraftList.tsx:311](../../app/components/invoices/InvoiceDraftList.tsx#L311), [InvoiceDetailView.tsx:574](../../app/components/invoices/InvoiceDetailView.tsx#L574) | ACTIVE |
| [invoices.ts:1411](../../lib/firestore/invoices.ts#L1411) | `nextStock` (restore on void) | TX | `voidInvoice` | InvoiceDraftList / InvoiceDetailView | ACTIVE |
| [invoiceReturns.ts:826](../../lib/firestore/invoiceReturns.ts#L826) | `nextStock` (restock on return) | TX | `postReturn` | Return forms; also `finalizeCounterSaleReturns` inside post path | ACTIVE |
| [inventoryDiscards.ts:258](../../lib/firestore/inventoryDiscards.ts#L258) | `increment(-qty)` | TX | `postInventoryDiscard` | [DiscardInventoryForm.tsx:115](../../app/components/inventory/DiscardInventoryForm.tsx#L115) | ACTIVE |
| [stockAdjustment.ts:90](../../lib/inventory/stockAdjustment.ts#L90) | `increment(qty)` (positive) | TX | `postStockAdjustment` | [ProductLotsModal.tsx:216](../../app/components/products/ProductLotsModal.tsx#L216) | ACTIVE |
| [stockAdjustment.ts:158](../../lib/inventory/stockAdjustment.ts#L158) | `increment(-qty)` (negative) | TX | `postStockAdjustment` | ProductLotsModal | ACTIVE |
| [products.ts:98](../../lib/firestore/products.ts#L98) | `stock_quantity: 0` (init) | TX | `createProduct` | AddProductForm | ACTIVE |
| `sales.ts:57` | `increment(-qty)`, **no lot write** | TX | `recordSale` | `AddSaleForm` | **DELETED-M0** |
| `walkInSessions.ts:215` | `increment(-qty)`, **no lot write** | TX | `approveWalkInSession` | none | **DELETED-M0** |
| `walkInSessions.ts:327` | `increment(+qty)`, **no lot write** | TX | `deleteApprovedWalkInSession` | none | **DELETED-M0** |
| `lotAdmin.ts:158` | `stock_quantity: Σ lot qty` (forced) | TX | `syncProductStockFromLots` | none | **DELETED-M0** |
| `lotAdmin.ts:234` | `stock_quantity: Σ lot qty` (forced) | TX | `deleteLotAndSyncProduct` | none | **DELETED-M0** |

### Scripts (admin SDK, outside the app — bypass Firestore rules)

| Site | Write | Class |
|---|---|---|
| [reconcile-book-stock.mjs:190](../../scripts/inventory/reconcile-book-stock.mjs#L190) | `stock_quantity = r.lotSum` via `batch.update`, **no ledger/reason/uid** | ACTIVE (CLI, `--apply`) — **the tool that caused the 2026-07-10 drift; stays dry-run-only until replaced in M6** |
| [backfill-opening-lots.cjs:142](../../scripts/backfill-opening-lots.cjs#L142) | reads `stock_quantity` only; writes the lot, not the product | ACTIVE (CLI) |

---

## 2. `stock_lots` — `qty_remaining`, `qty_in`

`qty_in` is written **only** at lot creation (Firestore rules lock it immutable on update). No standalone `qty_in` mutation exists.

### Lot creation (sets `qty_in` + `qty_remaining` together)

| Site | TX | Function | Caller | Class |
|---|---|---|---|---|
| [inventory.ts:117-121](../../lib/firestore/inventory.ts#L117) | TX | `applyStockInInTransaction` (`stock_in` lot) | `stockIn`, `createProduct` | ACTIVE |
| [stockAdjustment.ts:78-82](../../lib/inventory/stockAdjustment.ts#L78) | TX | `postStockAdjustment` (`adjustment` lot) | ProductLotsModal | ACTIVE |
| [backfill-opening-lots.cjs:254](../../scripts/backfill-opening-lots.cjs#L254) | BATCH | `main` (`opening_balance` lot) | CLI `--apply` | ACTIVE (script) |

### `qty_remaining` mutation

| Site | TX | Function | Class |
|---|---|---|---|
| [inventory.ts:336](../../lib/firestore/inventory.ts#L336) | TX | `stockOut` (FIFO deduct) | ACTIVE |
| [invoices.ts:990](../../lib/firestore/invoices.ts#L990) | TX | `postInvoice` (FIFO consume) | ACTIVE |
| [invoices.ts:1397](../../lib/firestore/invoices.ts#L1397) | TX | `voidInvoice` (restore) | ACTIVE |
| [invoiceReturns.ts:818](../../lib/firestore/invoiceReturns.ts#L818) | TX | `postReturn` (restore) | ACTIVE |
| [inventoryDiscards.ts:263](../../lib/firestore/inventoryDiscards.ts#L263) | TX | `postInventoryDiscard` (FIFO discard) | ACTIVE |
| [stockAdjustment.ts:148](../../lib/inventory/stockAdjustment.ts#L148) | TX | `postStockAdjustment` (negative FIFO) | ACTIVE |
| `lotAdmin.ts:114` | TX | `updateLotAndSyncProduct` (direct qty edit) | **DELETED-M0** |

### Other lot-field writes

| Site | TX | Function | Caller | Class |
|---|---|---|---|---|
| [lotAdmin.ts (convert)](../../lib/firestore/lotAdmin.ts) | TX | `convertOpeningBalanceLotToStockIn` (`source`/`trader_id`) | [ProductLotsModal.tsx:64](../../app/components/products/ProductLotsModal.tsx#L64) | ACTIVE (kept) |
| `lotAdmin.ts:233` | TX | `deleteLotAndSyncProduct` (`tx.delete` lot) | none | **DELETED-M0** |
| [convert-opening-balance-lots.cjs:110](../../scripts/convert-opening-balance-lots.cjs#L110) | BATCH | `main` (`source`/`updated_at` only) | CLI | ACTIVE (script) |
| [migrations/run.mjs:95](../../scripts/migrations/run.mjs#L95) | BATCH | migration 002 (`warehouse_id`) | CLI | ACTIVE (script) |

---

## 3. `lot_consumptions`

| Site | TX | Function | Class |
|---|---|---|---|
| [invoices.ts:934-938](../../lib/firestore/invoices.ts#L934) | TX | `postInvoice` — `tx.set` consumption records | ACTIVE |
| [invoices.ts:1404](../../lib/firestore/invoices.ts#L1404) | TX | `voidInvoice` — `tx.update({ reversed_at })` | ACTIVE |

`postReturn` writes `return_lot_restorations` / `return_lot_writeoffs` ([invoiceReturns.ts:787](../../lib/firestore/invoiceReturns.ts#L787), [:803](../../lib/firestore/invoiceReturns.ts#L803)) rather than mutating consumptions. Scripts only READ this collection.

---

## 4. `inventory_transactions` (ledger) — DO NOT REFACTOR UNTIL §2.7 IS ANSWERED

All ledger writes funnel through one primitive:

- [inventoryTransactionService.ts:77/96/100](../../lib/inventory/inventoryTransactionService.ts#L77) — `recordInventoryTransactionInTx`: `tx.set(header)`, `tx.set(line)` per line, then `tx.update({ item_ids })`. No-op unless `engineWritesEnabled && !shadowMode`. **This `set`-then-`update`-in-one-commit pattern against an `allow update: if false` rule is the §2.7 blocking question — no ledger refactor may begin until an emulator test settles it.**

Callers (each passes its own `tx`): `stockIn`, `stockOut`, `postStockAdjustment`, and `fulfillLedgerOutbox`.

### Outbox (deterministic-id ledger + source-doc status)

| Site | TX | Function | Callers | Class |
|---|---|---|---|---|
| [ledgerOutbox.ts:181-227](../../lib/inventory/ledgerOutbox.ts#L181) | TX | `fulfillLedgerOutbox` | `fulfillInvoiceSaleLedger`/`VoidLedger` (post/void), `createProduct` (opening balance), `postInventoryDiscard`, `fulfillReturnLedger`, `repairInvoiceSaleLedger`/`repairReturnLedger` (InventoryHealthDashboard) | ACTIVE |
| [ledgerOutbox.ts:270](../../lib/inventory/ledgerOutbox.ts#L270) | TX | `markSourceLedgerPosted` | `fulfillLedgerOutbox` | ACTIVE |

---

## 5. Paired audit / sales writes (not `stock_quantity` themselves)

- Discard trail: [inventoryDiscards.ts:219/231/240](../../lib/firestore/inventoryDiscards.ts#L219) — `inventory_discards` / `_items` / `_lots`, TX (`postInventoryDiscard`).
- Return trail: [invoiceReturns.ts:787/803](../../lib/firestore/invoiceReturns.ts#L787) — restorations / write-offs, TX (`postReturn`).
- `sales` projection rows: written in `postInvoice` ([invoices.ts:946](../../lib/firestore/invoices.ts#L946)) and `postReturn` ([invoiceReturns.ts:841](../../lib/firestore/invoiceReturns.ts#L841)). (`recordSale` and the walk-in sales writes were DELETED-M0.)
- `cost_price` is co-written (recomputed from FIFO lots) with nearly every stock mutation above; flagged since it is stock-derived.

---

## 6. Dead code found but OUT OF M0 SCOPE

These have no caller but are **not** non-lot-aware stock writers, so M0 leaves them in place. Recorded here so they are not mistaken for live paths.

| Site | Function | Why deferred |
|---|---|---|
| [inventoryTransactionService.ts:109](../../lib/inventory/inventoryTransactionService.ts#L109) | `recordInventoryTransactionAfterCommit` | Ledger code — frozen until §2.7 is answered |
| [ledgerOutbox.ts:275](../../lib/inventory/ledgerOutbox.ts#L275) | `repairLedgerOutbox` | Ledger code — frozen until §2.7 is answered |
| [invoices.ts:1158](../../lib/firestore/invoices.ts#L1158) | `markInvoicePaid` | Writes `payment_status`/`paid_amount` only, not stock; touch it with the K-series cash work in M5 |

---

## 7. What M0 removed and why

Deleted in this milestone (all confirmed DEAD by grep, then typecheck + build):

- **`lib/firestore/walkInSessions.ts`** (whole module) — the discontinued walk-in flow. `approveWalkInSession` / `deleteApprovedWalkInSession` wrote `stock_quantity` with **no lot write**, breaking P1 (`stock_quantity == Σ qty_remaining`) on every call. Nothing imported the module.
- **`lib/firestore/sales.ts`** (`recordSale`) and **`app/components/sales/AddSaleForm.tsx`** — the legacy direct-sale path. `recordSale` decremented `stock_quantity` with no lot write; its only caller was `AddSaleForm`, which had no route rendering it.
- **Four `lib/firestore/lotAdmin.ts` exports** — `updateLotAndSyncProduct`, `syncProductStockFromLots`, `createAdjustmentLot`, `deleteLotAndSyncProduct`. The `sync*`/`delete*` pair forced `stock_quantity = Σ lot qty_remaining` with no ledger, reason, or uid — exactly what `MIGRATION_RUNBOOK.md` forbids. `convertOpeningBalanceLotToStockIn` was **kept** (live caller in ProductLotsModal).

**Result:** no non-lot-aware stock writer remains in the application. The only non-lot-aware writer left is the `reconcile-book-stock.mjs` **script**, which stays dry-run-only until replaced by the audited repair workflow in M6.
