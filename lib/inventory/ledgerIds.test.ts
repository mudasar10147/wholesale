/**
 * Tests for the REAL ledger-id helpers (deterministic doc ids + retry backoff).
 * Run: npm run test:ledger-ids
 *
 * Extracted from the deleted inventoryConcurrency.test.ts, whose mock `consumeFifo`
 * ("mirrors stockOut / postInvoice logic") and Map-dedup "idempotency" tested a
 * reimplementation, not the code (§12.1). Real FIFO/concurrency is proven against
 * the actual functions under the emulator instead.
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

// Deterministic ids: concurrent fulfils of the same source target the same doc.
const id1 = ledgerTransactionDocId("SALE", "invoice", "INV-001");
const id2 = ledgerTransactionDocId("SALE", "invoice", "INV-001");
assert.equal(id1, id2);
assert.ok(id1.startsWith("ldg_"));

const voidId = ledgerTransactionDocId("SALE_VOID", "invoice", "INV-001");
assert.notEqual(id1, voidId);

const returnId = ledgerTransactionDocId("SALES_RETURN", "invoice_return", "ret-abc");
assert.ok(returnId.includes("SALES_RETURN"));

// Special characters are sanitised out of the doc id.
const sanitized = ledgerTransactionDocId("SALE", "invoice", "INV/001#x");
assert.ok(!sanitized.includes("/"));
assert.ok(!sanitized.includes("#"));

console.log("ledgerIds.test.ts: all assertions passed");
