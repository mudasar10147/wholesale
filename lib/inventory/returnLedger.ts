/**
 * The single place a posted return's inventory ledger is written.
 *
 * Two callers used to keep their own copy of this logic — `postReturn` at post
 * time and `repairReturnLedger` when an operator repairs a stuck one — and both
 * copies contained the same silent hole:
 *
 *     if (lines.length === 0) return;
 *
 * A return whose lines were ALL discarded restocks nothing, so it produced no
 * ledger lines and fell out of that early return without ever clearing
 * `ledger_status: "pending"`. It then showed up under R7 for ever, and pressing
 * Repair appeared to succeed while doing nothing at all.
 *
 * There are exactly three shapes, and each now has an explicit outcome:
 *
 *   all restock      → a SALES_RETURN ledger row for the restocked quantities
 *   mixed            → a ledger row for the restocked part only; discarded units
 *                      never entered stock, so they are not movement
 *   all discard      → NO ledger row, and an honest terminal `not_applicable`
 *
 * The all-discard case must not be papered over by writing a zero-quantity line
 * or a placeholder row: the ledger records inventory that actually moved, and
 * inventing movement to satisfy a check would corrupt the record this collection
 * exists to be. `not_applicable` says what is true — there was nothing to record.
 */

import { doc, getDoc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory/constants";
import { fulfillLedgerOutbox, type LedgerSourceBinding } from "@/lib/inventory/ledgerOutbox";
import type { InvoiceReturnDoc, InvoiceReturnItemDoc, LedgerStatus } from "@/lib/types/firestore";

/** What a return actually put back into stock. */
export type ReturnRestockScope =
  | { kind: "movement"; byProduct: Map<string, number> }
  /** Every returned unit was discarded — nothing re-entered stock to record. */
  | { kind: "no_movement" };

function returnLedgerBinding(returnId: string): LedgerSourceBinding {
  return {
    collection: COLLECTIONS.invoiceReturns,
    docId: returnId,
    statusField: "ledger_status",
    transactionIdField: "inventory_transaction_id",
    errorField: "ledger_error",
  };
}

/**
 * Restocked quantity per product.
 *
 * `precomputed` is the allocation `postReturn` already worked out inside its
 * transaction. An EMPTY precomputed map is meaningful — it means the allocation
 * restocked nothing — so it is honoured rather than treated as "not supplied".
 */
export async function resolveReturnRestockScope(
  db: Firestore,
  ret: InvoiceReturnDoc,
  precomputed?: Map<string, number>,
): Promise<ReturnRestockScope> {
  let byProduct = precomputed;
  if (!byProduct) {
    byProduct = new Map<string, number>();
    const itemIds = Array.isArray(ret.item_ids) ? ret.item_ids.filter(Boolean) : [];
    for (const itemId of itemIds) {
      const itemSnap = await getDoc(doc(db, COLLECTIONS.invoiceReturnItems, itemId));
      if (!itemSnap.exists()) continue;
      const item = itemSnap.data() as InvoiceReturnItemDoc;
      const restock = typeof item.quantity_restock === "number" ? item.quantity_restock : 0;
      if (restock > 0) {
        byProduct.set(item.product_id, (byProduct.get(item.product_id) ?? 0) + restock);
      }
    }
  }

  let total = 0;
  for (const qty of byProduct.values()) total += qty;
  if (byProduct.size === 0 || total <= 0) return { kind: "no_movement" };
  return { kind: "movement", byProduct };
}

/**
 * Record that a return has no inventory movement to log, so it stops being
 * reported as unfinished work.
 *
 * Idempotent, and deliberately refuses to touch a return that already carries a
 * real ledger: a bug elsewhere must never be able to erase a posted ledger link
 * by re-marking the return.
 */
export async function markReturnLedgerNotApplicable(db: Firestore, returnId: string): Promise<void> {
  const ref = doc(db, COLLECTIONS.invoiceReturns, returnId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const ret = snap.data() as InvoiceReturnDoc;
    if (ret.inventory_transaction_id?.trim()) return; // a real ledger exists; leave it alone
    if (ret.ledger_status === "not_applicable") return; // already terminal
    tx.update(ref, {
      ledger_status: "not_applicable" satisfies LedgerStatus,
      ledger_error: null,
      updated_at: serverTimestamp(),
    });
  });
}

/**
 * Write (or repair) the SALES_RETURN ledger for one posted return.
 *
 * Shared by the post-time path and the operator repair path so the two cannot
 * drift again. `postedByUid` is required: an unattributed ledger row is exactly
 * what G7 reports, and repair used to create them because the UI called through
 * without a uid.
 */
export async function fulfillReturnLedger(
  db: Firestore,
  returnId: string,
  ret: InvoiceReturnDoc,
  opts: { restoreByProduct?: Map<string, number>; postedByUid: string },
): Promise<ReturnRestockScope["kind"]> {
  const scope = await resolveReturnRestockScope(db, ret, opts.restoreByProduct);

  if (scope.kind === "no_movement") {
    await markReturnLedgerNotApplicable(db, returnId);
    return "no_movement";
  }

  const lines = Array.from(scope.byProduct.entries()).map(([product_id, quantity]) => ({
    product_id,
    warehouse_id: DEFAULT_WAREHOUSE_ID,
    direction: "in" as const,
    quantity,
    unit_cost: 0,
  }));

  await fulfillLedgerOutbox(
    db,
    {
      type: "SALES_RETURN",
      warehouse_id: DEFAULT_WAREHOUSE_ID,
      source_document_type: "invoice_return",
      source_document_id: returnId,
      posted_by_uid: opts.postedByUid,
      lines,
    },
    returnLedgerBinding(returnId),
    { stockCommitted: true },
  );
  return "movement";
}
