/**
 * Run: npm run test:inventory-stress
 *
 * Pure-logic concurrency / idempotency tests (no Firestore emulator).
 * Integration stress (20 concurrent writers) requires Firebase Emulator — see docs/inventory/STRESS_TESTING.md
 */
import assert from "node:assert/strict";
import {
  LEDGER_FULFILL_MAX_ATTEMPTS,
  ledgerRetryDelayMs,
  ledgerTransactionDocId,
} from "./ledgerIds.ts";

assert.equal(LEDGER_FULFILL_MAX_ATTEMPTS, 3);
assert.equal(ledgerRetryDelayMs(0), 0);
assert.equal(ledgerRetryDelayMs(1), 100);
assert.equal(ledgerRetryDelayMs(2), 300);

// Deterministic ledger IDs — concurrent fulfills target the same doc
const id1 = ledgerTransactionDocId("SALE", "invoice", "INV-001");
const id2 = ledgerTransactionDocId("SALE", "invoice", "INV-001");
assert.equal(id1, id2);
assert.ok(id1.startsWith("ldg_"));

const voidId = ledgerTransactionDocId("SALE_VOID", "invoice", "INV-001");
assert.notEqual(id1, voidId);

const returnId = ledgerTransactionDocId("SALES_RETURN", "invoice_return", "ret-abc");
assert.ok(returnId.includes("SALES_RETURN"));

// Sanitize special chars
const sanitized = ledgerTransactionDocId("SALE", "invoice", "INV/001#x");
assert.ok(!sanitized.includes("/"));
assert.ok(!sanitized.includes("#"));

type Lot = { id: string; receivedAt: number; qty: number };

function cloneLots(lots: Lot[]): Lot[] {
  return lots.map((l) => ({ ...l }));
}

/** Oldest-first FIFO consume (mirrors stockOut / postInvoice logic). */
function consumeFifo(lots: Lot[], need: number): { lots: Lot[]; consumed: number; ok: boolean } {
  const working = cloneLots(lots).sort((a, b) => a.receivedAt - b.receivedAt);
  let remaining = need;
  for (const lot of working) {
    if (remaining <= 0) break;
    if (lot.qty <= 0) continue;
    const take = Math.min(lot.qty, remaining);
    lot.qty -= take;
    remaining -= take;
  }
  const consumed = need - remaining;
  return { lots: working, consumed, ok: remaining === 0 };
}

function sumLotQty(lots: Lot[]): number {
  return lots.reduce((s, l) => s + l.qty, 0);
}

// Two users selling last 5 units — serialized consumption
{
  const initial: Lot[] = [
    { id: "l1", receivedAt: 1, qty: 3 },
    { id: "l2", receivedAt: 2, qty: 2 },
  ];
  let lots = cloneLots(initial);
  const saleA = consumeFifo(lots, 5);
  assert.equal(saleA.ok, true);
  lots = saleA.lots;
  const saleB = consumeFifo(lots, 1);
  assert.equal(saleB.ok, false);
  assert.equal(saleB.consumed, 0);
  assert.equal(sumLotQty(lots), 0);
}

// FIFO order: oldest lot consumed first
{
  const lots: Lot[] = [
    { id: "old", receivedAt: 10, qty: 5 },
    { id: "new", receivedAt: 20, qty: 5 },
  ];
  const { lots: after } = consumeFifo(lots, 3);
  const old = after.find((l) => l.id === "old")!;
  const newer = after.find((l) => l.id === "new")!;
  assert.equal(old.qty, 2);
  assert.equal(newer.qty, 5);
}

// 20 sequential invoice-line consumptions cannot go negative
{
  let lots: Lot[] = [{ id: "l1", receivedAt: 1, qty: 100 }];
  for (let i = 0; i < 20; i++) {
    const need = 4;
    const r = consumeFifo(lots, need);
    assert.equal(r.ok, true);
    lots = r.lots;
  }
  assert.equal(sumLotQty(lots), 20);
}

// Concurrent adjustment simulation: +10 then -10 on book 50
{
  let book = 50;
  let lots: Lot[] = [{ id: "l1", receivedAt: 1, qty: 50 }];
  book += 10;
  lots.push({ id: "l2", receivedAt: 2, qty: 10 });
  assert.equal(book, sumLotQty(lots));
  const r = consumeFifo(lots, 10);
  assert.equal(r.ok, true);
  book -= 10;
  lots = r.lots;
  assert.equal(book, sumLotQty(lots));
}

// Idempotency map: duplicate ledger keys collapse to one slot
{
  const ledgerByKey = new Map<string, string>();
  function fulfillOnce(key: string): string {
    const existing = ledgerByKey.get(key);
    if (existing) return existing;
    const id = ledgerTransactionDocId("SALE", "invoice", key);
    ledgerByKey.set(key, id);
    return id;
  }
  const parallel = Array.from({ length: 20 }, () => fulfillOnce("INV-CONCURRENT"));
  assert.ok(parallel.every((id) => id === parallel[0]));
  assert.equal(ledgerByKey.size, 1);
}

console.log("inventoryConcurrency.test.ts: all assertions passed");
