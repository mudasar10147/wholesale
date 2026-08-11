/**
 * The Business Intelligence orchestrator.
 *
 * Takes the single loaded dataset plus the user's period/horizon/scenario choices
 * and produces the whole report in one pass. Every section reads from the same
 * derived numbers, so nothing is computed twice and no section can disagree with
 * another.
 */
import type { InventoryDiscardDoc, InvoiceReturnDoc } from "@/lib/types/firestore";
import { computeCashInHandSnapshot, type CashInHandSnapshot } from "@/lib/finance/loadCashInHand";
import { computeLoanBalances } from "@/lib/finance/loanBalances";
import { num, timestampToDate, voidInvoiceIdSet, type BusinessDataset, type WithId } from "@/lib/bi/dataset";
import {
  buildCostByProductId,
  buildMonthlySeries,
  computeRangeTotals,
  type MonthlyPoint,
  type MonthlySeries,
  type RangeTotals,
} from "@/lib/bi/monthlySeries";
import {
  currentMonthProgress,
  daysInMonthKey,
  formatMonthLabel,
  monthKey,
  shiftMonthKey,
  type AnalysisPeriod,
  type ForecastHorizonId,
} from "@/lib/bi/periods";
import {
  buildMetricForecast,
  monthRunRate,
  type MetricForecast,
  type ScenarioId,
} from "@/lib/bi/forecast";
import {
  buildExpenseBreakdown,
  classifyExpenseTitle,
  type ExpenseBreakdown,
} from "@/lib/bi/expenseCategories";
import {
  buildCashCycle,
  buildRevenueCapacity,
  buildWorkingCapitalPosition,
  type CashCycle,
  type RevenueCapacity,
  type WorkingCapitalPosition,
} from "@/lib/bi/workingCapital";
import {
  buildInventoryEfficiency,
  buildInventoryGrowthForecast,
  type InventoryEfficiency,
  type InventoryGrowthForecast,
} from "@/lib/bi/inventoryEfficiency";
import {
  buildReinvestmentCycle,
  projectCompounding,
  type CompoundingProjection,
  type ReinvestmentCycle,
} from "@/lib/bi/reinvestment";
import {
  buildReceivablesReport,
  simulateCollectionImprovement,
  type CollectionImprovement,
  type ReceivablesReport,
} from "@/lib/bi/receivables";
import { buildSupplierReport, simulateSupplierTerms, type SupplierReport, type SupplierTermsSimulation } from "@/lib/bi/suppliers";
import {
  buildProductIntelligence,
  type ProductIntelligence,
} from "@/lib/bi/productIntelligence";
import {
  buildBreakEven,
  buildProfitMilestones,
  type BreakEvenAnalysis,
  type BusinessEconomics,
  type ProfitMilestone,
} from "@/lib/bi/targets";
import { buildCashFlowForecast, type CashFlowForecast } from "@/lib/bi/cashFlow";
import {
  buildInsights,
  buildOpportunities,
  buildRisks,
  diagnoseGrowthConstraint,
  type GrowthConstraint,
  type Insight,
  type InsightInput,
  type RiskOrOpportunity,
} from "@/lib/bi/insights";
import { expenseRatioPct, percentChange, roundMoney2 } from "@/lib/bi/finance";

/** How many days sooner the collection simulation assumes customers could pay. */
export const COLLECTION_IMPROVEMENT_DAYS = 4;
/** Supplier-terms what-if target, in days. */
export const SUPPLIER_TERMS_TARGET_DAYS = 15;
/** Months of history the fixed/variable expense split is averaged over. */
export const EXPENSE_WINDOW_MONTHS = 6;

export type ExecutiveMetric = {
  label: string;
  /** Projected value for next month. */
  forecast: number;
  /** Comparable current-month figure (full-month run rate when the month is partial). */
  current: number;
  change: number;
  changePct: number | null;
};

export type ExecutiveForecast = {
  revenue: ExecutiveMetric;
  grossProfit: ExecutiveMetric;
  netProfit: ExecutiveMetric;
  expenses: ExecutiveMetric;
  /** What next month's cash and collections allow to be spent on stock. */
  purchasingCapacity: number;
  /** What must be spent on stock to sustain the forecast (replenishment + growth). */
  purchasingRequirement: number;
  purchasingShortfall: number;
  fixedExpenseForecast: number;
  variableExpenseForecast: number;
  unclassifiedExpenseForecast: number;
  /** Actual month-to-date revenue, before any run-rate projection. */
  currentMonthToDateRevenue: number;
  currentMonthDaysElapsed: number;
  currentMonthDaysTotal: number;
  sentence: string;
};

export type MonthComparisonRow = {
  label: string;
  current: number | null;
  previous: number | null;
  change: number | null;
  changePct: number | null;
  format: "money" | "percent" | "number" | "days" | "turns";
};

export type ExpenseIntelligence = {
  breakdown: ExpenseBreakdown;
  totalExpenses: number;
  expenseRatioPct: number | null;
  previousExpenseRatioPct: number | null;
  /** Monthly averages used by the forecast, derived from completed months. */
  monthlyFixed: number;
  monthlyUnclassified: number;
  variableRate: number;
  windowMonths: number;
  note: string;
};

export type BusinessIntelligenceReport = {
  now: Date;
  period: AnalysisPeriod;
  scenario: ScenarioId;
  horizonMonths: number;
  series: MonthlySeries;
  periodTotals: RangeTotals;
  previousTotals: RangeTotals;
  /** Monthly run rate for the selected period, normalised to 30 days. */
  monthly: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    expenses: number;
    netProfit: number;
    purchases: number;
  };
  cash: CashInHandSnapshot;
  executive: ExecutiveForecast;
  forecasts: {
    revenue: MetricForecast;
    grossProfit: MetricForecast;
    netProfit: MetricForecast;
  };
  compounding: CompoundingProjection;
  reinvestmentCycle: ReinvestmentCycle;
  workingCapital: WorkingCapitalPosition;
  revenueCapacity: RevenueCapacity;
  cashCycle: CashCycle;
  inventoryEfficiency: InventoryEfficiency;
  inventoryGrowth: InventoryGrowthForecast;
  products: ProductIntelligence;
  expenses: ExpenseIntelligence;
  breakEven: BreakEvenAnalysis;
  milestones: ProfitMilestone[];
  economics: BusinessEconomics;
  cashFlow: CashFlowForecast;
  receivables: ReceivablesReport;
  collectionImprovement: CollectionImprovement;
  suppliers: SupplierReport;
  supplierTerms: SupplierTermsSimulation;
  monthComparison: {
    currentLabel: string;
    previousLabel: string;
    rows: MonthComparisonRow[];
  };
  insights: Insight[];
  opportunities: RiskOrOpportunity[];
  risks: RiskOrOpportunity[];
  growthConstraint: GrowthConstraint;
  /** Metrics that could not be computed, with the data each one needs. */
  dataGaps: { metric: string; reason: string }[];
};

export type AnalyzeOptions = {
  period: AnalysisPeriod;
  horizon: ForecastHorizonId;
  scenario: ScenarioId;
  /** Target monthly net profit for the custom calculator. */
  profitTarget?: number;
  /** Extra capital for the simulator. */
  additionalCapital?: number;
};

/** Damaged write-offs (returns + discards) bucketed by calendar month. */
function writeOffsByMonth(
  invoiceReturns: readonly WithId<InvoiceReturnDoc>[],
  discards: readonly WithId<InventoryDiscardDoc>[],
): Map<string, number> {
  const map = new Map<string, number>();
  const add = (date: Date | null, value: number) => {
    if (!date || !Number.isFinite(value) || value === 0) return;
    const key = monthKey(date);
    map.set(key, (map.get(key) ?? 0) + value);
  };

  for (const row of invoiceReturns) {
    if (row.data.status !== "posted") continue;
    add(timestampToDate(row.data.posted_at), num(row.data.write_off_cogs_amount));
  }
  for (const row of discards) {
    add(timestampToDate(row.data.created_at), num(row.data.total_cogs_amount));
  }
  return map;
}

function sumWriteOffsInRange(map: ReadonlyMap<string, number>, start: Date, end: Date): number {
  let total = 0;
  const startKey = monthKey(start);
  const endKey = monthKey(end);
  for (const [key, value] of map) {
    if (key >= startKey && key <= endKey) total += value;
  }
  return total;
}

/** Normalise a period total to a 30-day month so periods of different lengths compare. */
function toMonthlyRate(total: number, days: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(days) || days <= 0) return 0;
  return roundMoney2((total / days) * 30);
}

/**
 * Fixed / variable / unclassified expense structure, averaged over recent
 * completed months so a single unusual month cannot set the forecast.
 */
function buildExpenseStructure(
  dataset: BusinessDataset,
  series: MonthlySeries,
  periodTotals: RangeTotals,
  period: AnalysisPeriod,
): { monthlyFixed: number; monthlyUnclassified: number; variableRate: number; windowMonths: number } {
  const windowMonths = series.completed.slice(-EXPENSE_WINDOW_MONTHS);
  const keys = new Set(windowMonths.map((m) => m.key));

  let fixed = 0;
  let variable = 0;
  let unclassified = 0;
  for (const row of dataset.expenses) {
    const date = timestampToDate(row.data.date);
    if (!date || !keys.has(monthKey(date))) continue;
    const amount = num(row.data.amount);
    const nature = classifyExpenseTitle(row.data.title).nature;
    if (nature === "fixed") fixed += amount;
    else if (nature === "variable") variable += amount;
    else unclassified += amount;
  }

  const monthCount = windowMonths.length;
  const windowRevenue = windowMonths.reduce((sum, m) => sum + m.revenue, 0);

  if (monthCount === 0) {
    // No completed month yet — fall back to the selected period, scaled to a month.
    const breakdown = buildExpenseBreakdown(
      dataset.expenses
        .filter((row) => {
          const date = timestampToDate(row.data.date);
          return !!date && date >= period.start && date <= period.end;
        })
        .map((row) => ({ title: row.data.title, amount: row.data.amount })),
    );
    return {
      monthlyFixed: toMonthlyRate(breakdown.fixed, period.days),
      monthlyUnclassified: toMonthlyRate(breakdown.unknown, period.days),
      variableRate: periodTotals.revenue > 0 ? breakdown.variable / periodTotals.revenue : 0,
      windowMonths: 0,
    };
  }

  return {
    monthlyFixed: roundMoney2(fixed / monthCount),
    monthlyUnclassified: roundMoney2(unclassified / monthCount),
    variableRate: windowRevenue > 0 ? variable / windowRevenue : 0,
    windowMonths: monthCount,
  };
}

export function analyzeBusiness(
  dataset: BusinessDataset,
  options: AnalyzeOptions,
): BusinessIntelligenceReport {
  const { now } = dataset;
  const period = options.period;
  const scenario = options.scenario;
  const horizonMonths = Number(options.horizon);

  const voidInvoiceIds = voidInvoiceIdSet(dataset.invoices);
  const costByProductId = buildCostByProductId(dataset.products);
  const writeOffs = writeOffsByMonth(dataset.invoiceReturns, dataset.inventoryDiscards);

  const currentInventoryAtLotCost = dataset.stockLots.reduce((sum, row) => {
    const remaining = num(row.data.qty_remaining);
    return remaining > 0 ? sum + remaining * num(row.data.unit_cost) : sum;
  }, 0);

  const series = buildMonthlySeries({
    now,
    from: dataset.historyStart,
    sales: dataset.sales,
    expenses: dataset.expenses,
    stockLots: dataset.stockLots,
    voidInvoiceIds,
    costByProductId,
    writeOffsByMonth: writeOffs,
    currentInventoryAtLotCost,
  });

  const periodTotals = computeRangeTotals({
    start: period.start,
    end: period.end,
    sales: dataset.sales,
    expenses: dataset.expenses,
    stockLots: dataset.stockLots,
    voidInvoiceIds,
    costByProductId,
    writeOffsInRange: sumWriteOffsInRange(writeOffs, period.start, period.end),
  });

  const previousTotals = computeRangeTotals({
    start: period.previous.start,
    end: period.previous.end,
    sales: dataset.sales,
    expenses: dataset.expenses,
    stockLots: dataset.stockLots,
    voidInvoiceIds,
    costByProductId,
    writeOffsInRange: sumWriteOffsInRange(writeOffs, period.previous.start, period.previous.end),
  });

  const monthly = {
    revenue: toMonthlyRate(periodTotals.revenue, period.days),
    cogs: toMonthlyRate(periodTotals.cogs, period.days),
    grossProfit: toMonthlyRate(periodTotals.grossProfit, period.days),
    expenses: toMonthlyRate(periodTotals.expenses, period.days),
    netProfit: toMonthlyRate(periodTotals.netProfit, period.days),
    purchases: toMonthlyRate(periodTotals.purchases, period.days),
  };

  const cash = computeCashInHandSnapshot({
    sales: dataset.sales.map((r) => r.data),
    expenses: dataset.expenses.map((r) => r.data),
    invoices: dataset.invoices.map((r) => r.data),
    stockLots: dataset.stockLots.map((r) => r.data),
    cashEntries: dataset.cashEntries.map((r) => r.data),
    openingBalance: dataset.cashOpeningBalance,
    actualCashBalance: dataset.actualCashBalance,
  });

  const loans = computeLoanBalances(dataset.cashEntries.map((r) => r.data));

  /* ── Product & category intelligence ─────────────────────────────────── */
  const products = buildProductIntelligence({
    products: dataset.products,
    sales: dataset.sales,
    stockLots: dataset.stockLots,
    voidInvoiceIds,
    costByProductId,
    periodStart: period.start,
    periodEnd: period.end,
    periodDays: period.days,
    now,
    monthlyRevenue: monthly.revenue,
  });

  /* ── Receivables ─────────────────────────────────────────────────────── */
  const receivables = buildReceivablesReport({
    invoices: dataset.invoices,
    customers: dataset.customers,
    now,
    creditSalesInPeriod: periodTotals.creditSales,
    totalSalesInPeriod: periodTotals.revenue,
    periodDays: period.days,
  });

  const collectionImprovement = simulateCollectionImprovement({
    collectionPeriodDays: receivables.collectionPeriodDays,
    creditSalesInPeriod: periodTotals.creditSales,
    periodDays: period.days,
    daysFaster: COLLECTION_IMPROVEMENT_DAYS,
  });

  /* ── Inventory efficiency & cash cycle ───────────────────────────────── */
  const periodMonths = series.points.filter(
    (p) => p.key >= monthKey(period.start) && p.key <= monthKey(period.end),
  );
  const openingInventoryEstimate = openingInventoryFor(series, period.start);
  const averageInventory = averageInventoryAcross(periodMonths, openingInventoryEstimate, currentInventoryAtLotCost);

  const inventoryEfficiency = buildInventoryEfficiency({
    cogs: periodTotals.cogs,
    revenue: periodTotals.revenue,
    averageInventory,
    currentInventoryAtCost: currentInventoryAtLotCost,
    periodDays: period.days,
  });

  const cashCycle = buildCashCycle({
    cogs: periodTotals.cogs,
    averageInventory,
    creditSales: periodTotals.creditSales,
    averageReceivables: receivables.totalOutstanding,
    purchases: periodTotals.purchases,
    // TradeBridge records no supplier balances; null keeps this honest.
    averagePayables: null,
    periodDays: period.days,
  });

  /* ── Expenses ────────────────────────────────────────────────────────── */
  const expenseStructure = buildExpenseStructure(dataset, series, periodTotals, period);
  const expenseBreakdown = buildExpenseBreakdown(
    expensesInRange(dataset, period.start, period.end),
    expensesInRange(dataset, period.previous.start, period.previous.end),
  );

  const expenses: ExpenseIntelligence = {
    breakdown: expenseBreakdown,
    totalExpenses: periodTotals.expenses,
    expenseRatioPct: expenseRatioPct(periodTotals.revenue, periodTotals.expenses),
    previousExpenseRatioPct: expenseRatioPct(previousTotals.revenue, previousTotals.expenses),
    monthlyFixed: expenseStructure.monthlyFixed,
    monthlyUnclassified: expenseStructure.monthlyUnclassified,
    variableRate: expenseStructure.variableRate,
    windowMonths: expenseStructure.windowMonths,
    note:
      expenseStructure.windowMonths > 0
        ? `Fixed and variable rates are averaged over the last ${expenseStructure.windowMonths} completed month${expenseStructure.windowMonths === 1 ? "" : "s"}, so one unusual month cannot set the forecast.`
        : "No completed month of expense history yet — rates are taken from the selected period and scaled to a month.",
  };

  /* ── Forecasts ───────────────────────────────────────────────────────── */
  const completedRevenue = series.completed.map((m) => m.revenue);
  const revenueForecast = buildMetricForecast(completedRevenue);
  const grossProfitForecast = buildMetricForecast(series.completed.map((m) => m.grossProfit));
  const netProfitForecast = buildMetricForecast(series.completed.map((m) => m.netProfit));

  /* ── Working capital ─────────────────────────────────────────────────── */
  const workingCapital = buildWorkingCapitalPosition({
    cashOnHand: cash.totalCashInHand,
    accountsReceivable: receivables.totalOutstanding,
    inventoryAtCost: roundMoney2(currentInventoryAtLotCost),
    loansReceivable: loans.totalOwedToYou,
    loansPayable: loans.totalYouOwe,
    supplierPayables: null,
    monthlyCogs: monthly.cogs,
    monthlyExpenses: monthly.expenses,
    cycleDays: cashCycle.effectiveCycleDays,
  });

  /* ── Compounding projection ──────────────────────────────────────────── */
  const horizonLabels = buildHorizonLabels(now, horizonMonths);
  const demandRevenue = Array.from({ length: horizonMonths }, (_, i) =>
    revenueForecast.project(i + 1, scenario),
  );

  // Capital that can actually be deployed into stock: liquid funds plus the stock
  // already held (it recycles), not loan balances that are not spendable today.
  const deployableCapital = roundMoney2(
    Math.max(0, cash.totalCashInHand) + receivables.totalOutstanding + currentInventoryAtLotCost,
  );

  const compounding = projectCompounding({
    openingCapital: deployableCapital,
    turnoverPerMonth: inventoryEfficiency.turnoverPerMonth,
    cogsRatio: periodTotals.cogsRatio,
    fixedExpenses: expenses.monthlyFixed,
    variableExpenseRate: expenses.variableRate,
    unclassifiedExpenses: expenses.monthlyUnclassified,
    demandRevenueByMonth: demandRevenue,
    labels: horizonLabels,
  });

  const firstProjected = compounding.months[0] ?? null;

  const reinvestmentCycle = buildReinvestmentCycle({
    netProfitThisMonth: firstProjected?.netProfit ?? monthly.netProfit,
    turnoverPerMonth: inventoryEfficiency.turnoverPerMonth,
    cogsRatio: periodTotals.cogsRatio,
    variableExpenseRate: expenses.variableRate,
    demandHeadroom:
      firstProjected && firstProjected.capacityRevenue !== null
        ? Math.max(0, firstProjected.demandRevenue - firstProjected.revenue)
        : null,
  });

  const inventoryGrowth = buildInventoryGrowthForecast({
    currentInventoryAtCost: currentInventoryAtLotCost,
    months: compounding.months.map((m) => ({
      monthOffset: m.monthOffset,
      label: m.label,
      cogs: m.cogs,
      reinvestedProfit: m.reinvestedProfit,
      purchasingCapacity: m.purchasingCapacity,
    })),
  });

  const revenueCapacity = buildRevenueCapacity({
    availableCapital: workingCapital.available,
    cycleDays: cashCycle.effectiveCycleDays,
    cogsRatio: periodTotals.cogsRatio,
    currentMonthlyRevenue: monthly.revenue,
    reinvestmentNextMonth: reinvestmentCycle.amountReinvested,
  });

  /* ── Executive forecast ──────────────────────────────────────────────── */
  const executive = buildExecutiveForecast({
    now,
    series,
    scenario,
    revenueForecast,
    grossProfitForecast,
    netProfitForecast,
    expenses,
    cogsRatio: periodTotals.cogsRatio,
    projected: firstProjected,
    cash,
    receivables: receivables.totalOutstanding,
    collectionPeriodDays: receivables.collectionPeriodDays,
  });

  /* ── Economics, break-even, milestones ───────────────────────────────── */
  const economics: BusinessEconomics = {
    grossMarginFraction:
      periodTotals.grossMarginPct !== null ? periodTotals.grossMarginPct / 100 : null,
    cogsRatio: periodTotals.cogsRatio,
    fixedExpenses: expenses.monthlyFixed,
    variableExpenseRate: expenses.variableRate,
    unclassifiedExpenses: expenses.monthlyUnclassified,
    cycleDays: cashCycle.effectiveCycleDays,
    turnoverPerMonth: inventoryEfficiency.turnoverPerMonth,
    currentMonthlyRevenue: monthly.revenue,
    currentMonthlyNetProfit: monthly.netProfit,
    availableWorkingCapital: workingCapital.available,
    monthlyRevenueGrowth: revenueForecast.scenarioGrowth[scenario],
  };

  const breakEven = buildBreakEven(economics);
  const milestones = buildProfitMilestones(economics);

  /* ── Cash flow ───────────────────────────────────────────────────────── */
  const cashFlow = buildCashFlowForecast({
    openingCash: cash.totalCashInHand,
    accountsReceivable: receivables.totalOutstanding,
    collectionPeriodDays: receivables.collectionPeriodDays,
    monthlyRevenue: executive.revenue.forecast,
    creditSalesShare:
      periodTotals.revenue > 0 ? periodTotals.creditSales / periodTotals.revenue : 0,
    monthlyExpenses: executive.expenses.forecast,
    monthlyCogs:
      periodTotals.cogsRatio !== null
        ? executive.revenue.forecast * periodTotals.cogsRatio
        : monthly.cogs,
    monthlyGrowthPurchases: Math.max(0, reinvestmentCycle.amountReinvested),
  });

  /* ── Suppliers ───────────────────────────────────────────────────────── */
  const suppliers = buildSupplierReport({
    stockLots: dataset.stockLots,
    traders: dataset.traders,
    periodStart: period.start,
    periodEnd: period.end,
    productPerformance: products.performanceByProduct,
  });

  const supplierTerms = simulateSupplierTerms({
    monthlyPurchases: monthly.purchases,
    targetTermDays: SUPPLIER_TERMS_TARGET_DAYS,
    currentTermDays: 0,
  });

  /* ── Month-over-month comparison ─────────────────────────────────────── */
  const monthComparison = buildMonthComparison({
    series,
    now,
    products,
    receivables,
    workingCapital,
    inventoryEfficiency,
  });

  /* ── Insights ────────────────────────────────────────────────────────── */
  const previousPeriodInventory = averageInventoryAcross(
    series.points.filter(
      (p) => p.key >= monthKey(period.previous.start) && p.key <= monthKey(period.previous.end),
    ),
    openingInventoryFor(series, period.previous.start),
    currentInventoryAtLotCost,
  );
  const previousTurnover =
    previousPeriodInventory !== null && previousPeriodInventory > 0 && previousTotals.cogs > 0
      ? (previousTotals.cogs / previousPeriodInventory) * (30 / Math.max(1, previousTotals.days))
      : null;

  const threeMonthCapacityGrowth = capacityGrowthPct(compounding, 3);

  const insightInput: InsightInput = {
    monthlyRevenue: monthly.revenue,
    previousMonthlyRevenue: toMonthlyRate(previousTotals.revenue, Math.max(1, previousTotals.days)),
    revenueChangePct: percentChange(previousTotals.revenue, periodTotals.revenue),
    grossMarginPct: periodTotals.grossMarginPct,
    previousGrossMarginPct: previousTotals.grossMarginPct,
    netProfit: periodTotals.netProfit,
    netMarginPct: periodTotals.netMarginPct,
    expenseRatioPct: expenses.expenseRatioPct,
    previousExpenseRatioPct: expenses.previousExpenseRatioPct,
    expenseCategories: expenseBreakdown.categories.map((c) => ({
      label: c.label,
      amount: c.amount,
      previousAmount: c.previousAmount,
      changePct: c.changePct,
    })),
    inventoryTurnoverPerMonth: inventoryEfficiency.turnoverPerMonth,
    previousInventoryTurnoverPerMonth: previousTurnover,
    inventoryHoldingDays: inventoryEfficiency.holdingDays,
    totalInventoryValue: products.totalInventoryValue,
    capitalTrappedTotal: products.capitalTrappedTotal,
    capitalTrappedSharePct: products.capitalTrappedSharePct,
    deadStockValue: products.capitalTrappedDead,
    workingCapitalAvailable: workingCapital.available,
    workingCapitalRequired: workingCapital.requiredTotal,
    workingCapitalGap: workingCapital.gap,
    revenueCapacity: revenueCapacity.revenueCapacity,
    forecastRevenueNextMonth: executive.revenue.forecast,
    forecastConfidenceLabel: revenueForecast.confidence.label,
    forecastConfidenceLevel: revenueForecast.confidence.level,
    cashCycleDays: cashCycle.effectiveCycleDays,
    receivableDays: cashCycle.receivableDays,
    payableDaysTracked: cashCycle.payableDaysTracked,
    receivablesOutstanding: receivables.totalOutstanding,
    receivablesOverdue: receivables.overdueTotal,
    largestCustomerSharePct: receivables.largestCustomerSharePct,
    supplierConcentrationPct: suppliers.concentrationPct,
    topProductSharePct: products.topProductSharePct,
    topCategory: products.categories[0]
      ? {
          category: products.categories[0].category,
          revenue: products.categories[0].revenue,
          grossProfit: products.categories[0].grossProfit,
        }
      : null,
    topGrossProfitCategory: topByGrossProfit(products),
    fastMovingCount: products.fastMoving.length,
    slowMovingCount: products.slowMoving.length,
    outOfStockExposure: products.stockOutExposure.monthlyRevenueExposure,
    outOfStockExposureSharePct: products.stockOutExposure.exposureSharePct,
    cashFlow30DayClosing: cashFlow.horizons.find((h) => h.id === "30")?.closingCash ?? null,
    cashOnHand: cash.totalCashInHand,
    reinvestmentThreeMonthCapacityGrowthPct: threeMonthCapacityGrowth,
    collectionImprovementCapital: collectionImprovement.capitalReleased,
    collectionImprovementDays: COLLECTION_IMPROVEMENT_DAYS,
    monthsOfHistory: series.completed.filter((m) => m.revenue > 0 || m.expenses > 0).length,
  };

  return {
    now,
    period,
    scenario,
    horizonMonths,
    series,
    periodTotals,
    previousTotals,
    monthly,
    cash,
    executive,
    forecasts: {
      revenue: revenueForecast,
      grossProfit: grossProfitForecast,
      netProfit: netProfitForecast,
    },
    compounding,
    reinvestmentCycle,
    workingCapital,
    revenueCapacity,
    cashCycle,
    inventoryEfficiency,
    inventoryGrowth,
    products,
    expenses,
    breakEven,
    milestones,
    economics,
    cashFlow,
    receivables,
    collectionImprovement,
    suppliers,
    supplierTerms,
    monthComparison,
    insights: buildInsights(insightInput),
    opportunities: buildOpportunities(insightInput),
    risks: buildRisks(insightInput),
    growthConstraint: diagnoseGrowthConstraint(insightInput),
    dataGaps: collectDataGaps({
      cashCycle,
      inventoryEfficiency,
      periodTotals,
      receivables,
      revenueForecast,
    }),
  };
}

function expensesInRange(dataset: BusinessDataset, start: Date, end: Date) {
  return dataset.expenses
    .filter((row) => {
      const date = timestampToDate(row.data.date);
      return !!date && date >= start && date <= end;
    })
    .map((row) => ({ title: row.data.title, amount: row.data.amount }));
}

/** Reconstructed inventory value just before `start`. */
function openingInventoryFor(series: MonthlySeries, start: Date): number | null {
  const key = monthKey(start);
  const index = series.points.findIndex((p) => p.key === key);
  if (index <= 0) return null;
  return series.points[index - 1]!.endInventoryEstimate;
}

function averageInventoryAcross(
  points: readonly MonthlyPoint[],
  opening: number | null,
  fallback: number,
): number | null {
  const values: number[] = [];
  if (opening !== null && Number.isFinite(opening)) values.push(opening);
  for (const point of points) {
    if (point.endInventoryEstimate !== null) values.push(point.endInventoryEstimate);
  }
  if (values.length === 0) {
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  }
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return avg > 0 ? avg : null;
}

function topByGrossProfit(products: ProductIntelligence) {
  const sorted = products.categories.slice().sort((a, b) => b.grossProfit - a.grossProfit);
  const top = sorted[0];
  return top
    ? { category: top.category, revenue: top.revenue, grossProfit: top.grossProfit }
    : null;
}

function capacityGrowthPct(compounding: CompoundingProjection, months: number): number | null {
  const first = compounding.months[0];
  const target = compounding.months[Math.min(months, compounding.months.length) - 1];
  if (!first || !target || first.openingCapital <= 0) return null;
  return ((target.closingCapital - first.openingCapital) / first.openingCapital) * 100;
}

function buildHorizonLabels(now: Date, months: number): string[] {
  const base = monthKey(now);
  return Array.from({ length: months }, (_, i) => formatMonthLabel(shiftMonthKey(base, i + 1)));
}

function buildExecutiveForecast(params: {
  now: Date;
  series: MonthlySeries;
  scenario: ScenarioId;
  revenueForecast: MetricForecast;
  grossProfitForecast: MetricForecast;
  netProfitForecast: MetricForecast;
  expenses: ExpenseIntelligence;
  cogsRatio: number | null;
  projected: CompoundingProjection["months"][number] | null;
  cash: CashInHandSnapshot;
  receivables: number;
  collectionPeriodDays: number | null;
}): ExecutiveForecast {
  const progress = currentMonthProgress(params.now);
  const currentPoint = params.series.current;

  const currentRevenueToDate = currentPoint?.revenue ?? 0;
  const currentRevenueRunRate =
    monthRunRate(currentRevenueToDate, progress.daysElapsed, progress.daysInMonth) ?? 0;
  const currentGrossRunRate =
    monthRunRate(currentPoint?.grossProfit ?? 0, progress.daysElapsed, progress.daysInMonth) ?? 0;
  const currentExpenseRunRate =
    monthRunRate(currentPoint?.expenses ?? 0, progress.daysElapsed, progress.daysInMonth) ?? 0;
  const currentNetRunRate = roundMoney2(currentGrossRunRate - currentExpenseRunRate);

  // The revenue projection is the compounding model's first month when it exists,
  // because that is the one that respects the capital ceiling.
  const forecastRevenue = params.projected?.revenue ?? params.revenueForecast.project(1, params.scenario);
  const forecastCogs =
    params.projected?.cogs ??
    (params.cogsRatio !== null ? forecastRevenue * params.cogsRatio : 0);
  const forecastGross = roundMoney2(forecastRevenue - forecastCogs);

  const fixedExpenseForecast = params.expenses.monthlyFixed;
  const unclassifiedExpenseForecast = params.expenses.monthlyUnclassified;
  const variableExpenseForecast = roundMoney2(params.expenses.variableRate * forecastRevenue);
  const forecastExpenses = roundMoney2(
    fixedExpenseForecast + unclassifiedExpenseForecast + variableExpenseForecast,
  );
  const forecastNet = roundMoney2(forecastGross - forecastExpenses);

  // Cash that can go into stock next month: what is in hand, plus what customers
  // are expected to pay inside the month, less the month's running costs.
  const collectionDays =
    params.collectionPeriodDays !== null && params.collectionPeriodDays > 0
      ? params.collectionPeriodDays
      : 30;
  const expectedCollections = roundMoney2(params.receivables * Math.min(1, 30 / collectionDays));
  const purchasingCapacity = roundMoney2(
    Math.max(0, params.cash.totalCashInHand + expectedCollections - forecastExpenses),
  );
  const purchasingRequirement = roundMoney2(
    forecastCogs + Math.max(0, params.projected?.reinvestedProfit ?? forecastNet),
  );
  const purchasingShortfall = roundMoney2(Math.max(0, purchasingRequirement - purchasingCapacity));

  const metric = (label: string, forecast: number, current: number): ExecutiveMetric => ({
    label,
    forecast: roundMoney2(forecast),
    current: roundMoney2(current),
    change: roundMoney2(forecast - current),
    changePct: percentChange(current, forecast),
  });

  const revenue = metric("Expected revenue", forecastRevenue, currentRevenueRunRate);
  const grossProfit = metric("Expected gross profit", forecastGross, currentGrossRunRate);
  const netProfit = metric("Expected net profit", forecastNet, currentNetRunRate);
  const expenses = metric("Expected expenses", forecastExpenses, currentExpenseRunRate);

  const growthText =
    revenue.changePct === null
      ? "no comparable current-month figure to measure growth against"
      : `${revenue.changePct >= 0 ? "growth" : "a decline"} of ${Math.abs(revenue.changePct).toFixed(1)}%`;

  const sentence = `At the current trajectory, TradeBridge is projected to generate ${money(revenue.forecast)} of revenue next month — ${growthText} — with about ${money(grossProfit.forecast)} gross profit, ${money(netProfit.forecast)} net profit, and roughly ${money(purchasingCapacity)} available to spend on stock.`;

  return {
    revenue,
    grossProfit,
    netProfit,
    expenses,
    purchasingCapacity,
    purchasingRequirement,
    purchasingShortfall,
    fixedExpenseForecast,
    variableExpenseForecast,
    unclassifiedExpenseForecast,
    currentMonthToDateRevenue: roundMoney2(currentRevenueToDate),
    currentMonthDaysElapsed: progress.daysElapsed,
    currentMonthDaysTotal: progress.daysInMonth,
    sentence,
  };
}

function buildMonthComparison(params: {
  series: MonthlySeries;
  now: Date;
  products: ProductIntelligence;
  receivables: ReceivablesReport;
  workingCapital: WorkingCapitalPosition;
  inventoryEfficiency: InventoryEfficiency;
}): BusinessIntelligenceReport["monthComparison"] {
  const currentKey = monthKey(params.now);
  const previousKey = shiftMonthKey(currentKey, -1);
  const current = params.series.points.find((p) => p.key === currentKey) ?? null;
  const previous = params.series.points.find((p) => p.key === previousKey) ?? null;

  // The current month is part-way through, so compare like for like by scaling the
  // previous month down to the same number of elapsed days.
  const elapsed = current?.daysElapsed ?? daysInMonthKey(currentKey);
  const previousDays = daysInMonthKey(previousKey);
  const scale = previous && previousDays > 0 ? Math.min(1, elapsed / previousDays) : 1;

  const row = (
    label: string,
    currentValue: number | null,
    previousValue: number | null,
    format: MonthComparisonRow["format"],
    scalePrevious = false,
  ): MonthComparisonRow => {
    const prev =
      previousValue === null ? null : scalePrevious ? roundMoney2(previousValue * scale) : previousValue;
    const change = currentValue !== null && prev !== null ? roundMoney2(currentValue - prev) : null;
    return {
      label,
      current: currentValue,
      previous: prev,
      change,
      changePct: currentValue !== null && prev !== null ? percentChange(prev, currentValue) : null,
      format,
    };
  };

  const rows: MonthComparisonRow[] = [
    row("Revenue", current?.revenue ?? null, previous?.revenue ?? null, "money", true),
    row("Gross profit", current?.grossProfit ?? null, previous?.grossProfit ?? null, "money", true),
    row("Net profit", current?.netProfit ?? null, previous?.netProfit ?? null, "money", true),
    row("Stock purchased", current?.purchases ?? null, previous?.purchases ?? null, "money", true),
    row("Expenses", current?.expenses ?? null, previous?.expenses ?? null, "money", true),
    row("Units sold", current?.unitsSold ?? null, previous?.unitsSold ?? null, "number", true),
    row(
      "Average order value",
      current?.avgOrderValue ?? null,
      previous?.avgOrderValue ?? null,
      "money",
    ),
    row("Gross margin %", current?.grossMarginPct ?? null, previous?.grossMarginPct ?? null, "percent"),
    row(
      "Inventory on hand (est.)",
      current?.endInventoryEstimate ?? null,
      previous?.endInventoryEstimate ?? null,
      "money",
    ),
  ];

  return {
    currentLabel: `${formatMonthLabel(currentKey)} (${elapsed} of ${daysInMonthKey(currentKey)} days)`,
    previousLabel: `${formatMonthLabel(previousKey)} (first ${Math.round(previousDays * scale)} days)`,
    rows,
  };
}

function collectDataGaps(params: {
  cashCycle: CashCycle;
  inventoryEfficiency: InventoryEfficiency;
  periodTotals: RangeTotals;
  receivables: ReceivablesReport;
  revenueForecast: MetricForecast;
}): { metric: string; reason: string }[] {
  const gaps: { metric: string; reason: string }[] = [];

  if (!params.cashCycle.payableDaysTracked) {
    gaps.push({
      metric: "Supplier payment days & payables",
      reason:
        "Stock receipts record what was bought and from whom, but no balance, invoice or due date. The cash conversion cycle therefore assumes suppliers are paid immediately.",
    });
  }
  if (params.cashCycle.inventoryDays === null) {
    gaps.push({
      metric: "Inventory holding days",
      reason: "Needs recorded cost of goods sold in the period and a stock value to measure against.",
    });
  }
  if (params.cashCycle.receivableDays === null) {
    gaps.push({
      metric: "Customer collection days",
      reason: "Needs invoice-billed (credit) sales in the period. Counter sales taken as cash do not create receivables.",
    });
  }
  if (params.inventoryEfficiency.turnoverPerMonth === null) {
    gaps.push({
      metric: "Inventory turnover",
      reason: "Needs both cost of goods sold in the period and a non-zero stock value.",
    });
  }
  if (params.periodTotals.grossMarginPct === null) {
    gaps.push({
      metric: "Gross margin",
      reason: "No revenue recorded in the selected period.",
    });
  }
  if (params.revenueForecast.confidence.level === "insufficient") {
    gaps.push({
      metric: "Revenue, profit and capacity forecasts",
      reason: params.revenueForecast.confidence.reasons.join(" "),
    });
  }
  gaps.push({
    metric: "Lost sales from stock-outs",
    reason:
      "TradeBridge does not capture unfulfilled orders, cancelled lines or requests for items that were not in stock, so no historical lost-sale figure exists. The out-of-stock section projects forward exposure from products that were selling before they ran out.",
  });

  return gaps;
}

function money(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : ""}Rs. ${Math.abs(rounded).toLocaleString()}`;
}
