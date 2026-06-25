import type { StockLotDoc } from "@/lib/types/firestore";

export const UNSPECIFIED_PURCHASE_SOURCE = "Unspecified";

export type PurchaseLotInput = Pick<
  StockLotDoc,
  "source" | "qty_in" | "unit_cost" | "purchase_source"
> & {
  received_at: { toDate(): Date };
};

export type PurchaseAggregateRow = {
  key: string;
  label: string;
  totalQty: number;
  totalValue: number;
  receiptCount: number;
};

export type PurchaseReportRange = "7" | "30" | "all";

function isStockInLot(lot: PurchaseLotInput): boolean {
  return lot.source === "stock_in";
}

function lotPurchaseValue(lot: PurchaseLotInput): number {
  const qty = typeof lot.qty_in === "number" ? lot.qty_in : 0;
  const cost = typeof lot.unit_cost === "number" ? lot.unit_cost : 0;
  return qty * cost;
}

function purchaseSourceLabel(lot: PurchaseLotInput): string {
  const raw = lot.purchase_source?.trim();
  return raw || UNSPECIFIED_PURCHASE_SOURCE;
}

function calendarDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatCalendarDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function filterPurchaseLotsByRange(
  lots: PurchaseLotInput[],
  range: PurchaseReportRange,
  now: Date = new Date(),
): PurchaseLotInput[] {
  const stockInLots = lots.filter(isStockInLot);
  if (range === "all") return stockInLots;

  const days = range === "7" ? 7 : 30;
  const cutoff = startOfLocalDay(now);
  cutoff.setDate(cutoff.getDate() - (days - 1));

  return stockInLots.filter((lot) => {
    try {
      return startOfLocalDay(lot.received_at.toDate()) >= cutoff;
    } catch {
      return false;
    }
  });
}

function aggregateByKey(
  lots: PurchaseLotInput[],
  keyForLot: (lot: PurchaseLotInput) => string,
  labelForKey: (key: string) => string,
): PurchaseAggregateRow[] {
  const map = new Map<string, PurchaseAggregateRow>();

  for (const lot of lots) {
    if (!isStockInLot(lot)) continue;
    const key = keyForLot(lot);
    const existing = map.get(key);
    const qty = typeof lot.qty_in === "number" ? lot.qty_in : 0;
    const value = lotPurchaseValue(lot);
    if (existing) {
      existing.totalQty += qty;
      existing.totalValue += value;
      existing.receiptCount += 1;
    } else {
      map.set(key, {
        key,
        label: labelForKey(key),
        totalQty: qty,
        totalValue: value,
        receiptCount: 1,
      });
    }
  }

  return [...map.values()];
}

export function aggregatePurchasesByShop(lots: PurchaseLotInput[]): PurchaseAggregateRow[] {
  return aggregateByKey(
    lots,
    (lot) => purchaseSourceLabel(lot),
    (key) => key,
  ).sort((a, b) => {
    if (a.key === UNSPECIFIED_PURCHASE_SOURCE) return 1;
    if (b.key === UNSPECIFIED_PURCHASE_SOURCE) return -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

export function aggregatePurchasesByDay(lots: PurchaseLotInput[]): PurchaseAggregateRow[] {
  return aggregateByKey(
    lots,
    (lot) => {
      try {
        return calendarDayKey(lot.received_at.toDate());
      } catch {
        return "invalid";
      }
    },
    (key) => (key === "invalid" ? "Invalid date" : formatCalendarDayLabel(key)),
  )
    .filter((row) => row.key !== "invalid")
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function computePurchaseKpis(lots: PurchaseLotInput[]): {
  totalQty: number;
  totalValue: number;
  receiptCount: number;
} {
  let totalQty = 0;
  let totalValue = 0;
  let receiptCount = 0;
  for (const lot of lots) {
    if (!isStockInLot(lot)) continue;
    totalQty += typeof lot.qty_in === "number" ? lot.qty_in : 0;
    totalValue += lotPurchaseValue(lot);
    receiptCount += 1;
  }
  return { totalQty, totalValue, receiptCount };
}

export { formatCalendarDayLabel };
