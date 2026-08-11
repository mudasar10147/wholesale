/**
 * Targets and simulators: what it takes to reach a profit or revenue level, and
 * what an extra pot of capital would realistically do.
 *
 * Every figure here is a projection off measured economics (gross margin, expense
 * structure, inventory rotation, cash cycle) — never a promise. The capital
 * simulator deliberately does NOT compute `capital × margin`: capital only earns
 * a margin each time it rotates, so rotation speed drives the answer.
 */
import {
  breakEvenRevenue as breakEvenRevenueFormula,
  clamp,
  marginOfSafetyPct,
  revenueForTargetNetProfit,
  roundMoney2,
  workingCapitalRequired,
} from "@/lib/bi/finance";

/** The economics every target calculation is measured against. */
export type BusinessEconomics = {
  /** Gross margin as a fraction of revenue, from actual history. */
  grossMarginFraction: number | null;
  /** COGS as a fraction of revenue. */
  cogsRatio: number | null;
  /** Monthly fixed operating cost. */
  fixedExpenses: number;
  /** Variable operating cost as a fraction of revenue. */
  variableExpenseRate: number;
  /** Operating cost that could not be classified, carried flat. */
  unclassifiedExpenses: number;
  /** Cash conversion cycle in days, used to size working capital. */
  cycleDays: number | null;
  /** Measured inventory rotations per month. */
  turnoverPerMonth: number | null;
  /** Current monthly revenue at the run rate. */
  currentMonthlyRevenue: number;
  /** Current monthly net profit at the run rate. */
  currentMonthlyNetProfit: number;
  /** Working capital available today. */
  availableWorkingCapital: number;
  /** Expected monthly revenue growth as a fraction, from the forecast. */
  monthlyRevenueGrowth: number;
};

export type BreakEvenAnalysis = {
  breakEvenRevenue: number | null;
  currentRevenue: number;
  difference: number | null;
  marginOfSafetyPct: number | null;
  fixedCosts: number;
  contributionMarginPct: number | null;
  sentence: string;
};

export function buildBreakEven(economics: BusinessEconomics): BreakEvenAnalysis {
  const gm = economics.grossMarginFraction;
  const fixedCosts = roundMoney2(economics.fixedExpenses + economics.unclassifiedExpenses);

  if (gm === null) {
    return {
      breakEvenRevenue: null,
      currentRevenue: economics.currentMonthlyRevenue,
      difference: null,
      marginOfSafetyPct: null,
      fixedCosts,
      contributionMarginPct: null,
      sentence: "Break-even needs a measured gross margin, which needs recorded sales with stock costs.",
    };
  }

  const contribution = gm - economics.variableExpenseRate;
  const breakEven = breakEvenRevenueFormula(fixedCosts, gm, economics.variableExpenseRate);
  const difference = breakEven === null ? null : roundMoney2(economics.currentMonthlyRevenue - breakEven);
  const safety = marginOfSafetyPct(economics.currentMonthlyRevenue, breakEven);

  let sentence: string;
  if (breakEven === null) {
    sentence =
      "At the current margin, variable costs eat the whole contribution — no level of revenue covers fixed costs until the margin or the cost structure changes.";
  } else if (safety === null) {
    sentence = `Monthly revenue of about Rs. ${Math.round(breakEven).toLocaleString()} is needed to cover costs. No revenue is recorded for the current run rate to compare against.`;
  } else if (safety >= 0) {
    sentence = `TradeBridge is running about ${safety.toFixed(1)}% above its estimated break-even level of Rs. ${Math.round(breakEven).toLocaleString()} a month.`;
  } else {
    sentence = `TradeBridge is running about ${Math.abs(safety).toFixed(1)}% below its estimated break-even level of Rs. ${Math.round(breakEven).toLocaleString()} a month.`;
  }

  return {
    breakEvenRevenue: breakEven,
    currentRevenue: economics.currentMonthlyRevenue,
    difference,
    marginOfSafetyPct: safety,
    fixedCosts,
    contributionMarginPct: Number.isFinite(contribution) ? contribution * 100 : null,
    sentence,
  };
}

export type TargetPlan = {
  targetNetProfit: number;
  requiredRevenue: number | null;
  additionalRevenue: number | null;
  requiredRevenueIncreasePct: number | null;
  requiredGrossProfit: number | null;
  expectedExpenses: number | null;
  requiredMonthlyPurchases: number | null;
  requiredWorkingCapital: number | null;
  additionalWorkingCapital: number | null;
  /** Months to get there on the current growth trend. Null when the trend never reaches it. */
  monthsToReach: number | null;
  achievable: boolean;
  note: string;
};

/** What a target monthly net profit demands of revenue, purchases and capital. */
export function buildTargetPlan(
  targetNetProfit: number,
  economics: BusinessEconomics,
): TargetPlan {
  const gm = economics.grossMarginFraction;
  const fixed = economics.fixedExpenses + economics.unclassifiedExpenses;

  if (gm === null) {
    return {
      targetNetProfit,
      requiredRevenue: null,
      additionalRevenue: null,
      requiredRevenueIncreasePct: null,
      requiredGrossProfit: null,
      expectedExpenses: null,
      requiredMonthlyPurchases: null,
      requiredWorkingCapital: null,
      additionalWorkingCapital: null,
      monthsToReach: null,
      achievable: false,
      note: "A measured gross margin is needed before a profit target can be converted into a revenue target.",
    };
  }

  const requiredRevenue = revenueForTargetNetProfit(
    targetNetProfit,
    gm,
    economics.variableExpenseRate,
    fixed,
  );

  if (requiredRevenue === null) {
    return {
      targetNetProfit,
      requiredRevenue: null,
      additionalRevenue: null,
      requiredRevenueIncreasePct: null,
      requiredGrossProfit: null,
      expectedExpenses: null,
      requiredMonthlyPurchases: null,
      requiredWorkingCapital: null,
      additionalWorkingCapital: null,
      monthsToReach: null,
      achievable: false,
      note: "At the current margin and variable costs, extra revenue does not add profit — this target is out of reach without a pricing or cost change.",
    };
  }

  const requiredCogs = requiredRevenue * (economics.cogsRatio ?? 1 - gm);
  const requiredGrossProfit = roundMoney2(requiredRevenue - requiredCogs);
  const expectedExpenses = roundMoney2(fixed + economics.variableExpenseRate * requiredRevenue);
  const requiredWorkingCapital = workingCapitalRequired(requiredCogs, economics.cycleDays);
  const additionalRevenue = roundMoney2(requiredRevenue - economics.currentMonthlyRevenue);
  const monthsToReach = monthsToReachRevenue(
    economics.currentMonthlyRevenue,
    requiredRevenue,
    economics.monthlyRevenueGrowth,
  );

  return {
    targetNetProfit: roundMoney2(targetNetProfit),
    requiredRevenue: roundMoney2(requiredRevenue),
    additionalRevenue,
    requiredRevenueIncreasePct:
      economics.currentMonthlyRevenue > 0
        ? ((requiredRevenue - economics.currentMonthlyRevenue) / economics.currentMonthlyRevenue) * 100
        : null,
    requiredGrossProfit,
    expectedExpenses,
    requiredMonthlyPurchases: roundMoney2(requiredCogs),
    requiredWorkingCapital: requiredWorkingCapital === null ? null : roundMoney2(requiredWorkingCapital),
    additionalWorkingCapital:
      requiredWorkingCapital === null
        ? null
        : roundMoney2(Math.max(0, requiredWorkingCapital - economics.availableWorkingCapital)),
    monthsToReach,
    achievable: true,
    note: "Projection at today's margin, expense structure and cash cycle. It is not a forecast of certainty.",
  };
}

export type RevenueTargetPlan = {
  targetRevenue: number;
  estimatedCogs: number | null;
  expectedGrossProfit: number | null;
  estimatedOperatingExpenses: number | null;
  expectedNetProfit: number | null;
  requiredPurchasingCapacity: number | null;
  requiredWorkingCapital: number | null;
  workingCapitalGap: number | null;
  requiredRevenueIncreasePct: number | null;
  monthsToReach: number | null;
  note: string;
};

/** What a target monthly revenue implies for cost, profit and capital. */
export function buildRevenueTargetPlan(
  targetRevenue: number,
  economics: BusinessEconomics,
): RevenueTargetPlan {
  const ratio = economics.cogsRatio;
  if (ratio === null || !Number.isFinite(targetRevenue) || targetRevenue < 0) {
    return {
      targetRevenue: Math.max(0, targetRevenue),
      estimatedCogs: null,
      expectedGrossProfit: null,
      estimatedOperatingExpenses: null,
      expectedNetProfit: null,
      requiredPurchasingCapacity: null,
      requiredWorkingCapital: null,
      workingCapitalGap: null,
      requiredRevenueIncreasePct: null,
      monthsToReach: null,
      note: "A measured cost-to-revenue ratio is needed before a revenue target can be costed.",
    };
  }

  const cogs = targetRevenue * ratio;
  const grossProfit = targetRevenue - cogs;
  const expenses =
    economics.fixedExpenses +
    economics.unclassifiedExpenses +
    economics.variableExpenseRate * targetRevenue;
  const requiredWorkingCapital = workingCapitalRequired(cogs, economics.cycleDays);

  return {
    targetRevenue: roundMoney2(targetRevenue),
    estimatedCogs: roundMoney2(cogs),
    expectedGrossProfit: roundMoney2(grossProfit),
    estimatedOperatingExpenses: roundMoney2(expenses),
    expectedNetProfit: roundMoney2(grossProfit - expenses),
    requiredPurchasingCapacity: roundMoney2(cogs),
    requiredWorkingCapital: requiredWorkingCapital === null ? null : roundMoney2(requiredWorkingCapital),
    workingCapitalGap:
      requiredWorkingCapital === null
        ? null
        : roundMoney2(requiredWorkingCapital - economics.availableWorkingCapital),
    requiredRevenueIncreasePct:
      economics.currentMonthlyRevenue > 0
        ? ((targetRevenue - economics.currentMonthlyRevenue) / economics.currentMonthlyRevenue) * 100
        : null,
    monthsToReach: monthsToReachRevenue(
      economics.currentMonthlyRevenue,
      targetRevenue,
      economics.monthlyRevenueGrowth,
    ),
    note: "Projection at today's margin, expense structure and cash cycle.",
  };
}

export type CapitalSimulation = {
  additionalCapital: number;
  /** Extra stock the capital buys once. */
  additionalInventory: number;
  /** How many times that stock turns over in a month, from measured history. */
  rotationsPerMonth: number | null;
  additionalMonthlyRevenue: number | null;
  additionalMonthlyGrossProfit: number | null;
  additionalMonthlyNetProfit: number | null;
  /** Days for the capital to come back as cash — the cash conversion cycle. */
  capitalRecycleDays: number | null;
  /** Effect on the working-capital gap: positive means the gap shrinks by this much. */
  gapReduction: number | null;
  remainingGap: number | null;
  /** Months of added net profit to earn the capital back. */
  paybackMonths: number | null;
  cappedByDemand: boolean;
  note: string;
};

/**
 * What an extra Rs. X would actually do. Capital buys stock; stock rotates at the
 * measured speed; each rotation earns the measured margin; and the whole thing is
 * capped by what demand can absorb.
 */
export function simulateAdditionalCapital(params: {
  additionalCapital: number;
  economics: BusinessEconomics;
  /** Extra monthly revenue the demand trend still has room for; null when unknown. */
  demandHeadroom: number | null;
  currentWorkingCapitalGap: number | null;
}): CapitalSimulation {
  const { economics } = params;
  const capital = Number.isFinite(params.additionalCapital) ? Math.max(0, params.additionalCapital) : 0;
  const rotations = economics.turnoverPerMonth;
  const ratio = economics.cogsRatio;

  const uncappedRevenue =
    rotations !== null && rotations > 0 && ratio !== null && ratio > 0
      ? (capital * rotations) / ratio
      : null;

  let additionalMonthlyRevenue = uncappedRevenue;
  let cappedByDemand = false;
  if (uncappedRevenue !== null && params.demandHeadroom !== null) {
    const headroom = Math.max(0, params.demandHeadroom);
    if (headroom < uncappedRevenue) {
      additionalMonthlyRevenue = headroom;
      cappedByDemand = true;
    }
  }

  const additionalMonthlyGrossProfit =
    additionalMonthlyRevenue !== null && ratio !== null
      ? additionalMonthlyRevenue * (1 - ratio)
      : null;
  // Only variable costs follow extra volume; fixed costs are already covered.
  const additionalMonthlyNetProfit =
    additionalMonthlyGrossProfit !== null && additionalMonthlyRevenue !== null
      ? additionalMonthlyGrossProfit - additionalMonthlyRevenue * Math.max(0, economics.variableExpenseRate)
      : null;

  const gapReduction = params.currentWorkingCapitalGap === null ? null : Math.min(capital, Math.max(0, params.currentWorkingCapitalGap));
  const remainingGap =
    params.currentWorkingCapitalGap === null ? null : roundMoney2(params.currentWorkingCapitalGap - capital);

  const paybackMonths =
    additionalMonthlyNetProfit !== null && additionalMonthlyNetProfit > 0
      ? capital / additionalMonthlyNetProfit
      : null;

  let note: string;
  if (additionalMonthlyRevenue === null) {
    note =
      "Extra capital can only be valued once inventory rotation and gross margin are measurable from recorded sales and stock costs.";
  } else if (cappedByDemand) {
    note =
      "The capital could support more buying than current demand absorbs, so the extra sales are capped at what the sales trend supports. Growing demand — not more capital — is what would unlock the rest.";
  } else {
    note = `Rs. ${Math.round(capital).toLocaleString()} of stock rotating ${rotations?.toFixed(2)}× a month at the measured margin. Projection, not a promise.`;
  }

  return {
    additionalCapital: roundMoney2(capital),
    additionalInventory: roundMoney2(capital),
    rotationsPerMonth: rotations,
    additionalMonthlyRevenue: additionalMonthlyRevenue === null ? null : roundMoney2(additionalMonthlyRevenue),
    additionalMonthlyGrossProfit:
      additionalMonthlyGrossProfit === null ? null : roundMoney2(additionalMonthlyGrossProfit),
    additionalMonthlyNetProfit:
      additionalMonthlyNetProfit === null ? null : roundMoney2(additionalMonthlyNetProfit),
    capitalRecycleDays: economics.cycleDays,
    gapReduction: gapReduction === null ? null : roundMoney2(gapReduction),
    remainingGap,
    paybackMonths,
    cappedByDemand,
    note,
  };
}

/** Default milestone ladder for a wholesale business, in PKR of monthly net profit. */
export const PROFIT_MILESTONES: readonly number[] = [100_000, 250_000, 500_000, 1_000_000];

export type ProfitMilestone = TargetPlan & { reached: boolean };

export function buildProfitMilestones(
  economics: BusinessEconomics,
  milestones: readonly number[] = PROFIT_MILESTONES,
): ProfitMilestone[] {
  return milestones.map((target) => ({
    ...buildTargetPlan(target, economics),
    reached: economics.currentMonthlyNetProfit >= target,
  }));
}

/**
 * Months for revenue to grow from `current` to `target` at a monthly rate.
 * Null when growth is flat or negative and the target is above today's level.
 */
export function monthsToReachRevenue(
  current: number,
  target: number,
  monthlyGrowth: number,
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return null;
  if (target <= current) return 0;
  if (current <= 0) return null;
  const rate = clamp(monthlyGrowth, -0.9, 5);
  if (rate <= 0.0005) return null;
  const months = Math.log(target / current) / Math.log(1 + rate);
  return Number.isFinite(months) && months > 0 ? months : null;
}
