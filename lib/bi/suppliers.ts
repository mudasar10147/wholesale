/**
 * Supplier financing and performance.
 *
 * What exists: every stock receipt (`stock_lots` with `source: "stock_in"`) carries
 * a trader, a unit cost, a quantity and a receipt date. That supports purchase
 * volume, buying frequency, price trend, and — by attributing each product to the
 * supplier that supplied most of it — the margin those goods went on to earn.
 *
 * What does not exist: supplier balances, invoices, due dates or agreed credit
 * days. Payables are reported as "not tracked" rather than as zero, and the
 * credit-terms simulation is explicitly a what-if on recorded purchase pace.
 */
import type { StockLotDoc, TraderDoc } from "@/lib/types/firestore";
import { buildTraderLookup, UNLINKED_TRADER_KEY, UNLINKED_TRADER_LABEL } from "@/lib/inventory/traderLookup";
import { num, timestampToDate, type WithId } from "@/lib/bi/dataset";
import { roundMoney2, safeDivide } from "@/lib/bi/finance";

export type SupplierRow = {
  traderId: string;
  name: string;
  purchaseValue: number;
  purchaseUnits: number;
  receiptCount: number;
  lastPurchaseAt: Date | null;
  /** Average days between receipts across the period. Null with fewer than 2 receipts. */
  averageDaysBetweenPurchases: number | null;
  /** Weighted average unit cost across the period. */
  averageUnitCost: number | null;
  /** Change in weighted average unit cost, first half vs second half of the period. */
  unitCostTrendPct: number | null;
  /** Share of total purchases in the period, 0–100. */
  sharePct: number | null;
  /** Realised gross margin % on products primarily sourced from this supplier. */
  attributedMarginPct: number | null;
  attributedRevenue: number;
  attributedGrossProfit: number;
  /** Cost of stock from this supplier still sitting unsold. */
  stockOnHandValue: number;
};

export type SupplierReport = {
  suppliers: SupplierRow[];
  totalPurchases: number;
  /** Null — TradeBridge does not record supplier balances. */
  totalPayable: number | null;
  payablesTracked: boolean;
  /** Null — no payment dates exist to measure against. */
  averagePaymentPeriodDays: number | null;
  /** Share of purchases from the single largest supplier, 0–100. */
  concentrationPct: number | null;
  dataNote: string;
};

export type SupplierInput = {
  stockLots: readonly WithId<StockLotDoc>[];
  traders: readonly WithId<TraderDoc>[];
  periodStart: Date;
  periodEnd: Date;
  /** Realised revenue and gross profit per product over the analysis period. */
  productPerformance: ReadonlyMap<string, { revenue: number; grossProfit: number }>;
};

export function buildSupplierReport(input: SupplierInput): SupplierReport {
  const lookup = buildTraderLookup(
    input.traders.map((t) => ({
      id: t.id,
      name: t.data.name,
      phone: t.data.phone,
      city: t.data.city,
      contact_person: t.data.contact_person,
    })),
  );

  type Accumulator = {
    traderId: string;
    name: string;
    purchaseValue: number;
    purchaseUnits: number;
    receiptCount: number;
    lastPurchaseAt: Date | null;
    dates: Date[];
    firstHalfValue: number;
    firstHalfUnits: number;
    secondHalfValue: number;
    secondHalfUnits: number;
    stockOnHandValue: number;
  };

  const midpoint = new Date((input.periodStart.getTime() + input.periodEnd.getTime()) / 2);
  const byTrader = new Map<string, Accumulator>();
  /** productId → traderId → purchase value, to pick each product's primary supplier. */
  const productSupplierValue = new Map<string, Map<string, number>>();

  const ensure = (traderId: string): Accumulator => {
    let acc = byTrader.get(traderId);
    if (!acc) {
      acc = {
        traderId,
        name: traderId === UNLINKED_TRADER_KEY ? UNLINKED_TRADER_LABEL : (lookup.get(traderId)?.name ?? UNLINKED_TRADER_LABEL),
        purchaseValue: 0,
        purchaseUnits: 0,
        receiptCount: 0,
        lastPurchaseAt: null,
        dates: [],
        firstHalfValue: 0,
        firstHalfUnits: 0,
        secondHalfValue: 0,
        secondHalfUnits: 0,
        stockOnHandValue: 0,
      };
      byTrader.set(traderId, acc);
    }
    return acc;
  };

  for (const row of input.stockLots) {
    const lot = row.data;
    if (lot.source !== "stock_in") continue;
    const traderId = lot.trader_id?.trim() || UNLINKED_TRADER_KEY;
    const acc = ensure(traderId);

    // Stock still on hand from this supplier counts whenever the lot was received.
    const remainingValue = Math.max(0, num(lot.qty_remaining)) * num(lot.unit_cost);
    acc.stockOnHandValue += remainingValue;

    const received = timestampToDate(lot.received_at) ?? timestampToDate(lot.created_at);
    if (!received) continue;
    if (received < input.periodStart || received > input.periodEnd) continue;

    const units = num(lot.qty_in);
    const value = units * num(lot.unit_cost);
    acc.purchaseValue += value;
    acc.purchaseUnits += units;
    acc.receiptCount += 1;
    acc.dates.push(received);
    if (!acc.lastPurchaseAt || received > acc.lastPurchaseAt) acc.lastPurchaseAt = received;

    if (received < midpoint) {
      acc.firstHalfValue += value;
      acc.firstHalfUnits += units;
    } else {
      acc.secondHalfValue += value;
      acc.secondHalfUnits += units;
    }

    const productId = lot.product_id;
    if (productId) {
      let perTrader = productSupplierValue.get(productId);
      if (!perTrader) {
        perTrader = new Map<string, number>();
        productSupplierValue.set(productId, perTrader);
      }
      perTrader.set(traderId, (perTrader.get(traderId) ?? 0) + value);
    }
  }

  // Attribute each product's realised margin to whichever supplier supplied most of it.
  const attributed = new Map<string, { revenue: number; grossProfit: number }>();
  for (const [productId, perTrader] of productSupplierValue) {
    const performance = input.productPerformance.get(productId);
    if (!performance) continue;
    let bestTrader = UNLINKED_TRADER_KEY;
    let bestValue = -1;
    for (const [traderId, value] of perTrader) {
      if (value > bestValue) {
        bestValue = value;
        bestTrader = traderId;
      }
    }
    const current = attributed.get(bestTrader) ?? { revenue: 0, grossProfit: 0 };
    current.revenue += performance.revenue;
    current.grossProfit += performance.grossProfit;
    attributed.set(bestTrader, current);
  }

  const totalPurchases = roundMoney2(
    [...byTrader.values()].reduce((sum, acc) => sum + acc.purchaseValue, 0),
  );

  const suppliers: SupplierRow[] = [...byTrader.values()]
    .filter((acc) => acc.purchaseValue > 0 || acc.stockOnHandValue > 0)
    .map((acc) => {
      const sorted = acc.dates.slice().sort((a, b) => a.getTime() - b.getTime());
      let averageDaysBetweenPurchases: number | null = null;
      if (sorted.length >= 2) {
        const span = sorted[sorted.length - 1]!.getTime() - sorted[0]!.getTime();
        averageDaysBetweenPurchases = span / (sorted.length - 1) / (24 * 60 * 60 * 1000);
      }

      const averageUnitCost = safeDivide(acc.purchaseValue, acc.purchaseUnits);
      const firstAvg = safeDivide(acc.firstHalfValue, acc.firstHalfUnits);
      const secondAvg = safeDivide(acc.secondHalfValue, acc.secondHalfUnits);
      const unitCostTrendPct =
        firstAvg !== null && secondAvg !== null && firstAvg > 0
          ? ((secondAvg - firstAvg) / firstAvg) * 100
          : null;

      const attr = attributed.get(acc.traderId) ?? { revenue: 0, grossProfit: 0 };

      return {
        traderId: acc.traderId,
        name: acc.name,
        purchaseValue: roundMoney2(acc.purchaseValue),
        purchaseUnits: acc.purchaseUnits,
        receiptCount: acc.receiptCount,
        lastPurchaseAt: acc.lastPurchaseAt,
        averageDaysBetweenPurchases,
        averageUnitCost,
        unitCostTrendPct,
        sharePct: totalPurchases > 0 ? (acc.purchaseValue / totalPurchases) * 100 : null,
        attributedMarginPct: attr.revenue > 0 ? (attr.grossProfit / attr.revenue) * 100 : null,
        attributedRevenue: roundMoney2(attr.revenue),
        attributedGrossProfit: roundMoney2(attr.grossProfit),
        stockOnHandValue: roundMoney2(acc.stockOnHandValue),
      };
    })
    .sort((a, b) => b.purchaseValue - a.purchaseValue);

  return {
    suppliers,
    totalPurchases,
    totalPayable: null,
    payablesTracked: false,
    averagePaymentPeriodDays: null,
    concentrationPct: suppliers[0]?.sharePct ?? null,
    dataNote:
      "TradeBridge records what was bought, from whom and at what cost, but holds no supplier balances, invoices or agreed credit days. Anything about what is still owed to suppliers cannot be shown until that is tracked. Margin per supplier attributes each product to the supplier that supplied most of it during this period.",
  };
}

export type SupplierTermsSimulation = {
  currentTermDays: number;
  targetTermDays: number;
  monthlyPurchases: number;
  capitalFreed: number | null;
  sentence: string;
};

/**
 * What-if on supplier credit. Since purchases currently behave as immediate cash
 * outflows, every day of credit leaves one day of purchases in the bank.
 */
export function simulateSupplierTerms(params: {
  monthlyPurchases: number;
  targetTermDays: number;
  currentTermDays?: number;
}): SupplierTermsSimulation {
  const currentTermDays = Math.max(0, params.currentTermDays ?? 0);
  const targetTermDays = Math.max(0, params.targetTermDays);
  const monthlyPurchases = Number.isFinite(params.monthlyPurchases)
    ? Math.max(0, params.monthlyPurchases)
    : 0;
  const perDay = monthlyPurchases / 30;
  const extraDays = targetTermDays - currentTermDays;
  const capitalFreed = perDay > 0 ? roundMoney2(perDay * extraDays) : null;

  return {
    currentTermDays,
    targetTermDays,
    monthlyPurchases: roundMoney2(monthlyPurchases),
    capitalFreed,
    sentence:
      capitalFreed === null
        ? "No stock purchases were recorded in this period, so supplier credit cannot be valued yet."
        : `If suppliers gave you ${targetTermDays} days to pay instead of ${currentTermDays}, roughly Rs. ${Math.round(Math.abs(capitalFreed)).toLocaleString()} would ${capitalFreed >= 0 ? "stay available as working capital" : "leave working capital"} at the current buying pace. This is an estimate — TradeBridge does not record supplier terms.`,
  };
}
