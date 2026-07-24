"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  fetchCustomerPurchaseLines,
  type CustomerPurchaseLine,
} from "@/lib/firestore/customerPurchaseHistory";
import type { CounterSaleReturnInput } from "@/lib/firestore/counterSaleReturns";

export type ReturnLineMode = "restock" | "discard";

/** One return/discard row in the invoice's combined line list. */
export type ReturnLineDraft = {
  /** Local row id. */
  id: string;
  /**
   * Position key in the invoice's combined line list (sale lines share the same counter),
   * so returns/discards stay exactly where they were added.
   */
  seq: number;
  /** invoiceItemId of the chosen past purchase line; "" until picked. */
  purchaseLineId: string;
  quantity: string;
  mode: ReturnLineMode;
};

/** Enriched return line for display (receipt, summaries). */
export type ReturnLineDisplay = {
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  mode: ReturnLineMode;
};

export type ResolvedReturnLines = {
  inputs: CounterSaleReturnInput[];
  display: ReturnLineDisplay[];
  creditTotal: number;
  /** A row is present but not usable (no purchase picked, bad qty, or exceeds returnable). */
  hasInvalid: boolean;
};

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function newRow(mode: ReturnLineMode, seq: number): ReturnLineDraft {
  return { id: crypto.randomUUID(), seq, purchaseLineId: "", quantity: "1", mode };
}

/** Pure: turn the form rows into write-path inputs + a preview credit total. */
export function resolveReturnRows(
  rows: readonly ReturnLineDraft[],
  purchaseById: Map<string, CustomerPurchaseLine>,
): ResolvedReturnLines {
  const inputs: CounterSaleReturnInput[] = [];
  const display: ReturnLineDisplay[] = [];
  let credit = 0;
  let hasInvalid = false;

  for (const row of rows) {
    const pl = row.purchaseLineId ? purchaseById.get(row.purchaseLineId) : undefined;
    const qty = Number.parseInt(row.quantity.trim(), 10);
    // Every present row must be usable — never silently drop an unfinished return/discard row.
    if (!pl || !Number.isInteger(qty) || qty <= 0 || qty > pl.returnableQuantity) {
      hasInvalid = true;
      continue;
    }
    const lineTotal = pl.soldQuantity > 0 ? roundMoney2((pl.lineTotal * qty) / pl.soldQuantity) : 0;
    inputs.push({
      original_invoice_id: pl.invoiceId,
      original_invoice_item_id: pl.invoiceItemId,
      quantity_returned: qty,
      quantity_restock: row.mode === "restock" ? qty : 0,
      quantity_discard: row.mode === "discard" ? qty : 0,
      // Carries the row's position so the saved invoice keeps the combined line order.
      sort_order: row.seq,
    });
    display.push({
      productId: pl.productId,
      quantity: qty,
      unitPrice: pl.unitPrice,
      lineTotal,
      mode: row.mode,
    });
    credit += lineTotal;
  }

  return { inputs, display, creditTotal: roundMoney2(credit), hasInvalid };
}

/**
 * Loads a customer's returnable purchases and manages the invoice form's return rows.
 * Shared by the create and edit invoice forms. Changing the customer reloads the purchase
 * list; any already-added rows that no longer match become invalid (blocking save) so the
 * user is prompted to fix them.
 */
export function useInvoiceReturnLines(customerId: string, initialRows?: ReturnLineDraft[]) {
  const [purchaseLines, setPurchaseLines] = useState<CustomerPurchaseLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReturnLineDraft[]>(initialRows ?? []);

  useEffect(() => {
    const cid = customerId.trim();
    let active = true;
    void (async () => {
      setLoading(Boolean(cid));
      setError(null);
      try {
        const lines = cid ? await fetchCustomerPurchaseLines(getDb(), cid) : [];
        if (active) setPurchaseLines(lines);
      } catch (err) {
        if (active) setError(getFirestoreUserMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [customerId]);

  const purchaseById = useMemo(
    () => new Map(purchaseLines.map((l) => [l.invoiceItemId, l])),
    [purchaseLines],
  );

  const addReturn = useCallback(
    (seq: number) => setRows((prev) => [...prev, newRow("restock", seq)]),
    [],
  );
  const addDiscard = useCallback(
    (seq: number) => setRows((prev) => [...prev, newRow("discard", seq)]),
    [],
  );
  const removeRow = useCallback(
    (id: string) => setRows((prev) => prev.filter((r) => r.id !== id)),
    [],
  );
  const updateRow = useCallback(
    (id: string, patch: Partial<Omit<ReturnLineDraft, "id" | "seq">>) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [],
  );
  const reset = useCallback(() => setRows([]), []);

  const resolved = useMemo(() => resolveReturnRows(rows, purchaseById), [rows, purchaseById]);

  return {
    purchaseLines,
    purchaseById,
    rows,
    addReturn,
    addDiscard,
    updateRow,
    removeRow,
    reset,
    resolved,
    loading,
    error,
  };
}
