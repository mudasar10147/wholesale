/**
 * Reinvestment and compounding.
 *
 * TradeBridge puts 100% of retained profit back into the business, so the growth
 * loop is:
 *
 *   profit → reinvested → purchasing power → inventory → revenue → profit
 *
 * The important modelling decision: extra inventory does NOT automatically become
 * revenue. Each projected month takes the *lower* of
 *
 *   • demand    — what the sales trend says customers will actually buy, and
 *   • capacity  — what the capital base can carry, given how fast that capital
 *                 currently rotates (measured inventory turnover),
 *
 * so a business with plenty of stock but flat demand does not get a fantasy
 * forecast, and a business with strong demand but thin capital is correctly shown
 * as capital-constrained. Which of the two binds is reported per month and drives
 * the growth-constraint diagnosis.
 */
import { clamp, roundMoney2 } from "@/lib/bi/finance";

export type BindingConstraint = "demand" | "capital" | "unknown";

export type CompoundingMonth = {
  monthOffset: number;
  label: string;
  /** Capital available to hold inventory at the start of the month. */
  openingCapital: number;
  /** Revenue the sales trend alone predicts. */
  demandRevenue: number;
  /** Revenue the capital base can support at the measured rotation speed. */
  capacityRevenue: number | null;
  /** min(demand, capacity) — what the model actually projects. */
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  reinvestedProfit: number;
  cumulativeReinvested: number;
  /** Cash the month allows to be spent on stock (replenishment + growth). */
  purchasingCapacity: number;
  closingCapital: number;
  workingCapital: number;
  bindingConstraint: BindingConstraint;
};

export type CompoundingProjection = {
  months: CompoundingMonth[];
  /** 100% for TradeBridge; kept as a parameter so the rule is visible, not buried. */
  reinvestmentRate: number;
  /** Measured monthly inventory rotation used to convert capital into throughput. */
  turnoverPerMonth: number | null;
  totalReinvested: number;
  /** Constraint that binds most often across the horizon. */
  dominantConstraint: BindingConstraint;
};

export type CompoundingInput = {
  /** Capital that can be deployed into inventory today (cash + receivables + stock). */
  openingCapital: number;
  /** Measured inventory turns per month. Null disables the capacity ceiling. */
  turnoverPerMonth: number | null;
  /** COGS as a fraction of revenue, from actual history. */
  cogsRatio: number | null;
  /** Monthly fixed operating cost, from classified expense history. */
  fixedExpenses: number;
  /** Variable operating cost as a fraction of revenue, from classified expense history. */
  variableExpenseRate: number;
  /** Operating cost that could not be classified — carried at a flat monthly amount. */
  unclassifiedExpenses: number;
  /** Demand-side revenue projection per month ahead, index 0 = next month. */
  demandRevenueByMonth: readonly number[];
  /** Month labels aligned with `demandRevenueByMonth`. */
  labels: readonly string[];
  /** Fraction of net profit put back in. TradeBridge: 1.0. */
  reinvestmentRate?: number;
};

export const FULL_REINVESTMENT_RATE = 1;

/**
 * Run the compounding loop month by month. Every month's capital base grows only
 * by the profit actually generated in the previous month.
 */
export function projectCompounding(input: CompoundingInput): CompoundingProjection {
  const reinvestmentRate = clamp(input.reinvestmentRate ?? FULL_REINVESTMENT_RATE, 0, 1);
  const cogsRatio = input.cogsRatio !== null && input.cogsRatio > 0 ? clamp(input.cogsRatio, 0.01, 0.999) : null;
  const months: CompoundingMonth[] = [];

  let capital = Math.max(0, input.openingCapital);
  let cumulativeReinvested = 0;
  const constraintCounts: Record<BindingConstraint, number> = { demand: 0, capital: 0, unknown: 0 };

  for (let i = 0; i < input.demandRevenueByMonth.length; i += 1) {
    const demandRevenue = Math.max(0, input.demandRevenueByMonth[i] ?? 0);
    const openingCapital = capital;

    // Capital × rotations per month = cost of goods the capital can push through.
    const capacityCogs =
      input.turnoverPerMonth !== null && input.turnoverPerMonth > 0
        ? openingCapital * input.turnoverPerMonth
        : null;
    const capacityRevenue =
      capacityCogs !== null && cogsRatio !== null ? capacityCogs / cogsRatio : null;

    let revenue: number;
    let bindingConstraint: BindingConstraint;
    if (capacityRevenue === null) {
      revenue = demandRevenue;
      bindingConstraint = "unknown";
    } else if (capacityRevenue < demandRevenue) {
      revenue = capacityRevenue;
      bindingConstraint = "capital";
    } else {
      revenue = demandRevenue;
      bindingConstraint = "demand";
    }
    constraintCounts[bindingConstraint] += 1;

    const cogs = cogsRatio === null ? 0 : revenue * cogsRatio;
    const grossProfit = revenue - cogs;
    const expenses =
      input.fixedExpenses +
      input.unclassifiedExpenses +
      Math.max(0, input.variableExpenseRate) * revenue;
    const netProfit = grossProfit - expenses;
    const reinvested = netProfit > 0 ? netProfit * reinvestmentRate : netProfit;
    cumulativeReinvested += reinvested;

    // Buying next month replaces what was sold and adds whatever profit was put back.
    const purchasingCapacity = Math.max(0, cogs + Math.max(0, reinvested));
    const closingCapital = Math.max(0, openingCapital + reinvested);

    months.push({
      monthOffset: i + 1,
      label: input.labels[i] ?? `Month +${i + 1}`,
      openingCapital: roundMoney2(openingCapital),
      demandRevenue: roundMoney2(demandRevenue),
      capacityRevenue: capacityRevenue === null ? null : roundMoney2(capacityRevenue),
      revenue: roundMoney2(revenue),
      cogs: roundMoney2(cogs),
      grossProfit: roundMoney2(grossProfit),
      expenses: roundMoney2(expenses),
      netProfit: roundMoney2(netProfit),
      reinvestedProfit: roundMoney2(reinvested),
      cumulativeReinvested: roundMoney2(cumulativeReinvested),
      purchasingCapacity: roundMoney2(purchasingCapacity),
      closingCapital: roundMoney2(closingCapital),
      workingCapital: roundMoney2(closingCapital),
      bindingConstraint,
    });

    capital = closingCapital;
  }

  const dominantConstraint = (Object.keys(constraintCounts) as BindingConstraint[]).reduce(
    (best, key) => (constraintCounts[key] > constraintCounts[best] ? key : best),
    "unknown" as BindingConstraint,
  );

  return {
    months,
    reinvestmentRate,
    turnoverPerMonth: input.turnoverPerMonth,
    totalReinvested: roundMoney2(cumulativeReinvested),
    dominantConstraint,
  };
}

export type ReinvestmentCycle = {
  estimatedNetProfitThisMonth: number;
  amountReinvested: number;
  purchasingCapacityIncrease: number;
  additionalInventorySupported: number;
  potentialAdditionalSales: number | null;
  potentialAdditionalGrossProfit: number | null;
  potentialAdditionalNetProfit: number | null;
  /** True when the extra sales are limited by demand rather than by the new stock. */
  cappedByDemand: boolean;
  note: string;
};

/**
 * One turn of the reinvestment loop, in the owner's terms: this much profit goes
 * back in, buys this much stock, which — rotating at the measured speed and
 * subject to what customers actually buy — could add this much sales and profit.
 */
export function buildReinvestmentCycle(params: {
  netProfitThisMonth: number;
  reinvestmentRate?: number;
  turnoverPerMonth: number | null;
  cogsRatio: number | null;
  variableExpenseRate: number;
  /** Extra revenue the demand trend has room for next month; null when unknown. */
  demandHeadroom: number | null;
}): ReinvestmentCycle {
  const rate = clamp(params.reinvestmentRate ?? FULL_REINVESTMENT_RATE, 0, 1);
  const profit = Number.isFinite(params.netProfitThisMonth) ? params.netProfitThisMonth : 0;
  const reinvested = profit > 0 ? profit * rate : 0;

  // Reinvested profit becomes stock, and that stock rotates `turnover` times a month.
  const extraCogs =
    params.turnoverPerMonth !== null && params.turnoverPerMonth > 0
      ? reinvested * params.turnoverPerMonth
      : null;
  const ratio = params.cogsRatio !== null && params.cogsRatio > 0 ? params.cogsRatio : null;
  const uncappedSales = extraCogs !== null && ratio !== null ? extraCogs / ratio : null;

  let potentialAdditionalSales = uncappedSales;
  let cappedByDemand = false;
  if (uncappedSales !== null && params.demandHeadroom !== null) {
    const headroom = Math.max(0, params.demandHeadroom);
    if (headroom < uncappedSales) {
      potentialAdditionalSales = headroom;
      cappedByDemand = true;
    }
  }

  const potentialAdditionalGrossProfit =
    potentialAdditionalSales !== null && ratio !== null
      ? potentialAdditionalSales * (1 - ratio)
      : null;
  const potentialAdditionalNetProfit =
    potentialAdditionalGrossProfit !== null && potentialAdditionalSales !== null
      ? potentialAdditionalGrossProfit - potentialAdditionalSales * Math.max(0, params.variableExpenseRate)
      : null;

  const note = cappedByDemand
    ? "The extra stock could turn over faster than current demand absorbs it, so the added sales are capped at what the sales trend supports."
    : potentialAdditionalSales === null
      ? "Measured inventory rotation and a gross margin are both needed before extra stock can be converted into extra sales."
      : "Extra stock is converted to sales at the inventory rotation speed measured from your own history.";

  return {
    estimatedNetProfitThisMonth: roundMoney2(profit),
    amountReinvested: roundMoney2(reinvested),
    purchasingCapacityIncrease: roundMoney2(reinvested),
    additionalInventorySupported: roundMoney2(reinvested),
    potentialAdditionalSales: potentialAdditionalSales === null ? null : roundMoney2(potentialAdditionalSales),
    potentialAdditionalGrossProfit:
      potentialAdditionalGrossProfit === null ? null : roundMoney2(potentialAdditionalGrossProfit),
    potentialAdditionalNetProfit:
      potentialAdditionalNetProfit === null ? null : roundMoney2(potentialAdditionalNetProfit),
    cappedByDemand,
    note,
  };
}
