/**
 * Cash-flow forecast over 7 / 30 / 60 / 90 days.
 *
 * Opening cash is TradeBridge's existing cash-in-hand estimate. Inflows are the
 * outstanding receivable book released over the estimated collection period, plus
 * new sales — cash sales landing immediately, credit sales landing after the
 * collection lag. Outflows are operating expenses and stock replenishment, which
 * are cash outflows the day they happen because no supplier credit is recorded.
 *
 * Buying stock is a cash outflow but NOT an expense until it sells, so purchases
 * appear only in this cash statement and never in the profit figures.
 */
import { roundMoney2 } from "@/lib/bi/finance";

export type CashFlowHorizonId = "7" | "30" | "60" | "90";

export type CashFlowHorizon = {
  id: CashFlowHorizonId;
  days: number;
  label: string;
  openingCash: number;
  collectionsFromReceivables: number;
  collectionsFromNewSales: number;
  totalInflows: number;
  operatingExpenses: number;
  inventoryPurchases: number;
  totalOutflows: number;
  closingCash: number;
  /** Lowest point reached inside the horizon (checked at each shorter horizon). */
  isNegative: boolean;
};

export type CashFlowWarning = {
  id: string;
  severity: "danger" | "warning";
  title: string;
  detail: string;
};

export type CashFlowForecast = {
  horizons: CashFlowHorizon[];
  warnings: CashFlowWarning[];
  assumptions: string[];
};

export type CashFlowInput = {
  openingCash: number;
  /** Outstanding customer balances today. */
  accountsReceivable: number;
  /** Estimated days to collect. Null falls back to releasing the book over 30 days. */
  collectionPeriodDays: number | null;
  /** Forecast revenue for the coming month. */
  monthlyRevenue: number;
  /** Share of revenue billed on invoices (i.e. collected later), 0–1. */
  creditSalesShare: number;
  /** Forecast monthly operating expenses. */
  monthlyExpenses: number;
  /** Forecast monthly cost of goods — the replenishment spend. */
  monthlyCogs: number;
  /** Extra stock buying funded by reinvested profit, per month. */
  monthlyGrowthPurchases: number;
};

const HORIZONS: readonly { id: CashFlowHorizonId; days: number; label: string }[] = [
  { id: "7", days: 7, label: "Next 7 days" },
  { id: "30", days: 30, label: "Next 30 days" },
  { id: "60", days: 60, label: "Next 60 days" },
  { id: "90", days: 90, label: "Next 90 days" },
];

export function buildCashFlowForecast(input: CashFlowInput): CashFlowForecast {
  const collectionDays =
    input.collectionPeriodDays !== null && input.collectionPeriodDays > 0
      ? input.collectionPeriodDays
      : 30;
  const creditShare = Math.min(1, Math.max(0, input.creditSalesShare));
  const dailyRevenue = input.monthlyRevenue / 30;
  const dailyExpenses = input.monthlyExpenses / 30;
  const dailyPurchases = (input.monthlyCogs + Math.max(0, input.monthlyGrowthPurchases)) / 30;

  const horizons: CashFlowHorizon[] = HORIZONS.map(({ id, days, label }) => {
    // The existing receivable book is released evenly across the collection period.
    const receivableRelease =
      roundMoney2(input.accountsReceivable * Math.min(1, days / collectionDays));

    // New cash sales land the same day; new credit sales land after the collection lag,
    // so only sales made in the first (days − lag) days are collected inside the horizon.
    const cashSales = dailyRevenue * (1 - creditShare) * days;
    const creditCollectedDays = Math.max(0, days - collectionDays);
    const creditSales = dailyRevenue * creditShare * creditCollectedDays;
    const newSalesCollections = roundMoney2(cashSales + creditSales);

    const operatingExpenses = roundMoney2(dailyExpenses * days);
    const inventoryPurchases = roundMoney2(dailyPurchases * days);
    const totalInflows = roundMoney2(receivableRelease + newSalesCollections);
    const totalOutflows = roundMoney2(operatingExpenses + inventoryPurchases);
    const closingCash = roundMoney2(input.openingCash + totalInflows - totalOutflows);

    return {
      id,
      days,
      label,
      openingCash: roundMoney2(input.openingCash),
      collectionsFromReceivables: receivableRelease,
      collectionsFromNewSales: newSalesCollections,
      totalInflows,
      operatingExpenses,
      inventoryPurchases,
      totalOutflows,
      closingCash,
      isNegative: closingCash < 0,
    };
  });

  return {
    horizons,
    warnings: buildCashFlowWarnings(horizons, input),
    assumptions: [
      `Outstanding customer balances of ${money(input.accountsReceivable)} are collected evenly over about ${collectionDays.toFixed(0)} days.`,
      `${(creditShare * 100).toFixed(0)}% of sales are billed on invoices and collected after that lag; the rest is treated as cash on the day.`,
      `Stock replenishment of ${money(input.monthlyCogs)} a month is paid immediately — TradeBridge records no supplier credit.`,
      "Loan movements and manual cash entries are not projected; only recorded trading flows are.",
    ],
  };
}

function buildCashFlowWarnings(
  horizons: readonly CashFlowHorizon[],
  input: CashFlowInput,
): CashFlowWarning[] {
  const warnings: CashFlowWarning[] = [];

  const firstNegative = horizons.find((h) => h.isNegative);
  if (firstNegative) {
    warnings.push({
      id: "cash_goes_negative",
      severity: "danger",
      title: `Cash is projected to run out within ${firstNegative.days} days`,
      detail: `On current pace, cash reaches ${money(firstNegative.closingCash)} by day ${firstNegative.days}: ${money(firstNegative.totalInflows)} coming in against ${money(firstNegative.totalOutflows)} going out. Slow the buying, collect faster, or bring capital in.`,
    });
  }

  const thirty = horizons.find((h) => h.id === "30");
  if (thirty && !thirty.isNegative && thirty.closingCash < thirty.totalOutflows * 0.25) {
    warnings.push({
      id: "thin_cash_buffer",
      severity: "warning",
      title: "Thin cash buffer over the next 30 days",
      detail: `Projected closing cash of ${money(thirty.closingCash)} is less than a quarter of the ${money(thirty.totalOutflows)} due to go out in the same period. A single slow-paying customer would be felt.`,
    });
  }

  if (thirty && thirty.inventoryPurchases > thirty.totalInflows) {
    warnings.push({
      id: "purchases_exceed_inflows",
      severity: "warning",
      title: "Stock buying is outpacing money coming in",
      detail: `Planned stock purchases of ${money(thirty.inventoryPurchases)} over 30 days exceed the ${money(thirty.totalInflows)} expected to be collected in the same window. Profitable trading can still run a business out of cash this way.`,
    });
  }

  if (input.accountsReceivable > input.monthlyRevenue && input.monthlyRevenue > 0) {
    warnings.push({
      id: "receivables_exceed_revenue",
      severity: "warning",
      title: "Customers owe more than a full month of sales",
      detail: `${money(input.accountsReceivable)} is outstanding against monthly sales of about ${money(input.monthlyRevenue)}. That much money sitting with customers is working capital you cannot spend.`,
    });
  }

  return warnings;
}

function money(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : ""}Rs. ${Math.abs(rounded).toLocaleString()}`;
}
