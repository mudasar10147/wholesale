import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory/constants";
import { inventoryEngineConfig } from "@/lib/inventory/config";
import { emitInventoryPosted } from "@/lib/inventory/inventoryEventBus";
import { logInventoryShadowDiff } from "@/lib/inventory/shadow";
import type { RecordInventoryTransactionInput } from "@/lib/inventory/inventoryTransactionTypes";

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function transactionNumber(type: string): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `ITX-${type.slice(0, 3)}-${y}${m}${day}-${rand}`;
}

export type RecordInventoryTransactionResult = {
  transaction_id: string;
  transaction_number: string;
  line_ids: string[];
};

/**
 * Writes inventory_transactions header + lines inside an existing Firestore transaction.
 * No-op when engine writes disabled or shadow mode is on.
 */
export function recordInventoryTransactionInTx(
  tx: Transaction,
  db: Firestore,
  input: RecordInventoryTransactionInput,
  opts?: { transactionId?: string },
): RecordInventoryTransactionResult | null {
  if (!inventoryEngineConfig.engineWritesEnabled || inventoryEngineConfig.shadowMode) {
    return null;
  }

  const txnRef = opts?.transactionId
    ? doc(db, COLLECTIONS.inventoryTransactions, opts.transactionId)
    : doc(collection(db, COLLECTIONS.inventoryTransactions));
  const txnNumber = transactionNumber(input.type);
  const lineIds: string[] = [];
  const now = serverTimestamp();

  // Firestore rejects `undefined` field values, so omit optional fields that are unset
  // (SALES_RETURN and similar callers don't supply reason/notes/lot_id/on-hand snapshots).
  const header: Record<string, unknown> = {
    transaction_number: txnNumber,
    type: input.type,
    status: "posted",
    warehouse_id: input.warehouse_id || DEFAULT_WAREHOUSE_ID,
    item_ids: [] as string[],
    created_at: now,
    updated_at: now,
    posted_at: now,
  };
  if (input.source_document_type !== undefined) header.source_document_type = input.source_document_type;
  if (input.source_document_id !== undefined) header.source_document_id = input.source_document_id;
  if (input.reason !== undefined) header.reason = input.reason;
  if (input.notes !== undefined) header.notes = input.notes;
  if (input.posted_by_uid !== undefined) header.posted_by_uid = input.posted_by_uid;

  tx.set(txnRef, header);

  for (const line of input.lines) {
    const lineRef = doc(collection(db, COLLECTIONS.inventoryTransactionLines));
    lineIds.push(lineRef.id);

    const lineDoc: Record<string, unknown> = {
      transaction_id: txnRef.id,
      product_id: line.product_id,
      warehouse_id: line.warehouse_id || DEFAULT_WAREHOUSE_ID,
      direction: line.direction,
      quantity: line.quantity,
      unit_cost: line.unit_cost,
      total_cost: roundMoney2(line.quantity * line.unit_cost),
      created_at: now,
    };
    if (line.lot_id !== undefined) lineDoc.lot_id = line.lot_id;
    if (line.before_on_hand !== undefined) lineDoc.before_on_hand = line.before_on_hand;
    if (line.after_on_hand !== undefined) lineDoc.after_on_hand = line.after_on_hand;
    tx.set(lineRef, lineDoc);
  }

  tx.update(txnRef, { item_ids: lineIds });

  return {
    transaction_id: txnRef.id,
    transaction_number: txnNumber,
    line_ids: lineIds,
  };
}

/** For large legacy transactions (e.g. invoice post) that cannot fit ledger writes in the same tx. */
export async function recordInventoryTransactionAfterCommit(
  db: Firestore,
  input: RecordInventoryTransactionInput,
): Promise<RecordInventoryTransactionResult | null> {
  if (inventoryEngineConfig.shadowMode) {
    await logInventoryShadowDiff(db, {
      context: `${input.type}:${input.source_document_id ?? "unknown"}`,
      product_id: input.lines[0]?.product_id,
      expected: {
        type: input.type,
        warehouse_id: input.warehouse_id || DEFAULT_WAREHOUSE_ID,
        source_document_type: input.source_document_type,
        source_document_id: input.source_document_id,
        lines: input.lines,
      },
      actual: { persisted: false },
    });
    return null;
  }
  if (!inventoryEngineConfig.engineWritesEnabled) {
    return null;
  }
  let result: RecordInventoryTransactionResult | null = null;
  await runTransaction(db, async (tx) => {
    result = recordInventoryTransactionInTx(tx, db, input);
  });
  if (result) {
    await notifyInventoryPosted(result, input);
  }
  return result;
}

/** Emit accounting hook after transaction commits (call outside Firestore tx). */
export async function notifyInventoryPosted(
  result: RecordInventoryTransactionResult,
  input: RecordInventoryTransactionInput,
): Promise<void> {
  const { registerDefaultInventorySubscribers } = await import(
    "@/lib/inventory/registerDefaultSubscribers"
  );
  registerDefaultInventorySubscribers();
  await emitInventoryPosted({
    transaction_id: result.transaction_id,
    transaction_number: result.transaction_number,
    type: input.type,
    warehouse_id: input.warehouse_id || DEFAULT_WAREHOUSE_ID,
    source_document_type: input.source_document_type,
    source_document_id: input.source_document_id,
    posted_at: new Date().toISOString(),
    posted_by_uid: input.posted_by_uid,
    lines: input.lines.map((line) => ({
      product_id: line.product_id,
      warehouse_id: line.warehouse_id || DEFAULT_WAREHOUSE_ID,
      direction: line.direction,
      quantity: line.quantity,
      unit_cost: line.unit_cost,
      total_cost: roundMoney2(line.quantity * line.unit_cost),
      lot_id: line.lot_id,
      before_on_hand: line.before_on_hand,
      after_on_hand: line.after_on_hand,
    })),
  });
}
