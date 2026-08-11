/**
 * Working capital, the cash conversion cycle, and the revenue that capital can carry.
 *
 * What TradeBridge does and does not record matters here:
 *  • Cash on hand, receivables, inventory at FIFO lot cost and loan balances are real, recorded data.
 *  • Supplier payables are NOT recorded — stock receipts (`stock_lots`) carry no
 *    balance or due date, so purchases behave as immediate cash outflows. Payable
 *    days are therefore reported as "not tracked", never as zero-that-looks-real.
 */
import {
  cashConversionCycle,
  cogsCapacityFromWorkingCapital,
  inventoryDays as inventoryDaysFormula,
  payableDays as payableDaysFormula,
  receivableDays as receivableDaysFormula,
  revenueFromCogs,
  roundMoney2,
  workingCapitalRequired,
} from "@/lib/bi/finance";

export type WorkingCapitalComponents = {
  cashOnHand: number;
  accountsReceivable: number;
  inventoryAtCost: number;
  loansReceivable: number;
  loansPayable: number;
  /** Always null — TradeBridge records no supplier balances. Kept explicit so the UI can say so. */
  supplierPayables: number | null;
};

export type WorkingCapitalPosition = WorkingCapitalComponents & {
  available: number;
  /** Cash + receivables only — the part that can actually fund a purchase soon. */
  liquidCapital: number;
  requiredForCurrentSales: number | null;
  /** Working capital cushion for operating costs over the same cycle. */
  requiredForOperatingCosts: number | null;
  requiredTotal: number | null;
  /** required − available. Positive = funding gap, negative = surplus. */
  gap: number | null;
  hasSurplus: boolean | null;
};

export type CashCycle = {
  inventoryDays: number | null;
  receivableDays: number | null;
  /** Null when supplier credit is not tracked (which is currently always). */
  payableDays: number | null;
  payableDaysTracked: boolean;
  /** Full cycle. Null whenever any leg is unknown. */
  cycleDays: number | null;
  /** Cycle computed with supplier credit assumed to be zero — always available. */
  cycleDaysExcludingPayables: number | null;
  /** The value actually used for capital sizing (falls back to the ex-payables cycle). */
  effectiveCycleDays: number | null;
  explanation: string;
};

export type CashCycleInput = {
  cogs: number;
  averageInventory: number | null;
  creditSales: number;
  averageReceivables: number;
  purchases: number;
  averagePayables: number | null;
  periodDays: number;
};

export function buildCashCycle(input: CashCycleInput): CashCycle {
  const invDays =
    input.averageInventory === null
      ? null
      : inventoryDaysFormula(input.cogs, input.averageInventory, input.periodDays);
  const recDays = receivableDaysFormula(
    input.creditSales,
    input.averageReceivables,
    input.periodDays,
  );
  const payTracked = input.averagePayables !== null;
  const payDays = payTracked
    ? payableDaysFormula(input.purchases, input.averagePayables ?? 0, input.periodDays)
    : null;

  const cycleDays = cashConversionCycle(invDays, recDays, payDays);
  const cycleExPayables = cashConversionCycle(invDays, recDays, 0);
  const effective = cycleDays ?? cycleExPayables;

  let explanation: string;
  if (effective === null) {
    explanation =
      "Not enough recorded sales, stock cost or receivable history to work out how long cash stays tied up.";
  } else if (!payTracked) {
    explanation = `Money spent on stock takes roughly ${effective.toFixed(0)} days to come back as usable cash. Supplier credit is not recorded in TradeBridge, so this assumes suppliers are paid immediately — if you do get credit days, the real cycle is shorter.`;
  } else {
    explanation = `Money spent on stock takes roughly ${effective.toFixed(0)} days to come back as usable cash.`;
  }

  return {
    inventoryDays: invDays,
    receivableDays: recDays,
    payableDays: payDays,
    payableDaysTracked: payTracked,
    cycleDays,
    cycleDaysExcludingPayables: cycleExPayables,
    effectiveCycleDays: effective,
    explanation,
  };
}

export type WorkingCapitalInput = WorkingCapitalComponents & {
  /** Monthly cost of goods sold at the current run rate. */
  monthlyCogs: number;
  /** Monthly operating expenses at the current run rate. */
  monthlyExpenses: number;
  cycleDays: number | null;
};

export function buildWorkingCapitalPosition(input: WorkingCapitalInput): WorkingCapitalPosition {
  const available = roundMoney2(
    input.cashOnHand +
      input.accountsReceivable +
      input.inventoryAtCost +
      input.loansReceivable -
      input.loansPayable -
      (input.supplierPayables ?? 0),
  );
  const liquidCapital = roundMoney2(input.cashOnHand + input.accountsReceivable);

  const requiredForCurrentSales = workingCapitalRequired(input.monthlyCogs, input.cycleDays);
  const requiredForOperatingCosts = workingCapitalRequired(input.monthlyExpenses, input.cycleDays);
  const requiredTotal =
    requiredForCurrentSales === null || requiredForOperatingCosts === null
      ? null
      : roundMoney2(requiredForCurrentSales + requiredForOperatingCosts);
  const gap = requiredTotal === null ? null : roundMoney2(requiredTotal - available);

  return {
    ...input,
    available,
    liquidCapital,
    requiredForCurrentSales,
    requiredForOperatingCosts,
    requiredTotal,
    gap,
    hasSurplus: gap === null ? null : gap <= 0,
  };
}

export type RevenueCapacity = {
  /** Monthly COGS the available capital can sustain across one cash cycle. */
  cogsCapacity: number | null;
  /** The revenue that COGS capacity implies at the current cost ratio. */
  revenueCapacity: number | null;
  /** Same, after next month's reinvested profit is added to the capital base. */
  revenueCapacityWithReinvestment: number | null;
  /** Current monthly revenue for comparison. */
  currentMonthlyRevenue: number;
  /** revenueCapacity − currentMonthlyRevenue. Positive = headroom. */
  headroom: number | null;
  note: string;
};

export function buildRevenueCapacity(params: {
  availableCapital: number;
  cycleDays: number | null;
  cogsRatio: number | null;
  currentMonthlyRevenue: number;
  reinvestmentNextMonth: number;
}): RevenueCapacity {
  const cogsCapacity = cogsCapacityFromWorkingCapital(params.availableCapital, params.cycleDays);
  const revenueCapacity = cogsCapacity === null ? null : revenueFromCogs(cogsCapacity, params.cogsRatio);

  const withReinvestment = cogsCapacityFromWorkingCapital(
    params.availableCapital + Math.max(0, params.reinvestmentNextMonth),
    params.cycleDays,
  );
  const revenueCapacityWithReinvestment =
    withReinvestment === null ? null : revenueFromCogs(withReinvestment, params.cogsRatio);

  const headroom =
    revenueCapacity === null ? null : roundMoney2(revenueCapacity - params.currentMonthlyRevenue);

  const note =
    revenueCapacity === null
      ? "Revenue capacity needs a measurable cash cycle and a gross margin — both come from recorded sales and stock costs."
      : "How much monthly revenue today's working capital can carry, given how fast that capital currently rotates.";

  return {
    cogsCapacity,
    revenueCapacity,
    revenueCapacityWithReinvestment,
    currentMonthlyRevenue: params.currentMonthlyRevenue,
    headroom,
    note,
  };
}
