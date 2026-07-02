import type { StockLotDoc } from "@/lib/types/firestore";
import {
  UNLINKED_TRADER_KEY,
  UNLINKED_TRADER_LABEL,
  type TraderLookup,
} from "./traderLookup.ts";

export { UNLINKED_TRADER_KEY, UNLINKED_TRADER_LABEL };

export type PurchaseLotInput = Pick<
  StockLotDoc,
  "source" | "qty_in" | "unit_cost" | "purchase_source" | "trader_id"
> & {
  received_at: { toDate(): Date };
};

export type StockInDetailLotInput = PurchaseLotInput & Pick<StockLotDoc, "product_id">;

export type StockInPeriodType = "day" | "week" | "month";

export type StockInProductLine = {
  productId: string;
  totalQty: number;
  totalValue: number;
  receiptCount: number;
};

export type PurchaseAggregateRow = {
  key: string;
  label: string;
  totalQty: number;
  totalValue: number;
  receiptCount: number;
  traderId?: string;
  contactPerson?: string;
  phone?: string;
  city?: string;
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

function traderRowMeta(
  traderId: string | undefined,
  lookup: TraderLookup,
): Pick<PurchaseAggregateRow, "label" | "traderId" | "contactPerson" | "phone" | "city"> {
  if (!traderId) {
    return { label: UNLINKED_TRADER_LABEL };
  }
  const entry = lookup.get(traderId);
  if (!entry) {
    return { label: UNLINKED_TRADER_LABEL, traderId };
  }
  return {
    label: entry.name,
    traderId,
    contactPerson: entry.contact_person,
    phone: entry.phone,
    city: entry.city,
  };
}

function traderKeyForLot(lot: PurchaseLotInput): string {
  return lot.trader_id?.trim() || UNLINKED_TRADER_KEY;
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

function getCalendarWeekBounds(date: Date): { start: Date; end: Date } {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = day.getDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(day);
  monday.setDate(day.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function formatCalendarWeekLabel(start: Date, end: Date): string {
  const formatShort = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const y = end.getFullYear();
  const startPart = formatShort(start);
  const endPart = formatShort(end);
  if (start.getFullYear() === y) {
    return `${startPart} – ${endPart}, ${y}`;
  }
  return `${startPart}, ${start.getFullYear()} – ${endPart}, ${y}`;
}

function calendarWeekKey(date: Date): string {
  return calendarDayKey(getCalendarWeekBounds(date).start);
}

function calendarMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function periodKeyForLot(lot: PurchaseLotInput, periodType: StockInPeriodType): string {
  try {
    const date = lot.received_at.toDate();
    if (periodType === "day") return calendarDayKey(date);
    if (periodType === "week") return calendarWeekKey(date);
    return calendarMonthKey(date);
  } catch {
    return "invalid";
  }
}

export function aggregateStockInByProductForPeriod(
  lots: StockInDetailLotInput[],
  periodKey: string,
  periodType: StockInPeriodType,
): StockInProductLine[] {
  const map = new Map<string, StockInProductLine>();

  for (const lot of lots) {
    if (!isStockInLot(lot)) continue;
    if (periodKeyForLot(lot, periodType) !== periodKey) continue;
    const productId = typeof lot.product_id === "string" ? lot.product_id.trim() : "";
    if (!productId) continue;

    const qty = typeof lot.qty_in === "number" ? lot.qty_in : 0;
    const value = lotPurchaseValue(lot);
    const existing = map.get(productId);
    if (existing) {
      existing.totalQty += qty;
      existing.totalValue += value;
      existing.receiptCount += 1;
    } else {
      map.set(productId, {
        productId,
        totalQty: qty,
        totalValue: value,
        receiptCount: 1,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.totalQty - a.totalQty || b.totalValue - a.totalValue);
}

export function filterStockInLotsInPeriod(
  lots: PurchaseLotInput[],
  start: Date,
  end: Date,
): PurchaseLotInput[] {
  const startDay = startOfLocalDay(start);
  const endDay = startOfLocalDay(end);
  return lots.filter((lot) => {
    if (!isStockInLot(lot)) return false;
    try {
      const d = startOfLocalDay(lot.received_at.toDate());
      return d >= startDay && d <= endDay;
    } catch {
      return false;
    }
  });
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

/**
 * Group stock-in purchases by trader id from Traders management.
 */
export function aggregatePurchasesByTrader(
  lots: PurchaseLotInput[],
  traders: TraderLookup,
): PurchaseAggregateRow[] {
  const map = new Map<string, PurchaseAggregateRow>();

  for (const lot of lots) {
    if (!isStockInLot(lot)) continue;
    const key = traderKeyForLot(lot);
    const traderId = lot.trader_id?.trim() || undefined;
    const qty = typeof lot.qty_in === "number" ? lot.qty_in : 0;
    const value = lotPurchaseValue(lot);
    const existing = map.get(key);
    if (existing) {
      existing.totalQty += qty;
      existing.totalValue += value;
      existing.receiptCount += 1;
    } else {
      map.set(key, {
        key,
        ...traderRowMeta(traderId, traders),
        totalQty: qty,
        totalValue: value,
        receiptCount: 1,
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.key === UNLINKED_TRADER_KEY) return 1;
    if (b.key === UNLINKED_TRADER_KEY) return -1;
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

export function aggregatePurchasesByWeek(lots: PurchaseLotInput[]): PurchaseAggregateRow[] {
  return aggregateByKey(
    lots,
    (lot) => {
      try {
        return calendarWeekKey(lot.received_at.toDate());
      } catch {
        return "invalid";
      }
    },
    (key) => {
      if (key === "invalid") return "Invalid date";
      const [y, m, d] = key.split("-").map(Number);
      const monday = new Date(y, m - 1, d);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return formatCalendarWeekLabel(monday, sunday);
    },
  )
    .filter((row) => row.key !== "invalid")
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function aggregatePurchasesByMonth(lots: PurchaseLotInput[]): PurchaseAggregateRow[] {
  return aggregateByKey(
    lots,
    (lot) => {
      try {
        return calendarMonthKey(lot.received_at.toDate());
      } catch {
        return "invalid";
      }
    },
    (key) => (key === "invalid" ? "Invalid date" : formatMonthLabel(key)),
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
