/**
 * Run: npm run test:bi-capital
 *
 * Working capital, the cash cycle, targets and the capital simulator — including
 * the case that matters most: supplier credit is not tracked, and the page must
 * say so instead of quietly treating it as zero-that-looks-measured.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCashCycle,
  buildRevenueCapacity,
  buildWorkingCapitalPosition,
} from "./workingCapital.ts";
import {
  buildBreakEven,
  buildRevenueTargetPlan,
  buildTargetPlan,
  monthsToReachRevenue,
  simulateAdditionalCapital,
  type BusinessEconomics,
} from "./targets.ts";
import { buildInventoryEfficiency } from "./inventoryEfficiency.ts";
import { simulateCollectionImprovement } from "./receivables.ts";
import { simulateSupplierTerms } from "./suppliers.ts";

const CYCLE_INPUT = {
  cogs: 300_000,
  averageInventory: 100_000,
  creditSales: 300_000,
  averageReceivables: 60_000,
  purchases: 300_000,
  averagePayables: null,
  periodDays: 30,
};

/* ── Cash conversion cycle ────────────────────────────────────────────── */

test("cash cycle reports untracked supplier credit honestly", () => {
  const cycle = buildCashCycle(CYCLE_INPUT);

  assert.equal(cycle.payableDaysTracked, false);
  assert.equal(cycle.payableDays, null);
  // The full cycle is unknown because one leg is unknown…
  assert.equal(cycle.cycleDays, null);
  // …but the ex-payables cycle is available for sizing, and is labelled.
  assert.equal(cycle.inventoryDays, 10);
  assert.equal(cycle.receivableDays, 6);
  assert.equal(cycle.cycleDaysExcludingPayables, 16);
  assert.equal(cycle.effectiveCycleDays, 16);
  assert.ok(cycle.explanation.includes("Supplier credit is not recorded"));
});

test("cash cycle subtracts supplier days when they are tracked", () => {
  const cycle = buildCashCycle({ ...CYCLE_INPUT, averagePayables: 100_000 });
  assert.equal(cycle.payableDaysTracked, true);
  assert.equal(cycle.payableDays, 10);
  assert.equal(cycle.cycleDays, 6);
  assert.equal(cycle.effectiveCycleDays, 6);
});

test("cash cycle is unmeasurable without sales or stock data", () => {
  const cycle = buildCashCycle({ ...CYCLE_INPUT, cogs: 0, creditSales: 0, averageInventory: null });
  assert.equal(cycle.effectiveCycleDays, null);
  assert.ok(cycle.explanation.toLowerCase().includes("not enough"));
});

/* ── Working capital position ─────────────────────────────────────────── */

const POSITION_INPUT = {
  cashOnHand: 200_000,
  accountsReceivable: 60_000,
  inventoryAtCost: 100_000,
  loansReceivable: 0,
  loansPayable: 50_000,
  supplierPayables: null,
  monthlyCogs: 300_000,
  monthlyExpenses: 40_000,
  cycleDays: 16,
};

test("available working capital nets recorded assets against recorded debts", () => {
  const position = buildWorkingCapitalPosition(POSITION_INPUT);
  // 200k cash + 60k receivable + 100k stock − 50k loans owed.
  assert.equal(position.available, 310_000);
  assert.equal(position.liquidCapital, 260_000);
});

test("required capital covers stock and running costs over the cycle", () => {
  const position = buildWorkingCapitalPosition(POSITION_INPUT);
  // 300k cogs × 16/30 = 160k; 40k expenses × 16/30 ≈ 21.33k.
  assert.ok(Math.abs((position.requiredForCurrentSales ?? 0) - 160_000) < 1);
  assert.ok(Math.abs((position.requiredForOperatingCosts ?? 0) - 21_333.33) < 1);
  assert.ok(Math.abs((position.requiredTotal ?? 0) - 181_333.33) < 1);
});

test("a surplus is reported as a surplus, a shortfall as a gap", () => {
  const surplus = buildWorkingCapitalPosition(POSITION_INPUT);
  assert.equal(surplus.hasSurplus, true);
  assert.ok((surplus.gap ?? 0) < 0);

  const short = buildWorkingCapitalPosition({ ...POSITION_INPUT, cashOnHand: 0, cycleDays: 60 });
  assert.equal(short.hasSurplus, false);
  assert.ok((short.gap ?? 0) > 0);
});

test("requirement is null when the cycle cannot be measured", () => {
  const position = buildWorkingCapitalPosition({ ...POSITION_INPUT, cycleDays: null });
  assert.equal(position.requiredTotal, null);
  assert.equal(position.gap, null);
  assert.equal(position.hasSurplus, null);
  // The available side is still a real, usable number.
  assert.equal(position.available, 310_000);
});

/* ── Revenue capacity ─────────────────────────────────────────────────── */

test("revenue capacity inverts the capital requirement", () => {
  const capacity = buildRevenueCapacity({
    availableCapital: 310_000,
    cycleDays: 16,
    cogsRatio: 0.87,
    currentMonthlyRevenue: 400_000,
    reinvestmentNextMonth: 20_000,
  });

  // 310k × 30/16 = 581.25k of COGS capacity → ÷ 0.87 ≈ 668k of revenue.
  assert.ok(Math.abs((capacity.cogsCapacity ?? 0) - 581_250) < 1);
  assert.ok(Math.abs((capacity.revenueCapacity ?? 0) - 581_250 / 0.87) < 1);
  assert.ok((capacity.headroom ?? 0) > 0);
  // Reinvestment lifts the ceiling.
  assert.ok((capacity.revenueCapacityWithReinvestment ?? 0) > (capacity.revenueCapacity ?? 0));
});

test("revenue capacity is null without a cycle or a margin", () => {
  assert.equal(
    buildRevenueCapacity({
      availableCapital: 310_000,
      cycleDays: null,
      cogsRatio: 0.87,
      currentMonthlyRevenue: 400_000,
      reinvestmentNextMonth: 0,
    }).revenueCapacity,
    null,
  );
  assert.equal(
    buildRevenueCapacity({
      availableCapital: 310_000,
      cycleDays: 16,
      cogsRatio: null,
      currentMonthlyRevenue: 400_000,
      reinvestmentNextMonth: 0,
    }).revenueCapacity,
    null,
  );
});

/* ── Inventory efficiency ─────────────────────────────────────────────── */

test("inventory turnover and holding days are consistent with each other", () => {
  const efficiency = buildInventoryEfficiency({
    cogs: 300_000,
    revenue: 345_000,
    averageInventory: 100_000,
    currentInventoryAtCost: 120_000,
    periodDays: 30,
  });

  assert.equal(efficiency.turnoverForPeriod, 3);
  assert.equal(efficiency.turnoverPerMonth, 3);
  assert.equal(efficiency.holdingDays, 10);
  // 345k a month against 100k of stock = Rs. 345,000 of sales per Rs. 100,000 held.
  assert.ok(Math.abs((efficiency.salesPerHundredThousand ?? 0) - 345_000) < 1);
  assert.ok(efficiency.rotationSentence.includes("Rs. 100,000"));
});

test("turnover across a 90-day period is normalised to a month", () => {
  const efficiency = buildInventoryEfficiency({
    cogs: 900_000,
    revenue: 1_035_000,
    averageInventory: 100_000,
    currentInventoryAtCost: 100_000,
    periodDays: 90,
  });
  assert.equal(efficiency.turnoverForPeriod, 9);
  assert.equal(efficiency.turnoverPerMonth, 3);
  assert.equal(efficiency.holdingDays, 10);
});

test("no stock and no sales report null instead of dividing by zero", () => {
  const empty = buildInventoryEfficiency({
    cogs: 0,
    revenue: 0,
    averageInventory: 0,
    currentInventoryAtCost: 0,
    periodDays: 30,
  });
  assert.equal(empty.turnoverForPeriod, null);
  assert.equal(empty.turnoverPerMonth, null);
  assert.equal(empty.holdingDays, null);
  assert.ok(empty.rotationSentence.toLowerCase().includes("needs"));
});

/* ── Break-even and targets ───────────────────────────────────────────── */

const ECONOMICS: BusinessEconomics = {
  grossMarginFraction: 0.13,
  cogsRatio: 0.87,
  fixedExpenses: 40_000,
  variableExpenseRate: 0.03,
  unclassifiedExpenses: 10_000,
  cycleDays: 30,
  turnoverPerMonth: 2,
  currentMonthlyRevenue: 600_000,
  currentMonthlyNetProfit: 10_000,
  availableWorkingCapital: 310_000,
  monthlyRevenueGrowth: 0.05,
};

test("break-even uses fixed costs over the contribution margin", () => {
  const breakEven = buildBreakEven(ECONOMICS);
  // (40k + 10k unclassified) / (0.13 − 0.03) = 500k.
  assert.equal(breakEven.breakEvenRevenue, 500_000);
  assert.equal(breakEven.fixedCosts, 50_000);
  assert.equal(breakEven.difference, 100_000);
  assert.ok((breakEven.marginOfSafetyPct ?? 0) > 16 && (breakEven.marginOfSafetyPct ?? 0) < 17);
  assert.ok(breakEven.sentence.includes("above"));
});

test("break-even below current revenue is described as operating below it", () => {
  const breakEven = buildBreakEven({ ...ECONOMICS, currentMonthlyRevenue: 300_000 });
  assert.ok((breakEven.marginOfSafetyPct ?? 0) < 0);
  assert.ok(breakEven.sentence.includes("below"));
});

test("break-even is unavailable without a measured margin", () => {
  const breakEven = buildBreakEven({ ...ECONOMICS, grossMarginFraction: null });
  assert.equal(breakEven.breakEvenRevenue, null);
  assert.ok(breakEven.sentence.toLowerCase().includes("needs"));
});

test("profit target converts into revenue, purchases and capital", () => {
  const plan = buildTargetPlan(300_000, ECONOMICS);
  assert.equal(plan.achievable, true);
  // (300k + 50k) / 0.10 = 3.5m of revenue.
  assert.equal(plan.requiredRevenue, 3_500_000);
  assert.equal(plan.additionalRevenue, 2_900_000);
  assert.ok(Math.abs((plan.requiredMonthlyPurchases ?? 0) - 3_045_000) < 1);
  // A 30-day cycle means one month of COGS has to be funded.
  assert.ok(Math.abs((plan.requiredWorkingCapital ?? 0) - 3_045_000) < 1);
  assert.ok((plan.additionalWorkingCapital ?? 0) > 0);
  assert.ok((plan.monthsToReach ?? 0) > 0);
});

test("an unreachable target says so instead of returning a number", () => {
  const plan = buildTargetPlan(300_000, {
    ...ECONOMICS,
    grossMarginFraction: 0.03,
    variableExpenseRate: 0.05,
  });
  assert.equal(plan.achievable, false);
  assert.equal(plan.requiredRevenue, null);
  assert.ok(plan.note.toLowerCase().includes("out of reach"));
});

test("a target already reached needs no time to reach", () => {
  const plan = buildTargetPlan(1_000, { ...ECONOMICS, currentMonthlyRevenue: 5_000_000 });
  assert.equal(plan.monthsToReach, 0);
});

test("revenue target costs out into profit and capital", () => {
  const plan = buildRevenueTargetPlan(1_000_000, ECONOMICS);
  assert.equal(plan.estimatedCogs, 870_000);
  assert.equal(plan.expectedGrossProfit, 130_000);
  // 40k fixed + 10k unclassified + 3% of 1m variable.
  assert.equal(plan.estimatedOperatingExpenses, 80_000);
  assert.equal(plan.expectedNetProfit, 50_000);
  assert.equal(plan.requiredPurchasingCapacity, 870_000);
  assert.ok((plan.workingCapitalGap ?? 0) > 0);
});

test("months-to-reach is null when growth is flat or negative", () => {
  assert.equal(monthsToReachRevenue(600_000, 1_000_000, 0), null);
  assert.equal(monthsToReachRevenue(600_000, 1_000_000, -0.05), null);
  assert.equal(monthsToReachRevenue(600_000, 500_000, 0.05), 0);
  assert.equal(monthsToReachRevenue(0, 500_000, 0.05), null);
  const months = monthsToReachRevenue(600_000, 1_000_000, 0.05);
  assert.ok(months !== null && months > 10 && months < 11);
});

/* ── Capital simulator ────────────────────────────────────────────────── */

test("extra capital is valued through rotation, not capital × margin", () => {
  const simulation = simulateAdditionalCapital({
    additionalCapital: 100_000,
    economics: ECONOMICS,
    demandHeadroom: null,
    currentWorkingCapitalGap: 50_000,
  });

  // Naive maths would be 100k × 13% = 13k of profit. Rotating twice a month, the
  // same capital produces roughly 229,885 of revenue and far more gross profit.
  assert.ok(Math.abs((simulation.additionalMonthlyRevenue ?? 0) - 200_000 / 0.87) < 1);
  assert.ok((simulation.additionalMonthlyGrossProfit ?? 0) > 13_000 * 1.5);
  assert.ok((simulation.additionalMonthlyNetProfit ?? 0) > 0);
  assert.equal(simulation.gapReduction, 50_000);
  assert.equal(simulation.remainingGap, -50_000);
  assert.ok((simulation.paybackMonths ?? 0) > 0);
});

test("extra capital is capped by demand and says so", () => {
  const simulation = simulateAdditionalCapital({
    additionalCapital: 100_000,
    economics: ECONOMICS,
    demandHeadroom: 20_000,
    currentWorkingCapitalGap: null,
  });
  assert.equal(simulation.additionalMonthlyRevenue, 20_000);
  assert.equal(simulation.cappedByDemand, true);
  assert.ok(simulation.note.toLowerCase().includes("demand"));
});

test("extra capital cannot be valued without rotation or margin", () => {
  const simulation = simulateAdditionalCapital({
    additionalCapital: 100_000,
    economics: { ...ECONOMICS, turnoverPerMonth: null },
    demandHeadroom: null,
    currentWorkingCapitalGap: null,
  });
  assert.equal(simulation.additionalMonthlyRevenue, null);
  assert.equal(simulation.additionalMonthlyNetProfit, null);
  assert.ok(simulation.note.toLowerCase().includes("only be valued"));
});

/* ── Collection and supplier-terms simulations ────────────────────────── */

test("collecting faster releases one day of credit sales per day saved", () => {
  const improvement = simulateCollectionImprovement({
    collectionPeriodDays: 12,
    creditSalesInPeriod: 300_000,
    periodDays: 30,
    daysFaster: 4,
  });
  // 300k over 30 days = 10k a day × 4 days saved.
  assert.equal(improvement.capitalReleased, 40_000);
  assert.equal(improvement.targetDays, 8);
  assert.ok(improvement.sentence.includes("estimate"));
});

test("collection simulation reports nothing when there are no credit sales", () => {
  const improvement = simulateCollectionImprovement({
    collectionPeriodDays: null,
    creditSalesInPeriod: 0,
    periodDays: 30,
    daysFaster: 4,
  });
  assert.equal(improvement.capitalReleased, null);
  assert.equal(improvement.daysSaved, null);
});

test("supplier terms are valued at one day of purchases per credit day", () => {
  const simulation = simulateSupplierTerms({
    monthlyPurchases: 300_000,
    targetTermDays: 15,
    currentTermDays: 0,
  });
  // 10k a day × 15 days.
  assert.equal(simulation.capitalFreed, 150_000);
  assert.ok(simulation.sentence.includes("estimate"));

  const noPurchases = simulateSupplierTerms({ monthlyPurchases: 0, targetTermDays: 15 });
  assert.equal(noPurchases.capitalFreed, null);
});
