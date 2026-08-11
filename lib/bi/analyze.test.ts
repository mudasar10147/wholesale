/**
 * Run: npm run test:bi-analyze
 *
 * End-to-end checks over the whole analysis pipeline with a synthetic dataset:
 * a real business shape, an empty business, a loss-making business, and the
 * "less than one month of history" case.
 *
 * The fixture mimics the real Firestore documents, including the detail that
 * returns are stored as separate negative `sales` rows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBusiness } from "./analyze.ts";
import type { BusinessDataset, WithId } from "./dataset.ts";
import { resolveAnalysisPeriod } from "./periods.ts";
import { buildExpenseBreakdown, classifyExpenseTitle } from "./expenseCategories.ts";
import { buildReceivablesReport, bucketForOverdueDays } from "./receivables.ts";
import { buildProductIntelligence } from "./productIntelligence.ts";
import { buildCashFlowForecast } from "./cashFlow.ts";
import { diagnoseGrowthConstraint, type InsightInput } from "./insights.ts";

/* ── Fixture helpers ──────────────────────────────────────────────────── */

/** A Firestore-like Timestamp stub — only the methods the code actually calls. */
function ts(date: Date) {
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
  } as never;
}

const NOW = new Date(2026, 7, 20, 12, 0, 0); // 20 Aug 2026, local

function monthDate(monthsAgo: number, day = 15): Date {
  return new Date(NOW.getFullYear(), NOW.getMonth() - monthsAgo, day, 10, 0, 0);
}

type SaleSeed = {
  monthsAgo: number;
  productId: string;
  quantity: number;
  total: number;
  cogs: number;
  invoiceId?: string;
  isReturn?: boolean;
  day?: number;
};

function makeSale(seed: SaleSeed, index: number): WithId<never> {
  return {
    id: `sale-${index}`,
    data: {
      product_id: seed.productId,
      quantity: seed.quantity,
      sale_price: seed.quantity > 0 ? seed.total / seed.quantity : 0,
      total_amount: seed.total,
      cogs_amount: seed.cogs,
      invoice_id: seed.invoiceId,
      sale_type: seed.isReturn ? "return" : undefined,
      customer_id: "cust-1",
      date: ts(monthDate(seed.monthsAgo, seed.day)),
    } as never,
  };
}

type DatasetOverrides = Partial<BusinessDataset>;

function buildDataset(overrides: DatasetOverrides = {}): BusinessDataset {
  // Six completed months plus a part-month, growing ~10% a month at a 13% margin.
  const saleSeeds: SaleSeed[] = [];
  const monthlyRevenue = [300_000, 330_000, 363_000, 399_300, 439_230, 483_153, 250_000];
  monthlyRevenue.forEach((revenue, i) => {
    const monthsAgo = 6 - i;
    saleSeeds.push({
      monthsAgo,
      productId: "p-fast",
      quantity: 100,
      total: revenue * 0.6,
      cogs: revenue * 0.6 * 0.87,
      invoiceId: `inv-${monthsAgo}-a`,
    });
    saleSeeds.push({
      monthsAgo,
      productId: "p-slow",
      quantity: 10,
      total: revenue * 0.4,
      cogs: revenue * 0.4 * 0.87,
      invoiceId: `inv-${monthsAgo}-b`,
    });
  });
  // One posted return, stored as a negative row against an existing invoice.
  saleSeeds.push({
    monthsAgo: 1,
    productId: "p-fast",
    quantity: 2,
    total: -5_000,
    cogs: -4_350,
    invoiceId: "inv-1-a",
    isReturn: true,
  });
  // A sale row left behind by an invoice that was later voided. It must never
  // reach revenue — the amount is deliberately huge so a leak is unmissable.
  saleSeeds.push({
    monthsAgo: 1,
    productId: "p-fast",
    quantity: 400,
    total: 9_000_000,
    cogs: 7_830_000,
    invoiceId: "inv-void",
  });

  const sales = saleSeeds.map(makeSale);

  const expenses: WithId<never>[] = [];
  for (let monthsAgo = 6; monthsAgo >= 0; monthsAgo -= 1) {
    expenses.push({
      id: `exp-salary-${monthsAgo}`,
      data: { title: "Staff salary", amount: 30_000, date: ts(monthDate(monthsAgo, 1)) } as never,
    });
    expenses.push({
      id: `exp-delivery-${monthsAgo}`,
      data: { title: "Delivery charges", amount: 8_000, date: ts(monthDate(monthsAgo, 5)) } as never,
    });
    expenses.push({
      id: `exp-misc-${monthsAgo}`,
      data: { title: "Sundry", amount: 2_000, date: ts(monthDate(monthsAgo, 9)) } as never,
    });
  }

  const stockLots: WithId<never>[] = [];
  for (let monthsAgo = 6; monthsAgo >= 0; monthsAgo -= 1) {
    stockLots.push({
      id: `lot-${monthsAgo}`,
      data: {
        product_id: "p-fast",
        source: "stock_in",
        qty_in: 120,
        qty_remaining: monthsAgo === 0 ? 40 : 0,
        unit_cost: 2_000,
        trader_id: "trader-1",
        received_at: ts(monthDate(monthsAgo, 2)),
        created_at: ts(monthDate(monthsAgo, 2)),
      } as never,
    });
  }
  stockLots.push({
    id: "lot-slow",
    data: {
      product_id: "p-slow",
      source: "stock_in",
      qty_in: 50,
      qty_remaining: 45,
      unit_cost: 3_000,
      trader_id: "trader-2",
      received_at: ts(monthDate(6, 3)),
      created_at: ts(monthDate(6, 3)),
    } as never,
  });

  return {
    now: NOW,
    historyStart: new Date(NOW.getFullYear(), NOW.getMonth() - 23, 1),
    products: [
      {
        id: "p-fast",
        data: {
          name: "Sugar 50kg",
          category: "Grocery",
          cost_price: 2_000,
          sale_price: 2_300,
          stock_quantity: 40,
          created_at: ts(monthDate(12, 1)),
        } as never,
      },
      {
        id: "p-slow",
        data: {
          name: "Imported Olive Oil",
          category: "Specialty",
          cost_price: 3_000,
          sale_price: 3_450,
          stock_quantity: 45,
          created_at: ts(monthDate(12, 1)),
        } as never,
      },
    ],
    sales: sales as never,
    expenses: expenses as never,
    invoices: [
      {
        id: "inv-1-a",
        data: {
          customer_id: "cust-1",
          order_id: "ORD-1",
          status: "posted",
          payment_status: "unpaid",
          paid_amount: 0,
          total_amount: 120_000,
          posted_total_amount: 120_000,
          posted_at: ts(new Date(NOW.getFullYear(), NOW.getMonth(), 5)),
          created_at: ts(new Date(NOW.getFullYear(), NOW.getMonth(), 5)),
        } as never,
      },
      {
        id: "inv-void",
        data: {
          customer_id: "cust-1",
          order_id: "ORD-VOID",
          status: "void",
          payment_status: "unpaid",
          paid_amount: 0,
          total_amount: 999_999,
          created_at: ts(monthDate(1, 5)),
        } as never,
      },
    ] as never,
    stockLots: stockLots as never,
    cashEntries: [
      { id: "cash-1", data: { entry_type: "add", amount: 500_000, date: ts(monthDate(6, 1)) } as never },
    ] as never,
    customers: [{ id: "cust-1", data: { name: "Rahim Traders", is_active: true } as never }],
    traders: [
      { id: "trader-1", data: { name: "Metro Wholesale", is_active: true } as never },
      { id: "trader-2", data: { name: "Import House", is_active: true } as never },
    ] as never,
    invoiceReturns: [],
    inventoryDiscards: [],
    cashOpeningBalance: 100_000,
    actualCashBalance: null,
    ...overrides,
  };
}

function analyzeFixture(dataset: BusinessDataset = buildDataset()) {
  const period = resolveAnalysisPeriod("last_3_months", dataset.now);
  assert.ok(period, "period should resolve");
  return analyzeBusiness(dataset, { period, horizon: "6", scenario: "expected" });
}

/* ── Pipeline ─────────────────────────────────────────────────────────── */

test("the whole report builds from a realistic dataset", () => {
  const report = analyzeFixture();

  assert.ok(report.periodTotals.revenue > 0);
  assert.ok(report.periodTotals.cogs > 0);
  assert.equal(
    report.periodTotals.grossProfit,
    Math.round((report.periodTotals.revenue - report.periodTotals.cogs) * 100) / 100,
  );
  assert.equal(
    report.periodTotals.netProfit,
    Math.round((report.periodTotals.grossProfit - report.periodTotals.expenses) * 100) / 100,
  );
  // A ~13% margin business.
  assert.ok((report.periodTotals.grossMarginPct ?? 0) > 12.5);
  assert.ok((report.periodTotals.grossMarginPct ?? 0) < 13.5);
});

test("sale rows belonging to a voided invoice never enter revenue", () => {
  const report = analyzeFixture();
  // The voided invoice's row carries 9,000,000. Real monthly revenue is well
  // under a million, so any leak would be obvious here and in every month.
  assert.ok(report.periodTotals.revenue < 2_000_000);
  assert.ok(report.periodTotals.cogs < 2_000_000);
  for (const point of report.series.points) {
    assert.ok(point.revenue < 2_000_000, `${point.key} revenue leaked: ${point.revenue}`);
  }
  // And it must not reach the product tables either.
  for (const product of report.products.products) {
    assert.ok(product.revenue < 2_000_000);
  }
});

test("returns net off revenue and units rather than adding to them", () => {
  const withReturn = analyzeFixture();
  const withoutReturn = analyzeFixture(
    buildDataset({
      sales: buildDataset().sales.filter((s) => (s.data as { sale_type?: string }).sale_type !== "return"),
    }),
  );
  assert.ok(withReturn.periodTotals.revenue < withoutReturn.periodTotals.revenue);
});

test("purchases are a cash outflow, never an expense", () => {
  const report = analyzeFixture();
  assert.ok(report.periodTotals.purchases > 0);
  // Net profit must equal gross profit minus expenses, with purchases nowhere in it.
  assert.equal(
    report.periodTotals.netProfit,
    Math.round((report.periodTotals.grossProfit - report.periodTotals.expenses) * 100) / 100,
  );
  // The cash-flow forecast is where purchases do show up.
  const thirty = report.cashFlow.horizons.find((h) => h.id === "30");
  assert.ok(thirty && thirty.inventoryPurchases > 0);
});

test("supplier payables stay untracked throughout the report", () => {
  const report = analyzeFixture();
  assert.equal(report.cashCycle.payableDaysTracked, false);
  assert.equal(report.workingCapital.supplierPayables, null);
  assert.equal(report.suppliers.totalPayable, null);
  assert.ok(report.dataGaps.some((g) => g.metric.toLowerCase().includes("supplier")));
});

test("the executive sentence is built from real calculated values", () => {
  const report = analyzeFixture();
  assert.ok(report.executive.sentence.includes("Rs."));
  assert.ok(report.executive.sentence.includes("TradeBridge"));
  assert.ok(Number.isFinite(report.executive.revenue.forecast));
  assert.ok(report.executive.revenue.forecast > 0);
  assert.ok(report.executive.currentMonthDaysElapsed > 0);
  assert.ok(report.executive.currentMonthDaysElapsed <= report.executive.currentMonthDaysTotal);
});

test("six months of history earns better than low confidence", () => {
  const report = analyzeFixture();
  assert.ok(["high", "medium"].includes(report.forecasts.revenue.confidence.level));
  assert.ok(report.forecasts.revenue.confidence.reasons.length > 0);
});

test("suppliers are compared and margin is attributed to them", () => {
  const report = analyzeFixture();
  assert.ok(report.suppliers.suppliers.length >= 1);
  const metro = report.suppliers.suppliers.find((s) => s.name === "Metro Wholesale");
  assert.ok(metro);
  assert.ok(metro.purchaseValue > 0);
  assert.ok(metro.attributedRevenue > 0);
});

test("insights, risks and a growth constraint are always produced", () => {
  const report = analyzeFixture();
  assert.ok(report.insights.length <= 7);
  assert.ok(report.growthConstraint.label.length > 0);
  assert.ok(report.growthConstraint.explanation.length > 0);
  for (const insight of report.insights) {
    assert.ok(insight.text.length > 0);
    assert.ok(!insight.text.includes("NaN"));
    assert.ok(!insight.text.includes("undefined"));
  }
});

test("no rendered number anywhere in the report is NaN", () => {
  const report = analyzeFixture();
  const walk = (value: unknown, path: string) => {
    if (typeof value === "number") {
      assert.ok(Number.isFinite(value), `${path} should be finite, got ${value}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof Map)) {
      for (const [key, v] of Object.entries(value)) {
        if (typeof v === "function") continue;
        walk(v, `${path}.${key}`);
      }
    }
  };
  walk(report, "report");
});

/* ── Empty and thin data ──────────────────────────────────────────────── */

function emptyDataset(): BusinessDataset {
  return {
    now: NOW,
    historyStart: new Date(NOW.getFullYear(), NOW.getMonth() - 23, 1),
    products: [],
    sales: [],
    expenses: [],
    invoices: [],
    stockLots: [],
    cashEntries: [],
    customers: [],
    traders: [],
    invoiceReturns: [],
    inventoryDiscards: [],
    cashOpeningBalance: 0,
    actualCashBalance: null,
  };
}

test("a business with no data reports zeros and insufficient data, never fake numbers", () => {
  const report = analyzeFixture(emptyDataset());

  assert.equal(report.periodTotals.revenue, 0);
  assert.equal(report.periodTotals.grossMarginPct, null);
  assert.equal(report.periodTotals.cogsRatio, null);
  assert.equal(report.inventoryEfficiency.turnoverPerMonth, null);
  assert.equal(report.cashCycle.effectiveCycleDays, null);
  assert.equal(report.workingCapital.requiredTotal, null);
  assert.equal(report.revenueCapacity.revenueCapacity, null);
  assert.equal(report.breakEven.breakEvenRevenue, null);
  assert.equal(report.forecasts.revenue.confidence.level, "insufficient");
  assert.equal(report.growthConstraint.id, "insufficient_data");
  assert.ok(report.dataGaps.length > 0);
  // And the executive numbers are honest zeros, not invented figures.
  assert.equal(report.executive.revenue.forecast, 0);
  assert.equal(report.executive.netProfit.forecast, 0);
});

test("less than one month of history is flagged, not extrapolated", () => {
  const dataset = buildDataset();
  // Keep only sales inside the current (part) month.
  const currentMonthOnly = dataset.sales.filter((s) => {
    const date = (s.data as { date: { toDate(): Date } }).date.toDate();
    return date.getMonth() === NOW.getMonth() && date.getFullYear() === NOW.getFullYear();
  });
  const report = analyzeFixture(
    buildDataset({ sales: currentMonthOnly as never, expenses: [] as never }),
  );

  assert.equal(report.forecasts.revenue.confidence.level, "insufficient");
  assert.ok(report.forecasts.revenue.confidence.reasons.length > 0);
  assert.ok(report.dataGaps.some((g) => g.metric.toLowerCase().includes("forecast")));
});

test("a loss-making business reports a loss and shrinking capital", () => {
  const dataset = buildDataset();
  const heavyExpenses = dataset.expenses.map((e, i) => ({
    id: `heavy-${i}`,
    data: { ...(e.data as object), amount: 400_000 } as never,
  }));
  const report = analyzeFixture(buildDataset({ expenses: heavyExpenses as never }));

  assert.ok(report.periodTotals.netProfit < 0);
  assert.ok((report.periodTotals.netMarginPct ?? 0) < 0);
  assert.ok(report.risks.some((r) => r.id === "negative_profit" || r.id === "working_capital_gap"));
});

/* ── Expense classification ───────────────────────────────────────────── */

test("expense titles classify into categories with a fixed / variable nature", () => {
  assert.equal(classifyExpenseTitle("Staff salary August").id, "salary");
  assert.equal(classifyExpenseTitle("Staff salary August").nature, "fixed");
  assert.equal(classifyExpenseTitle("Delivery van fuel").id, "delivery");
  assert.equal(classifyExpenseTitle("Delivery van fuel").nature, "variable");
  assert.equal(classifyExpenseTitle("Shop rent").id, "rent_warehouse");
  assert.equal(classifyExpenseTitle("Bijli bill").id, "utilities");
});

test("unrecognised titles are left unclassified, never guessed", () => {
  assert.equal(classifyExpenseTitle("qwerty zxcv").id, "unclassified");
  assert.equal(classifyExpenseTitle("").id, "unclassified");
  assert.equal(classifyExpenseTitle(undefined).id, "unclassified");
  assert.equal(classifyExpenseTitle("qwerty").nature, "unknown");
});

test("expense breakdown splits fixed, variable and unknown and compares periods", () => {
  const breakdown = buildExpenseBreakdown(
    [
      { title: "Salary", amount: 30_000 },
      { title: "Delivery", amount: 10_000 },
      { title: "Mystery item", amount: 5_000 },
    ],
    [
      { title: "Salary", amount: 30_000 },
      { title: "Delivery", amount: 8_000 },
    ],
  );

  assert.equal(breakdown.total, 45_000);
  assert.equal(breakdown.fixed, 30_000);
  assert.equal(breakdown.variable, 10_000);
  assert.equal(breakdown.unknown, 5_000);
  const delivery = breakdown.categories.find((c) => c.id === "delivery");
  assert.ok(delivery);
  assert.equal(delivery.previousAmount, 8_000);
  assert.ok(Math.abs((delivery.changePct ?? 0) - 25) < 0.001);
  assert.ok((breakdown.unclassifiedSharePct ?? 0) > 0);
});

test("an empty expense list produces zeros without dividing by zero", () => {
  const breakdown = buildExpenseBreakdown([]);
  assert.equal(breakdown.total, 0);
  assert.equal(breakdown.unclassifiedSharePct, null);
  assert.equal(breakdown.categories.length, 0);
});

/* ── Receivables ──────────────────────────────────────────────────────── */

test("ageing buckets follow the assumed credit term", () => {
  assert.equal(bucketForOverdueDays(0), "not_due");
  assert.equal(bucketForOverdueDays(-3), "not_due");
  assert.equal(bucketForOverdueDays(5), "d1_7");
  assert.equal(bucketForOverdueDays(12), "d8_15");
  assert.equal(bucketForOverdueDays(25), "d16_30");
  assert.equal(bucketForOverdueDays(90), "d30_plus");
});

test("receivables use the app's own invoice balance rules", () => {
  const report = buildReceivablesReport({
    invoices: [
      {
        id: "inv-a",
        data: {
          customer_id: "c1",
          order_id: "ORD-A",
          status: "posted",
          paid_amount: 40_000,
          total_amount: 100_000,
          posted_total_amount: 100_000,
          returned_amount: 10_000,
          posted_at: ts(new Date(NOW.getFullYear(), NOW.getMonth(), 1)),
        } as never,
      },
      {
        id: "inv-draft",
        data: { customer_id: "c1", order_id: "ORD-D", status: "draft", paid_amount: 0, total_amount: 50_000 } as never,
      },
      {
        id: "inv-void",
        data: { customer_id: "c1", order_id: "ORD-V", status: "void", paid_amount: 0, total_amount: 70_000 } as never,
      },
    ] as never,
    customers: [{ id: "c1", data: { name: "Rahim Traders" } as never }],
    now: NOW,
    creditSalesInPeriod: 300_000,
    totalSalesInPeriod: 400_000,
    periodDays: 30,
  });

  // Effective total is 100k − 10k returned = 90k, less 40k paid = 50k due.
  assert.equal(report.totalOutstanding, 50_000);
  // Drafts and voids never become receivables.
  assert.equal(report.invoiceCount, 1);
  assert.equal(report.topCustomers[0]?.customerName, "Rahim Traders");
  assert.ok(report.collectionPeriodDays !== null && report.collectionPeriodDays > 0);
  assert.ok(Math.abs((report.creditSalesSharePct ?? 0) - 75) < 0.001);
});

test("no outstanding invoices means no collection period, not a zero-day claim", () => {
  const report = buildReceivablesReport({
    invoices: [],
    customers: [],
    now: NOW,
    creditSalesInPeriod: 0,
    totalSalesInPeriod: 0,
    periodDays: 30,
  });
  assert.equal(report.totalOutstanding, 0);
  assert.equal(report.collectionPeriodDays, null);
  assert.equal(report.largestCustomerSharePct, null);
});

/* ── Product intelligence ─────────────────────────────────────────────── */

test("new products are never judged as dead stock", () => {
  const dataset = buildDataset();
  const intel = buildProductIntelligence({
    products: [
      {
        id: "brand-new",
        data: {
          name: "Brand New SKU",
          category: "Grocery",
          cost_price: 100,
          sale_price: 120,
          stock_quantity: 50,
          created_at: ts(new Date(NOW.getFullYear(), NOW.getMonth(), 10)),
        } as never,
      },
    ],
    sales: [],
    stockLots: [],
    voidInvoiceIds: new Set(),
    costByProductId: new Map(),
    periodStart: new Date(NOW.getFullYear(), NOW.getMonth() - 2, 1),
    periodEnd: dataset.now,
    periodDays: 90,
    now: NOW,
    monthlyRevenue: 100_000,
  });

  const product = intel.products[0]!;
  assert.equal(product.stockClass, "too_new");
  assert.equal(intel.deadStock.length, 0);
  assert.equal(intel.capitalTrappedTotal, 0);
});

test("stock-out exposure is a forward estimate, clearly labelled", () => {
  const report = analyzeFixture();
  const exposure = report.products.stockOutExposure;
  assert.ok(exposure.dataNote.includes("does not record unfulfilled orders"));
  for (const row of exposure.rows) {
    assert.ok(Number.isFinite(row.monthlyRevenueExposure));
    assert.ok(row.monthlyRevenueExposure >= 0);
  }
});

/* ── Cash flow ────────────────────────────────────────────────────────── */

test("cash flow forecast balances opening, inflows and outflows", () => {
  const forecast = buildCashFlowForecast({
    openingCash: 200_000,
    accountsReceivable: 120_000,
    collectionPeriodDays: 12,
    monthlyRevenue: 500_000,
    creditSalesShare: 0.6,
    monthlyExpenses: 40_000,
    monthlyCogs: 435_000,
    monthlyGrowthPurchases: 10_000,
  });

  for (const horizon of forecast.horizons) {
    assert.equal(
      horizon.closingCash,
      Math.round((horizon.openingCash + horizon.totalInflows - horizon.totalOutflows) * 100) / 100,
    );
    assert.equal(
      horizon.totalInflows,
      Math.round((horizon.collectionsFromReceivables + horizon.collectionsFromNewSales) * 100) / 100,
    );
  }
  // The whole receivable book is released once the collection period has passed.
  assert.equal(forecast.horizons.find((h) => h.id === "30")?.collectionsFromReceivables, 120_000);
  assert.ok(forecast.assumptions.length > 0);
});

test("a cash shortfall raises a warning rather than passing silently", () => {
  const forecast = buildCashFlowForecast({
    openingCash: 10_000,
    accountsReceivable: 0,
    collectionPeriodDays: 30,
    monthlyRevenue: 100_000,
    creditSalesShare: 1,
    monthlyExpenses: 200_000,
    monthlyCogs: 300_000,
    monthlyGrowthPurchases: 0,
  });

  assert.ok(forecast.horizons.some((h) => h.isNegative));
  assert.ok(forecast.warnings.some((w) => w.id === "cash_goes_negative"));
  assert.equal(forecast.warnings.find((w) => w.id === "cash_goes_negative")?.severity, "danger");
});

/* ── Growth constraint ────────────────────────────────────────────────── */

const CONSTRAINT_BASE: InsightInput = {
  monthlyRevenue: 500_000,
  previousMonthlyRevenue: 480_000,
  revenueChangePct: 4,
  grossMarginPct: 13,
  previousGrossMarginPct: 13,
  netProfit: 20_000,
  netMarginPct: 4,
  expenseRatioPct: 9,
  previousExpenseRatioPct: 9,
  expenseCategories: [],
  inventoryTurnoverPerMonth: 2,
  previousInventoryTurnoverPerMonth: 2,
  inventoryHoldingDays: 15,
  totalInventoryValue: 200_000,
  capitalTrappedTotal: 0,
  capitalTrappedSharePct: 0,
  deadStockValue: 0,
  workingCapitalAvailable: 400_000,
  workingCapitalRequired: 300_000,
  workingCapitalGap: -100_000,
  revenueCapacity: 600_000,
  forecastRevenueNextMonth: 520_000,
  forecastConfidenceLabel: "High confidence",
  forecastConfidenceLevel: "high",
  cashCycleDays: 20,
  receivableDays: 10,
  payableDaysTracked: false,
  receivablesOutstanding: 100_000,
  receivablesOverdue: 0,
  largestCustomerSharePct: 20,
  supplierConcentrationPct: 40,
  topProductSharePct: 20,
  topCategory: null,
  topGrossProfitCategory: null,
  fastMovingCount: 2,
  slowMovingCount: 0,
  outOfStockExposure: 0,
  outOfStockExposureSharePct: 0,
  cashFlow30DayClosing: 150_000,
  cashOnHand: 200_000,
  reinvestmentThreeMonthCapacityGrowthPct: 5,
  collectionImprovementCapital: 40_000,
  collectionImprovementDays: 4,
  monthsOfHistory: 6,
};

test("working capital is diagnosed when capacity falls short of demand", () => {
  const constraint = diagnoseGrowthConstraint({
    ...CONSTRAINT_BASE,
    revenueCapacity: 300_000,
    forecastRevenueNextMonth: 520_000,
  });
  assert.equal(constraint.id, "working_capital");
  assert.ok(constraint.evidence.length > 0);
});

test("sales demand is diagnosed when capital has spare room", () => {
  const constraint = diagnoseGrowthConstraint({
    ...CONSTRAINT_BASE,
    revenueCapacity: 2_000_000,
    forecastRevenueNextMonth: 520_000,
  });
  assert.equal(constraint.id, "sales_demand");
});

test("a cash shortfall outranks every other constraint", () => {
  const constraint = diagnoseGrowthConstraint({
    ...CONSTRAINT_BASE,
    cashFlow30DayClosing: -50_000,
    revenueCapacity: 300_000,
  });
  assert.equal(constraint.id, "cash_flow");
  // The working-capital squeeze is still surfaced as a runner-up.
  assert.ok(constraint.alternates.some((a) => a.id === "working_capital"));
});

test("slow inventory is diagnosed when a quarter of stock is not turning", () => {
  const constraint = diagnoseGrowthConstraint({
    ...CONSTRAINT_BASE,
    revenueCapacity: 550_000,
    forecastRevenueNextMonth: 520_000,
    capitalTrappedTotal: 80_000,
    capitalTrappedSharePct: 40,
  });
  assert.equal(constraint.id, "slow_inventory");
});

test("nothing is diagnosed when there is no history to diagnose from", () => {
  const constraint = diagnoseGrowthConstraint({
    ...CONSTRAINT_BASE,
    monthsOfHistory: 0,
    monthlyRevenue: 0,
  });
  assert.equal(constraint.id, "insufficient_data");
  assert.ok(constraint.explanation.toLowerCase().includes("not yet enough"));
});
