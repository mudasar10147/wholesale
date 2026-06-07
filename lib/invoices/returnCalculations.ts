import type { InvoiceItemDoc } from "@/lib/types/firestore";

export type ReturnLineInput = {
  original_invoice_item_id: string;
  product_id: string;
  quantity_returned: number;
  quantity_restock?: number;
  quantity_discard?: number;
};

export type NormalizedReturnLineSplit = {
  quantity_returned: number;
  quantity_restock: number;
  quantity_discard: number;
};

export type CalculatedReturnLine = ReturnLineInput & {
  quantity_restock: number;
  quantity_discard: number;
  unit_price: number;
  line_discount: number;
  line_delivery_charge: number;
  line_total: number;
};

export type ReturnCalculatedSummary = {
  lines: CalculatedReturnLine[];
  subtotal_amount: number;
  total_amount: number;
};

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Split restock vs discard; defaults to full restock when split omitted. */
export function normalizeReturnLineSplit(line: ReturnLineInput): NormalizedReturnLineSplit {
  const qty = Number.isFinite(line.quantity_returned)
    ? Math.max(0, Math.trunc(line.quantity_returned))
    : 0;
  if (qty <= 0) {
    return { quantity_returned: 0, quantity_restock: 0, quantity_discard: 0 };
  }

  const hasRestock = line.quantity_restock !== undefined;
  const hasDiscard = line.quantity_discard !== undefined;

  if (!hasRestock && !hasDiscard) {
    return { quantity_returned: qty, quantity_restock: qty, quantity_discard: 0 };
  }

  const restock = Math.max(0, Math.trunc(line.quantity_restock ?? 0));
  const discard = Math.max(0, Math.trunc(line.quantity_discard ?? 0));
  if (restock + discard !== qty) {
    throw new Error("Restock and discard quantities must add up to the return quantity.");
  }
  return { quantity_returned: qty, quantity_restock: restock, quantity_discard: discard };
}

/**
 * Proportional return line amounts from original invoice item quantities.
 */
export function calculateReturnSummary(
  returnLines: ReturnLineInput[],
  originalItemsById: Map<string, InvoiceItemDoc>,
): ReturnCalculatedSummary {
  const lines: CalculatedReturnLine[] = [];
  let subtotal = 0;

  for (const input of returnLines) {
    const split = normalizeReturnLineSplit(input);
    const qtyReturned = split.quantity_returned;
    if (qtyReturned <= 0) continue;

    const original = originalItemsById.get(input.original_invoice_item_id);
    if (!original) {
      throw new Error("Original invoice line not found.");
    }
    if (original.product_id !== input.product_id) {
      throw new Error("Product mismatch on return line.");
    }
    if (qtyReturned > original.quantity) {
      throw new Error("Return quantity exceeds original sold quantity.");
    }

    const ratio = qtyReturned / original.quantity;
    const lineDiscount = roundMoney2(original.line_discount * ratio);
    const lineDelivery = roundMoney2(original.line_delivery_charge * ratio);
    const lineTotal = roundMoney2(original.line_total * ratio);
    const net = roundMoney2(lineTotal - lineDelivery);

    lines.push({
      original_invoice_item_id: input.original_invoice_item_id,
      product_id: input.product_id,
      quantity_returned: qtyReturned,
      quantity_restock: split.quantity_restock,
      quantity_discard: split.quantity_discard,
      unit_price: original.unit_price,
      line_discount: lineDiscount,
      line_delivery_charge: lineDelivery,
      line_total: lineTotal,
    });
    subtotal += net;
  }

  return {
    lines,
    subtotal_amount: roundMoney2(subtotal),
    total_amount: roundMoney2(lines.reduce((acc, l) => acc + l.line_total, 0)),
  };
}
