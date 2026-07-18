import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { isFirestoreContentionError } from "@/lib/firestore/stockLotsQuery";
import { inventoryEngineConfig } from "@/lib/inventory/config";
import {
  LEDGER_FULFILL_MAX_ATTEMPTS,
  ledgerRetryDelayMs,
  ledgerTransactionDocId,
} from "@/lib/inventory/ledgerIds";
import {
  notifyInventoryPosted,
  recordInventoryTransactionInTx,
  type RecordInventoryTransactionResult,
} from "@/lib/inventory/inventoryTransactionService";
import { logInventoryShadowDiff } from "@/lib/inventory/shadow";
import type { RecordInventoryTransactionInput } from "@/lib/inventory/inventoryTransactionTypes";
import type { InventoryTransactionDoc, LedgerStatus } from "@/lib/types/firestore";
import { sleepMs } from "@/lib/inventory/ledgerIds";

/** Thrown when stock/source doc committed but ledger fulfillment failed. */
export class LedgerFulfillmentError extends Error {
  readonly stockCommitted: boolean;
  readonly sourceDocumentType: string;
  readonly sourceDocumentId: string;

  constructor(
    message: string,
    opts: { stockCommitted: boolean; sourceDocumentType: string; sourceDocumentId: string },
  ) {
    super(message);
    this.name = "LedgerFulfillmentError";
    this.stockCommitted = opts.stockCommitted;
    this.sourceDocumentType = opts.sourceDocumentType;
    this.sourceDocumentId = opts.sourceDocumentId;
  }
}

export type LedgerSourceBinding = {
  collection: string;
  docId: string;
  /** Firestore field storing ledger status (e.g. ledger_status). */
  statusField: string;
  /** Firestore field storing inventory_transaction_id on success. */
  transactionIdField: string;
  /** Optional field for last ledger error message. */
  errorField?: string;
};

export async function findExistingLedgerBySource(
  db: Firestore,
  input: Pick<RecordInventoryTransactionInput, "type" | "source_document_type" | "source_document_id">,
): Promise<RecordInventoryTransactionResult | null> {
  const sourceType = input.source_document_type?.trim();
  const sourceId = input.source_document_id?.trim();
  if (!sourceType || !sourceId) return null;

  const q = query(
    collection(db, COLLECTIONS.inventoryTransactions),
    where("source_document_type", "==", sourceType),
    where("source_document_id", "==", sourceId),
    where("type", "==", input.type),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const d = snap.docs[0]!;
  const data = d.data() as InventoryTransactionDoc;
  return {
    transaction_id: d.id,
    transaction_number: data.transaction_number,
    line_ids: Array.isArray(data.item_ids) ? data.item_ids : [],
  };
}

function readBoundTransactionId(
  data: Record<string, unknown> | undefined,
  binding: LedgerSourceBinding,
): string | null {
  const raw = data?.[binding.transactionIdField];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Idempotent ledger writer: one inventory_transaction per (source_document_type, source_document_id, type).
 * Atomically updates source doc ledger fields in the same Firestore transaction as ledger create.
 */
export async function fulfillLedgerOutbox(
  db: Firestore,
  input: RecordInventoryTransactionInput,
  binding: LedgerSourceBinding,
  opts?: { stockCommitted?: boolean },
): Promise<RecordInventoryTransactionResult | null> {
  const sourceType = input.source_document_type?.trim() ?? "";
  const sourceId = input.source_document_id?.trim() ?? "";
  const stockCommitted = opts?.stockCommitted ?? true;

  if (inventoryEngineConfig.shadowMode) {
    await logInventoryShadowDiff(db, {
      context: `${input.type}:${sourceId}`,
      product_id: input.lines[0]?.product_id,
      expected: { type: input.type, source_document_type: sourceType, source_document_id: sourceId, lines: input.lines },
      actual: { persisted: false },
    });
    return null;
  }

  if (!inventoryEngineConfig.engineWritesEnabled) {
    return null;
  }

  if (input.lines.length === 0) {
    return null;
  }

  const deterministicId = ledgerTransactionDocId(input.type, sourceType, sourceId);

  const existing = await findExistingLedgerBySource(db, input);
  if (existing) {
    await markSourceLedgerPosted(db, binding, existing, null);
    return existing;
  }

  let result: RecordInventoryTransactionResult | null = null;
  let ledgerError: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < LEDGER_FULFILL_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleepMs(ledgerRetryDelayMs(attempt));
    }
    try {
      await runTransaction(db, async (tx) => {
        const sourceRef = doc(db, binding.collection, binding.docId);
        const sourceSnap = await tx.get(sourceRef);
        if (!sourceSnap.exists()) {
          throw new Error("Source document not found for ledger fulfillment.");
        }
        const sourceData = sourceSnap.data() as Record<string, unknown>;

        const boundTxnId = readBoundTransactionId(sourceData, binding);
        if (boundTxnId) {
          const txnSnap = await tx.get(doc(db, COLLECTIONS.inventoryTransactions, boundTxnId));
          if (txnSnap.exists()) {
            const txnData = txnSnap.data() as InventoryTransactionDoc;
            result = {
              transaction_id: boundTxnId,
              transaction_number: txnData.transaction_number,
              line_ids: Array.isArray(txnData.item_ids) ? txnData.item_ids : [],
            };
            return;
          }
        }

        const ledgerRef = doc(db, COLLECTIONS.inventoryTransactions, deterministicId);
        const ledgerSnap = await tx.get(ledgerRef);
        if (ledgerSnap.exists()) {
          const txnData = ledgerSnap.data() as InventoryTransactionDoc;
          result = {
            transaction_id: deterministicId,
            transaction_number: txnData.transaction_number,
            line_ids: Array.isArray(txnData.item_ids) ? txnData.item_ids : [],
          };
          const patch: Record<string, unknown> = {
            [binding.statusField]: "posted" satisfies LedgerStatus,
            [binding.transactionIdField]: deterministicId,
            updated_at: serverTimestamp(),
          };
          if (binding.errorField) {
            patch[binding.errorField] = null;
          }
          tx.update(sourceRef, patch);
          return;
        }

        const created = recordInventoryTransactionInTx(tx, db, input, {
          transactionId: deterministicId,
        });
        if (!created) {
          return;
        }

        const patch: Record<string, unknown> = {
          [binding.statusField]: "posted" satisfies LedgerStatus,
          [binding.transactionIdField]: created.transaction_id,
          updated_at: serverTimestamp(),
        };
        if (binding.errorField) {
          patch[binding.errorField] = null;
        }
        tx.update(sourceRef, patch);
        result = created;
      });
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      if (!isFirestoreContentionError(e) || attempt === LEDGER_FULFILL_MAX_ATTEMPTS - 1) {
        ledgerError = e instanceof Error ? e.message : String(e);
        break;
      }
    }
  }

  if (lastError && !result) {
    try {
      await runTransaction(db, async (tx) => {
        const sourceRef = doc(db, binding.collection, binding.docId);
        const sourceSnap = await tx.get(sourceRef);
        if (!sourceSnap.exists()) return;
        const patch: Record<string, unknown> = {
          [binding.statusField]: "failed" satisfies LedgerStatus,
          updated_at: serverTimestamp(),
        };
        if (binding.errorField) {
          patch[binding.errorField] = ledgerError;
        }
        tx.update(sourceRef, patch);
      });
    } catch {
      // Best-effort failure marking.
    }
    throw new LedgerFulfillmentError(
      `Inventory ledger write failed: ${ledgerError}. Stock movement may be committed; use Inventory Health to repair.`,
      { stockCommitted, sourceDocumentType: sourceType, sourceDocumentId: sourceId },
    );
  }

  if (!result) {
    throw new LedgerFulfillmentError(
      "Inventory ledger was not written (engine disabled or empty lines).",
      { stockCommitted, sourceDocumentType: sourceType, sourceDocumentId: sourceId },
    );
  }

  await notifyInventoryPosted(result, input);
  return result;
}

/** Mark source doc ledger fields when an existing ledger row is found (repair / idempotent retry). */
export async function markSourceLedgerPosted(
  db: Firestore,
  binding: LedgerSourceBinding,
  ledger: RecordInventoryTransactionResult,
  errorMessage: string | null,
): Promise<void> {
  const sourceRef = doc(db, binding.collection, binding.docId);
  const patch: Record<string, unknown> = {
    [binding.statusField]: errorMessage ? ("failed" satisfies LedgerStatus) : ("posted" satisfies LedgerStatus),
    [binding.transactionIdField]: ledger.transaction_id,
    updated_at: serverTimestamp(),
  };
  if (binding.errorField) {
    patch[binding.errorField] = errorMessage;
  }
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(sourceRef);
    if (!snap.exists()) return;
    const existing = readBoundTransactionId(snap.data() as Record<string, unknown>, binding);
    if (existing) return;
    tx.update(sourceRef, patch);
  });
}

/** Admin repair: retry ledger for a source document that has pending/failed/missing ledger. */
export async function repairLedgerOutbox(
  db: Firestore,
  input: RecordInventoryTransactionInput,
  binding: LedgerSourceBinding,
): Promise<RecordInventoryTransactionResult | null> {
  return fulfillLedgerOutbox(db, input, binding, { stockCommitted: true });
}

export function isLedgerPendingOrFailed(data: Record<string, unknown>, statusField = "ledger_status"): boolean {
  const status = data[statusField];
  return status === "pending" || status === "failed";
}
