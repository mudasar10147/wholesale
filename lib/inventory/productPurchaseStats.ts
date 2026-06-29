import type { StockLotDoc } from "@/lib/types/firestore";

/** Mirrors `UNSPECIFIED_PURCHASE_SOURCE` in purchaseReports (kept local to avoid a value import). */
const UNSPECIFIED_PURCHASE_SOURCE = "Unspecified";

export type ProductPurchaseLotInput = Pick<
  StockLotDoc,
  "source" | "qty_in" | "unit_cost" | "purchase_source"
> & {
  received_at?: { toDate(): Date } | null;
};

export type ProductPurchaseReceipt = {
  source: string;
  receivedAt: Date | null;
  qty: number;
  unitCost: number;
  value: number;
};

export type ProductPurchaseStats = {
  totalUnitsPurchased: number;
  totalPurchaseValue: number;
  receiptCount: number;
  recentReceipts: ProductPurchaseReceipt[];
};

function toReceiptDate(lot: ProductPurchaseLotInput): Date | null {
  try {
    return lot.received_at?.toDate() ?? null;
  } catch {
    return null;
  }
}

/**
 * Aggregate stock-in receipts for a single product. Only `source === "stock_in"`
 * lots count as purchases; opening balances and adjustments are ignored.
 */
export function computeProductPurchaseStats(
  lots: readonly ProductPurchaseLotInput[],
  recentLimit = 10,
): ProductPurchaseStats {
  let totalUnitsPurchased = 0;
  let totalPurchaseValue = 0;
  const receipts: ProductPurchaseReceipt[] = [];

  for (const lot of lots) {
    if (lot.source !== "stock_in") continue;
    const qty = typeof lot.qty_in === "number" ? lot.qty_in : 0;
    const unitCost = typeof lot.unit_cost === "number" ? lot.unit_cost : 0;
    const value = qty * unitCost;
    totalUnitsPurchased += qty;
    totalPurchaseValue += value;
    receipts.push({
      source: lot.purchase_source?.trim() || UNSPECIFIED_PURCHASE_SOURCE,
      receivedAt: toReceiptDate(lot),
      qty,
      unitCost,
      value,
    });
  }

  receipts.sort((a, b) => (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0));

  return {
    totalUnitsPurchased,
    totalPurchaseValue,
    receiptCount: receipts.length,
    recentReceipts: receipts.slice(0, recentLimit),
  };
}
