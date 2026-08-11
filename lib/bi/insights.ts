/**
 * Deterministic business insights, risks, opportunities and the growth-constraint
 * diagnosis.
 *
 * Every statement here is a rule over numbers already computed elsewhere — no
 * language model, no external service, no randomness. Two runs on the same data
 * always produce the same text. Rules that lack the data they need simply do not
 * fire; nothing is stated that the data cannot support.
 */

export type InsightTone = "positive" | "neutral" | "warning" | "danger";

export type Insight = {
  id: string;
  tone: InsightTone;
  text: string;
  /** Rough importance, used only for ordering. */
  weight: number;
};

export type RiskOrOpportunity = {
  id: string;
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
};

export type GrowthConstraintId =
  | "working_capital"
  | "inventory_availability"
  | "sales_demand"
  | "slow_inventory"
  | "customer_receivables"
  | "supplier_terms"
  | "low_gross_margin"
  | "high_expenses"
  | "cash_flow"
  | "insufficient_data";

export type GrowthConstraint = {
  id: GrowthConstraintId;
  label: string;
  explanation: string;
  /** Supporting figures shown under the diagnosis. */
  evidence: string[];
  /** Runners-up, so the owner can see what else is close. */
  alternates: { id: GrowthConstraintId; label: string; reason: string }[];
};

/** Everything the rules read. Deliberately a flat bag of already-computed numbers. */
export type InsightInput = {
  monthlyRevenue: number;
  previousMonthlyRevenue: number | null;
  revenueChangePct: number | null;
  grossMarginPct: number | null;
  previousGrossMarginPct: number | null;
  netProfit: number;
  netMarginPct: number | null;
  expenseRatioPct: number | null;
  previousExpenseRatioPct: number | null;
  expenseCategories: readonly {
    label: string;
    amount: number;
    previousAmount: number | null;
    changePct: number | null;
  }[];
  inventoryTurnoverPerMonth: number | null;
  previousInventoryTurnoverPerMonth: number | null;
  inventoryHoldingDays: number | null;
  totalInventoryValue: number;
  capitalTrappedTotal: number;
  capitalTrappedSharePct: number | null;
  deadStockValue: number;
  workingCapitalAvailable: number;
  workingCapitalRequired: number | null;
  workingCapitalGap: number | null;
  revenueCapacity: number | null;
  forecastRevenueNextMonth: number;
  forecastConfidenceLabel: string;
  forecastConfidenceLevel: "high" | "medium" | "low" | "insufficient";
  cashCycleDays: number | null;
  receivableDays: number | null;
  payableDaysTracked: boolean;
  receivablesOutstanding: number;
  receivablesOverdue: number;
  largestCustomerSharePct: number | null;
  supplierConcentrationPct: number | null;
  topProductSharePct: number | null;
  topCategory: { category: string; revenue: number; grossProfit: number } | null;
  topGrossProfitCategory: { category: string; revenue: number; grossProfit: number } | null;
  fastMovingCount: number;
  slowMovingCount: number;
  outOfStockExposure: number;
  outOfStockExposureSharePct: number | null;
  cashFlow30DayClosing: number | null;
  cashOnHand: number;
  reinvestmentThreeMonthCapacityGrowthPct: number | null;
  collectionImprovementCapital: number | null;
  collectionImprovementDays: number;
  monthsOfHistory: number;
};

function money(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : ""}Rs. ${Math.abs(rounded).toLocaleString()}`;
}

function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/**
 * Build 3–7 insights that add something the cards do not already say.
 * Rules fire only when their inputs exist; the strongest are kept.
 */
export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const add = (id: string, tone: InsightTone, weight: number, text: string) =>
    out.push({ id, tone, weight, text });

  // Growth vs margin: is growth costing margin?
  if (
    input.revenueChangePct !== null &&
    input.grossMarginPct !== null &&
    input.previousGrossMarginPct !== null
  ) {
    const marginShift = input.grossMarginPct - input.previousGrossMarginPct;
    if (input.revenueChangePct >= 5 && Math.abs(marginShift) < 0.5) {
      add(
        "growth_without_margin_loss",
        "positive",
        90,
        `Revenue moved ${pct(input.revenueChangePct)} while gross margin held steady at ${pct(input.grossMarginPct)} — growth without margin compression.`,
      );
    } else if (input.revenueChangePct >= 5 && marginShift <= -0.5) {
      add(
        "growth_with_margin_loss",
        "warning",
        95,
        `Revenue rose ${pct(input.revenueChangePct)} but gross margin fell from ${pct(input.previousGrossMarginPct)} to ${pct(input.grossMarginPct)} — ${Math.abs(marginShift).toFixed(1)} percentage points of the growth was bought with price. Check discounting and purchase costs.`,
      );
    } else if (input.revenueChangePct <= -5 && marginShift >= 0.5) {
      add(
        "shrinking_but_richer",
        "neutral",
        70,
        `Revenue fell ${pct(Math.abs(input.revenueChangePct))} while gross margin improved to ${pct(input.grossMarginPct)} — you are selling less but at better prices.`,
      );
    }
  }

  // Capital trapped in stock that is not moving.
  if (input.capitalTrappedTotal > 0 && input.capitalTrappedSharePct !== null) {
    const gapNote =
      input.workingCapitalGap !== null && input.workingCapitalGap > 0
        ? ` That is ${input.capitalTrappedTotal >= input.workingCapitalGap ? "more than" : "a large part of"} the ${money(input.workingCapitalGap)} working-capital shortfall — freeing it would ease the squeeze without new money.`
        : " Moving it would put that cash back into stock that sells.";
    add(
      "capital_trapped",
      input.capitalTrappedSharePct >= 25 ? "warning" : "neutral",
      input.capitalTrappedSharePct >= 25 ? 92 : 65,
      `About ${money(input.capitalTrappedTotal)} — ${pct(input.capitalTrappedSharePct)} of stock value — is tied up in slow-moving or dead inventory.${gapNote}`,
    );
  }

  // An expense line outgrowing revenue.
  const revenueGrowth = input.revenueChangePct ?? 0;
  const runawayExpense = input.expenseCategories
    .filter((c) => c.changePct !== null && c.amount > 0 && c.changePct > Math.max(10, revenueGrowth + 10))
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))[0];
  if (runawayExpense && runawayExpense.changePct !== null) {
    add(
      "expense_outpacing_revenue",
      "warning",
      88,
      `${runawayExpense.label} rose ${pct(runawayExpense.changePct)} to ${money(runawayExpense.amount)} while revenue moved ${pct(revenueGrowth)}. That line is growing faster than the sales paying for it.`,
    );
  }

  // Purchasing capacity vs the revenue the forecast expects.
  if (input.revenueCapacity !== null && input.forecastRevenueNextMonth > 0) {
    const shortfall = input.forecastRevenueNextMonth - input.revenueCapacity;
    if (shortfall > input.forecastRevenueNextMonth * 0.05) {
      add(
        "capacity_below_forecast",
        "danger",
        98,
        `Working capital supports about ${money(input.revenueCapacity)} of monthly revenue, but the trend points to ${money(input.forecastRevenueNextMonth)} next month. Roughly ${money(shortfall)} of that demand cannot be stocked for without more capital or faster stock rotation.`,
      );
    } else if (input.revenueCapacity > input.forecastRevenueNextMonth * 1.3) {
      add(
        "capacity_above_demand",
        "neutral",
        72,
        `Working capital could carry about ${money(input.revenueCapacity)} of monthly revenue against a forecast of ${money(input.forecastRevenueNextMonth)}. Capital is not what is holding sales back — demand is.`,
      );
    }
  }

  // Collection speed as a source of free working capital.
  if (
    input.collectionImprovementCapital !== null &&
    input.collectionImprovementCapital > 0 &&
    input.receivableDays !== null &&
    input.receivableDays > 5
  ) {
    add(
      "collection_improvement",
      "neutral",
      80,
      `Collecting ${input.collectionImprovementDays} days sooner — from ${input.receivableDays.toFixed(1)} down to ${(input.receivableDays - input.collectionImprovementDays).toFixed(1)} days — could release roughly ${money(input.collectionImprovementCapital)} of working capital without borrowing anything.`,
    );
  }

  // The compounding effect of full reinvestment.
  if (
    input.reinvestmentThreeMonthCapacityGrowthPct !== null &&
    Math.abs(input.reinvestmentThreeMonthCapacityGrowthPct) >= 1
  ) {
    const growing = input.reinvestmentThreeMonthCapacityGrowthPct > 0;
    add(
      "reinvestment_compounding",
      growing ? "positive" : "warning",
      78,
      growing
        ? `At the current reinvestment rate, inventory purchasing capacity is projected to grow about ${pct(input.reinvestmentThreeMonthCapacityGrowthPct)} over the next three months, purely from profit going back in.`
        : `At the current trading result, the capital base is projected to shrink about ${pct(Math.abs(input.reinvestmentThreeMonthCapacityGrowthPct))} over three months — losses are eating the stock base.`,
    );
  }

  // Revenue leader vs profit leader.
  if (
    input.topCategory &&
    input.topGrossProfitCategory &&
    input.topCategory.category !== input.topGrossProfitCategory.category
  ) {
    add(
      "profit_vs_revenue_category",
      "neutral",
      74,
      `${input.topGrossProfitCategory.category} produced the most gross profit (${money(input.topGrossProfitCategory.grossProfit)}) even though ${input.topCategory.category} had the higher revenue (${money(input.topCategory.revenue)}). Revenue rank and profit rank are not the same list.`,
    );
  }

  // Turnover trend.
  if (
    input.inventoryTurnoverPerMonth !== null &&
    input.previousInventoryTurnoverPerMonth !== null &&
    input.previousInventoryTurnoverPerMonth > 0
  ) {
    const change =
      ((input.inventoryTurnoverPerMonth - input.previousInventoryTurnoverPerMonth) /
        input.previousInventoryTurnoverPerMonth) *
      100;
    if (Math.abs(change) >= 10) {
      add(
        "turnover_trend",
        change > 0 ? "positive" : "warning",
        76,
        change > 0
          ? `Stock is rotating faster: ${input.inventoryTurnoverPerMonth.toFixed(2)}× a month against ${input.previousInventoryTurnoverPerMonth.toFixed(2)}× before. The same capital is earning its margin more often.`
          : `Stock is rotating slower: ${input.inventoryTurnoverPerMonth.toFixed(2)}× a month against ${input.previousInventoryTurnoverPerMonth.toFixed(2)}× before. Capital is spending longer on the shelf.`,
      );
    }
  }

  // Profitable but short of cash.
  if (input.netProfit > 0 && input.cashFlow30DayClosing !== null && input.cashFlow30DayClosing < 0) {
    add(
      "profitable_but_cash_short",
      "danger",
      99,
      `The business is profitable (${money(input.netProfit)} net this period) but cash is projected at ${money(input.cashFlow30DayClosing)} in 30 days. Profit sitting in stock and customer balances does not pay suppliers.`,
    );
  }

  // Concentration.
  if (input.largestCustomerSharePct !== null && input.largestCustomerSharePct >= 40) {
    add(
      "customer_concentration",
      "warning",
      82,
      `One customer holds ${pct(input.largestCustomerSharePct)} of everything owed to you (${money(input.receivablesOutstanding)} outstanding in total). One late payer would be felt across the whole business.`,
    );
  }
  if (input.topProductSharePct !== null && input.topProductSharePct >= 35) {
    add(
      "product_concentration",
      "warning",
      68,
      `A single product accounts for ${pct(input.topProductSharePct)} of revenue this period. Supply or price trouble on that one line would hit hard.`,
    );
  }
  if (input.supplierConcentrationPct !== null && input.supplierConcentrationPct >= 60) {
    add(
      "supplier_concentration",
      "warning",
      66,
      `${pct(input.supplierConcentrationPct)} of stock purchases came from one supplier. Worth having a second source priced before you need one.`,
    );
  }

  // Out-of-stock exposure.
  if (
    input.outOfStockExposureSharePct !== null &&
    input.outOfStockExposureSharePct >= 3 &&
    input.outOfStockExposure > 0
  ) {
    add(
      "stock_out_exposure",
      "warning",
      86,
      `Products worth about ${money(input.outOfStockExposure)} of monthly sales — ${pct(input.outOfStockExposureSharePct)} of revenue — are currently out of stock while they were still selling.`,
    );
  }

  // Expense ratio against margin: the loss-making structural check.
  if (input.expenseRatioPct !== null && input.grossMarginPct !== null) {
    if (input.expenseRatioPct >= input.grossMarginPct) {
      add(
        "expenses_exceed_margin",
        "danger",
        97,
        `Running costs are ${pct(input.expenseRatioPct)} of revenue against a gross margin of ${pct(input.grossMarginPct)}. Every sale at these numbers loses money — the margin or the cost base has to change.`,
      );
    } else if (
      input.previousExpenseRatioPct !== null &&
      input.expenseRatioPct - input.previousExpenseRatioPct >= 1.5
    ) {
      add(
        "expense_ratio_climbing",
        "warning",
        84,
        `Running costs have climbed from ${pct(input.previousExpenseRatioPct)} to ${pct(input.expenseRatioPct)} of revenue. Against a ${pct(input.grossMarginPct)} margin, that is ${(input.expenseRatioPct - input.previousExpenseRatioPct).toFixed(1)} points off the bottom line.`,
      );
    }
  }

  // Forecast reliability, when it is the honest headline.
  if (input.forecastConfidenceLevel === "low" || input.forecastConfidenceLevel === "insufficient") {
    add(
      "low_confidence",
      "neutral",
      60,
      `Projections on this page are marked "${input.forecastConfidenceLabel}" — ${input.monthsOfHistory} completed month${input.monthsOfHistory === 1 ? "" : "s"} of history. Treat them as a direction, not a number to plan against.`,
    );
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, 7);
}

export function buildOpportunities(input: InsightInput): RiskOrOpportunity[] {
  const out: RiskOrOpportunity[] = [];

  if (input.fastMovingCount > 0) {
    out.push({
      id: "restock_fast_movers",
      title: `${input.fastMovingCount} fast-moving product${input.fastMovingCount === 1 ? "" : "s"} worth keeping stocked`,
      detail:
        "These lines are close to running out at their current selling pace. They are the safest place to put the next purchase — the money comes back quickest.",
      severity: "medium",
    });
  }

  if (input.capitalTrappedTotal > 0) {
    out.push({
      id: "release_trapped_capital",
      title: `${money(input.capitalTrappedTotal)} recoverable from slow stock`,
      detail:
        "Clearing slow-moving and dead lines — even at a discount — converts shelf capital back into cash you can put behind products that turn.",
      severity: input.capitalTrappedSharePct !== null && input.capitalTrappedSharePct >= 25 ? "high" : "medium",
    });
  }

  if (!input.payableDaysTracked) {
    out.push({
      id: "supplier_credit",
      title: "Supplier credit is untapped working capital",
      detail:
        "Purchases currently behave as immediate cash outflows. Every day of credit you negotiate leaves one day of buying in your own account — and costs nothing.",
      severity: "medium",
    });
  }

  if (
    input.collectionImprovementCapital !== null &&
    input.collectionImprovementCapital > 0 &&
    input.receivableDays !== null &&
    input.receivableDays > 7
  ) {
    out.push({
      id: "faster_collections",
      title: `${money(input.collectionImprovementCapital)} released by collecting ${input.collectionImprovementDays} days sooner`,
      detail: `Customers currently take about ${input.receivableDays.toFixed(1)} days to pay. Tightening that is the cheapest working capital available to you.`,
      severity: "medium",
    });
  }

  if (input.revenueChangePct !== null && input.revenueChangePct >= 5) {
    out.push({
      id: "revenue_momentum",
      title: `Revenue is growing ${pct(input.revenueChangePct)}`,
      detail:
        "The trend is in your favour. Make sure stock and capital keep pace so the demand is not turned away at the counter.",
      severity: "low",
    });
  }

  if (
    input.reinvestmentThreeMonthCapacityGrowthPct !== null &&
    input.reinvestmentThreeMonthCapacityGrowthPct > 0
  ) {
    out.push({
      id: "compounding",
      title: `Reinvestment compounds capacity ${pct(input.reinvestmentThreeMonthCapacityGrowthPct)} over three months`,
      detail:
        "Every rupee of profit going back in buys stock that rotates and earns again. Holding the reinvestment rate is doing real work.",
      severity: "low",
    });
  }

  if (
    input.topGrossProfitCategory &&
    input.topGrossProfitCategory.grossProfit > 0
  ) {
    out.push({
      id: "high_margin_category",
      title: `${input.topGrossProfitCategory.category} is your biggest profit earner`,
      detail: `It produced ${money(input.topGrossProfitCategory.grossProfit)} of gross profit this period. Deeper range or better stock cover here compounds faster than the same effort elsewhere.`,
      severity: "low",
    });
  }

  return out;
}

export function buildRisks(input: InsightInput): RiskOrOpportunity[] {
  const out: RiskOrOpportunity[] = [];

  if (input.workingCapitalGap !== null && input.workingCapitalGap > 0) {
    out.push({
      id: "working_capital_gap",
      title: `Working-capital shortfall of ${money(input.workingCapitalGap)}`,
      detail: `Sustaining current trading over a ${input.cashCycleDays?.toFixed(0) ?? "—"}-day cash cycle needs about ${money(input.workingCapitalRequired ?? 0)}, against ${money(input.workingCapitalAvailable)} available.`,
      severity: "high",
    });
  }

  if (input.cashFlow30DayClosing !== null && input.cashFlow30DayClosing < 0) {
    out.push({
      id: "negative_cash_forecast",
      title: "Cash is projected to go negative within 30 days",
      detail: `Projected closing cash of ${money(input.cashFlow30DayClosing)} against ${money(input.cashOnHand)} today. Buying pace, collections or capital needs to change.`,
      severity: "high",
    });
  }

  if (
    input.grossMarginPct !== null &&
    input.previousGrossMarginPct !== null &&
    input.grossMarginPct - input.previousGrossMarginPct <= -1
  ) {
    out.push({
      id: "falling_margin",
      title: `Gross margin down ${Math.abs(input.grossMarginPct - input.previousGrossMarginPct).toFixed(1)} percentage points`,
      detail: `Now ${pct(input.grossMarginPct)} against ${pct(input.previousGrossMarginPct)} in the comparison period. Either purchase costs rose or selling prices slipped.`,
      severity: "high",
    });
  }

  if (
    input.expenseRatioPct !== null &&
    input.previousExpenseRatioPct !== null &&
    input.expenseRatioPct - input.previousExpenseRatioPct >= 1.5
  ) {
    out.push({
      id: "rising_expense_ratio",
      title: `Running costs up to ${pct(input.expenseRatioPct)} of revenue`,
      detail: `Was ${pct(input.previousExpenseRatioPct)}. Costs are climbing faster than the sales carrying them.`,
      severity: "medium",
    });
  }

  if (input.capitalTrappedSharePct !== null && input.capitalTrappedSharePct >= 25) {
    out.push({
      id: "slow_inventory",
      title: `${pct(input.capitalTrappedSharePct)} of stock value is slow-moving or dead`,
      detail: `${money(input.capitalTrappedTotal)} sitting in lines that are not turning, including ${money(input.deadStockValue)} with no recent sale at all.`,
      severity: "high",
    });
  }

  if (input.receivablesOverdue > 0 && input.receivablesOutstanding > 0) {
    const share = (input.receivablesOverdue / input.receivablesOutstanding) * 100;
    if (share >= 30) {
      out.push({
        id: "overdue_receivables",
        title: `${money(input.receivablesOverdue)} of customer balances are past terms`,
        detail: `${pct(share)} of the ${money(input.receivablesOutstanding)} owed to you is beyond the assumed payment window. That is working capital sitting with customers.`,
        severity: share >= 50 ? "high" : "medium",
      });
    }
  }

  if (input.largestCustomerSharePct !== null && input.largestCustomerSharePct >= 40) {
    out.push({
      id: "customer_concentration_risk",
      title: `One customer holds ${pct(input.largestCustomerSharePct)} of receivables`,
      detail: "Credit exposure is concentrated. A single non-payer would take a large bite out of working capital.",
      severity: "medium",
    });
  }

  if (input.supplierConcentrationPct !== null && input.supplierConcentrationPct >= 60) {
    out.push({
      id: "supplier_concentration_risk",
      title: `${pct(input.supplierConcentrationPct)} of purchases from one supplier`,
      detail: "A price rise or supply gap from that supplier passes straight through to your margin and your shelves.",
      severity: "medium",
    });
  }

  if (input.topProductSharePct !== null && input.topProductSharePct >= 35) {
    out.push({
      id: "product_concentration_risk",
      title: `${pct(input.topProductSharePct)} of revenue from one product`,
      detail: "Revenue depends heavily on a single line. Worth building depth around it.",
      severity: "low",
    });
  }

  if (input.netProfit < 0) {
    out.push({
      id: "negative_profit",
      title: `Net result is ${money(input.netProfit)} for this period`,
      detail:
        "Costs exceeded gross profit. With 100% reinvestment, a loss shrinks the capital base rather than growing it.",
      severity: "high",
    });
  }

  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

const CONSTRAINT_LABELS: Record<GrowthConstraintId, string> = {
  working_capital: "Working capital",
  inventory_availability: "Inventory availability",
  sales_demand: "Sales demand",
  slow_inventory: "Slow inventory",
  customer_receivables: "Customer receivables",
  supplier_terms: "Supplier terms",
  low_gross_margin: "Low gross margin",
  high_expenses: "High expenses",
  cash_flow: "Cash flow",
  insufficient_data: "Insufficient data",
};

/**
 * Classify the single biggest thing holding growth back, by scoring each
 * candidate against recorded evidence and taking the strongest. Candidates with
 * no supporting data never score, so a thin dataset lands on "insufficient data"
 * rather than on a guess.
 */
export function diagnoseGrowthConstraint(input: InsightInput): GrowthConstraint {
  type Candidate = { id: GrowthConstraintId; score: number; reason: string; evidence: string[] };
  const candidates: Candidate[] = [];

  if (input.monthsOfHistory < 2 && input.monthlyRevenue <= 0) {
    return {
      id: "insufficient_data",
      label: CONSTRAINT_LABELS.insufficient_data,
      explanation:
        "There is not yet enough recorded trading history to say what is limiting growth. Post invoices, record expenses and receive stock for a couple of full months and this diagnosis becomes meaningful.",
      evidence: [`${input.monthsOfHistory} completed month(s) of history`, `${money(input.monthlyRevenue)} monthly revenue recorded`],
      alternates: [],
    };
  }

  // Cash flow — the most urgent constraint when it bites.
  if (input.cashFlow30DayClosing !== null && input.cashFlow30DayClosing < 0) {
    candidates.push({
      id: "cash_flow",
      score: 100,
      reason: `Cash is projected at ${money(input.cashFlow30DayClosing)} within 30 days.`,
      evidence: [
        `Cash on hand today: ${money(input.cashOnHand)}`,
        `Projected 30-day closing cash: ${money(input.cashFlow30DayClosing)}`,
      ],
    });
  }

  // Structural loss beats everything except running out of cash.
  if (input.expenseRatioPct !== null && input.grossMarginPct !== null && input.expenseRatioPct >= input.grossMarginPct) {
    candidates.push({
      id: "high_expenses",
      score: 95,
      reason: `Running costs of ${pct(input.expenseRatioPct)} of revenue exceed the ${pct(input.grossMarginPct)} gross margin.`,
      evidence: [
        `Gross margin: ${pct(input.grossMarginPct)}`,
        `Expense ratio: ${pct(input.expenseRatioPct)}`,
        `Net result: ${money(input.netProfit)}`,
      ],
    });
  }

  // Capital cannot stock what demand wants.
  if (input.revenueCapacity !== null && input.forecastRevenueNextMonth > 0) {
    const shortfallShare =
      (input.forecastRevenueNextMonth - input.revenueCapacity) / input.forecastRevenueNextMonth;
    if (shortfallShare > 0.05) {
      candidates.push({
        id: "working_capital",
        score: 85 + Math.min(10, shortfallShare * 20),
        reason: `Available capital supports about ${money(input.revenueCapacity)} of monthly revenue against forecast demand of ${money(input.forecastRevenueNextMonth)}.`,
        evidence: [
          `Available working capital: ${money(input.workingCapitalAvailable)}`,
          input.workingCapitalRequired !== null
            ? `Required for current trading: ${money(input.workingCapitalRequired)}`
            : "Required working capital: not measurable",
          `Revenue capacity: ${money(input.revenueCapacity)} vs forecast ${money(input.forecastRevenueNextMonth)}`,
        ],
      });
    } else if (input.revenueCapacity > input.forecastRevenueNextMonth * 1.2) {
      candidates.push({
        id: "sales_demand",
        score: 60,
        reason: `Capital could carry ${money(input.revenueCapacity)} of monthly revenue, but the sales trend only points to ${money(input.forecastRevenueNextMonth)}.`,
        evidence: [
          `Revenue capacity: ${money(input.revenueCapacity)}`,
          `Forecast revenue: ${money(input.forecastRevenueNextMonth)}`,
          input.revenueChangePct !== null ? `Revenue trend: ${pct(input.revenueChangePct)}` : "Revenue trend: not measurable",
        ],
      });
    }
  }

  // Money stuck on the shelf.
  if (input.capitalTrappedSharePct !== null && input.capitalTrappedSharePct >= 25) {
    candidates.push({
      id: "slow_inventory",
      score: 70 + Math.min(15, input.capitalTrappedSharePct / 4),
      reason: `${pct(input.capitalTrappedSharePct)} of stock value sits in lines that are not turning.`,
      evidence: [
        `Capital in slow/dead stock: ${money(input.capitalTrappedTotal)}`,
        `Total stock at cost: ${money(input.totalInventoryValue)}`,
        input.inventoryHoldingDays !== null
          ? `Average holding period: ${input.inventoryHoldingDays.toFixed(0)} days`
          : "Holding period: not measurable",
      ],
    });
  }

  // Money stuck with customers.
  if (
    input.receivableDays !== null &&
    input.receivableDays > 20 &&
    input.monthlyRevenue > 0 &&
    input.receivablesOutstanding > input.monthlyRevenue * 0.4
  ) {
    candidates.push({
      id: "customer_receivables",
      score: 72,
      reason: `${money(input.receivablesOutstanding)} is sitting with customers, taking about ${input.receivableDays.toFixed(0)} days to come back.`,
      evidence: [
        `Outstanding: ${money(input.receivablesOutstanding)}`,
        `Overdue: ${money(input.receivablesOverdue)}`,
        `Collection period: ${input.receivableDays.toFixed(1)} days`,
      ],
    });
  }

  // Empty shelves on lines that were selling.
  if (input.outOfStockExposureSharePct !== null && input.outOfStockExposureSharePct >= 8) {
    candidates.push({
      id: "inventory_availability",
      score: 68 + Math.min(12, input.outOfStockExposureSharePct / 2),
      reason: `Lines worth ${pct(input.outOfStockExposureSharePct)} of monthly revenue are out of stock while still selling.`,
      evidence: [
        `Monthly exposure: ${money(input.outOfStockExposure)}`,
        `Fast-moving lines: ${input.fastMovingCount}`,
      ],
    });
  }

  // Thin margin with an otherwise healthy business.
  if (input.grossMarginPct !== null && input.grossMarginPct < 8) {
    candidates.push({
      id: "low_gross_margin",
      score: 66,
      reason: `A ${pct(input.grossMarginPct)} gross margin leaves very little to cover running costs and fund growth.`,
      evidence: [
        `Gross margin: ${pct(input.grossMarginPct)}`,
        input.expenseRatioPct !== null ? `Expense ratio: ${pct(input.expenseRatioPct)}` : "Expense ratio: not measurable",
      ],
    });
  }

  // Supplier credit, when the cycle is long and there is none.
  if (!input.payableDaysTracked && input.cashCycleDays !== null && input.cashCycleDays > 45) {
    candidates.push({
      id: "supplier_terms",
      score: 55,
      reason: `Cash stays tied up about ${input.cashCycleDays.toFixed(0)} days, with no supplier credit recorded to offset any of it.`,
      evidence: [
        `Cash conversion cycle: ${input.cashCycleDays.toFixed(0)} days`,
        "Supplier payment days: not tracked in TradeBridge",
      ],
    });
  }

  if (candidates.length === 0) {
    return {
      id: "insufficient_data",
      label: CONSTRAINT_LABELS.insufficient_data,
      explanation:
        "No single constraint stands out from the recorded data: capital, stock, demand, margin and collections are all within normal ranges for the history available. Either the business is reasonably balanced right now, or there is not yet enough history to separate the causes.",
      evidence: [
        `${input.monthsOfHistory} completed months of history`,
        input.grossMarginPct !== null ? `Gross margin: ${pct(input.grossMarginPct)}` : "Gross margin: not measurable",
        input.cashCycleDays !== null ? `Cash cycle: ${input.cashCycleDays.toFixed(0)} days` : "Cash cycle: not measurable",
      ],
      alternates: [],
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0]!;

  return {
    id: winner.id,
    label: CONSTRAINT_LABELS[winner.id],
    explanation: winner.reason,
    evidence: winner.evidence,
    alternates: candidates.slice(1, 3).map((c) => ({
      id: c.id,
      label: CONSTRAINT_LABELS[c.id],
      reason: c.reason,
    })),
  };
}
