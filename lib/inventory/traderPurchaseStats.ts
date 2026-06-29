import type { StockLotDoc } from "@/lib/types/firestore";

export type TraderLotInput = Pick<
  StockLotDoc,
  "source" | "qty_in" | "unit_cost" | "purchase_source" | "trader_id" | "product_id"
> & {
  received_at?: { toDate(): Date } | null;
};

export type TraderReceipt = {
  productId: string;
  receivedAt: Date | null;
  qty: number;
  unitCost: number;
  value: number;
};

export type TraderProductLine = {
  productId: string;
  totalQty: number;
  totalValue: number;
  receiptCount: number;
};

export type TraderPurchaseStats = {
  totalUnitsPurchased: number;
  /** Total amount paid to the trader (= sum of purchase value, paid at stock-in). */
  totalAmountPaid: number;
  receiptCount: number;
  recentReceipts: TraderReceipt[];
  byProduct: TraderProductLine[];
};

function toReceiptDate(lot: TraderLotInput): Date | null {
  try {
    return lot.received_at?.toDate() ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a lot is a stock-in receipt purchased from the given trader.
 * Matches by `trader_id` when present, else falls back to the legacy
 * free-text `purchase_source` matching the trader's name (case-insensitive).
 */
export function lotBelongsToTrader(
  lot: TraderLotInput,
  traderId: string,
  traderName: string,
): boolean {
  if (lot.source !== "stock_in") return false;
  if (lot.trader_id) return lot.trader_id === traderId;
  const name = traderName.trim().toLowerCase();
  if (!name) return false;
  return lot.purchase_source?.trim().toLowerCase() === name;
}

export function computeTraderPurchaseStats(
  lots: readonly TraderLotInput[],
  traderId: string,
  traderName: string,
  recentLimit = 12,
): TraderPurchaseStats {
  let totalUnitsPurchased = 0;
  let totalAmountPaid = 0;
  const receipts: TraderReceipt[] = [];
  const byProductMap = new Map<string, TraderProductLine>();

  for (const lot of lots) {
    if (!lotBelongsToTrader(lot, traderId, traderName)) continue;
    const qty = typeof lot.qty_in === "number" ? lot.qty_in : 0;
    const unitCost = typeof lot.unit_cost === "number" ? lot.unit_cost : 0;
    const value = qty * unitCost;
    const productId = typeof lot.product_id === "string" ? lot.product_id : "";

    totalUnitsPurchased += qty;
    totalAmountPaid += value;
    receipts.push({ productId, receivedAt: toReceiptDate(lot), qty, unitCost, value });

    const existing = byProductMap.get(productId);
    if (existing) {
      existing.totalQty += qty;
      existing.totalValue += value;
      existing.receiptCount += 1;
    } else {
      byProductMap.set(productId, { productId, totalQty: qty, totalValue: value, receiptCount: 1 });
    }
  }

  receipts.sort((a, b) => (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0));

  const byProduct = [...byProductMap.values()].sort(
    (a, b) => b.totalValue - a.totalValue || b.totalQty - a.totalQty,
  );

  return {
    totalUnitsPurchased,
    totalAmountPaid,
    receiptCount: receipts.length,
    recentReceipts: receipts.slice(0, recentLimit),
    byProduct,
  };
}
