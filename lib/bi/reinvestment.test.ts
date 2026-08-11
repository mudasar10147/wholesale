/**
 * Run: npm run test:bi-reinvestment
 *
 * The compounding loop is the heart of this feature. The rule it must never
 * break: extra inventory does not automatically become revenue.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildReinvestmentCycle, projectCompounding } from "./reinvestment.ts";

const BASE = {
  openingCapital: 1_000_000,
  turnoverPerMonth: 1,
  cogsRatio: 0.87,
  fixedExpenses: 40_000,
  variableExpenseRate: 0.02,
  unclassifiedExpenses: 0,
  labels: ["M1", "M2", "M3"],
};

test("profit is fully reinvested and compounds the capital base", () => {
  const projection = projectCompounding({
    ...BASE,
    // Demand well above what the capital can carry, so capital is the binding side.
    demandRevenueByMonth: [10_000_000, 10_000_000, 10_000_000],
  });

  assert.equal(projection.reinvestmentRate, 1);
  const [first, second] = projection.months;
  assert.ok(first && second);
  // Next month opens with last month's closing capital — profit went straight back in.
  assert.equal(second.openingCapital, first.closingCapital);
  assert.equal(first.closingCapital, Math.round((first.openingCapital + first.netProfit) * 100) / 100);
  assert.ok(second.openingCapital > first.openingCapital);
});

test("revenue is capped by demand, not by how much stock capital could buy", () => {
  const projection = projectCompounding({
    ...BASE,
    // Capital could push ~1.15m of revenue, but customers only want 300k.
    demandRevenueByMonth: [300_000, 300_000, 300_000],
  });

  for (const month of projection.months) {
    assert.equal(month.revenue, 300_000);
    assert.equal(month.bindingConstraint, "demand");
    assert.ok(month.capacityRevenue !== null && month.capacityRevenue > month.revenue);
  }
  assert.equal(projection.dominantConstraint, "demand");
});

test("revenue is capped by capital when demand outruns it", () => {
  const projection = projectCompounding({
    ...BASE,
    openingCapital: 100_000,
    demandRevenueByMonth: [5_000_000, 5_000_000, 5_000_000],
  });

  const first = projection.months[0]!;
  assert.equal(first.bindingConstraint, "capital");
  assert.ok(first.revenue < first.demandRevenue);
  // 100,000 capital × 1 turn ÷ 0.87 cost ratio ≈ 114,943 of revenue.
  assert.ok(Math.abs(first.revenue - 100_000 / 0.87) < 1);
  assert.equal(projection.dominantConstraint, "capital");
});

test("faster inventory rotation lifts what the same capital can carry", () => {
  const slow = projectCompounding({
    ...BASE,
    turnoverPerMonth: 1,
    demandRevenueByMonth: [10_000_000],
    labels: ["M1"],
  });
  const fast = projectCompounding({
    ...BASE,
    turnoverPerMonth: 3,
    demandRevenueByMonth: [10_000_000],
    labels: ["M1"],
  });

  assert.ok(fast.months[0]!.revenue > slow.months[0]!.revenue * 2.5);
});

test("without a measurable turnover the capital ceiling is not applied", () => {
  const projection = projectCompounding({
    ...BASE,
    turnoverPerMonth: null,
    demandRevenueByMonth: [400_000],
    labels: ["M1"],
  });

  const first = projection.months[0]!;
  assert.equal(first.capacityRevenue, null);
  assert.equal(first.bindingConstraint, "unknown");
  assert.equal(first.revenue, 400_000);
});

test("a loss shrinks the capital base instead of growing it", () => {
  const projection = projectCompounding({
    ...BASE,
    fixedExpenses: 500_000,
    demandRevenueByMonth: [300_000, 300_000, 300_000],
  });

  const [first, second] = projection.months;
  assert.ok(first && second);
  assert.ok(first.netProfit < 0);
  assert.ok(second.openingCapital < first.openingCapital);
  assert.ok(projection.totalReinvested < 0);
});

test("capital never goes negative and every figure stays finite", () => {
  const projection = projectCompounding({
    ...BASE,
    openingCapital: 10_000,
    fixedExpenses: 5_000_000,
    demandRevenueByMonth: [100_000, 100_000, 100_000],
  });

  for (const month of projection.months) {
    assert.ok(month.closingCapital >= 0);
    assert.ok(Number.isFinite(month.revenue));
    assert.ok(Number.isFinite(month.netProfit));
    assert.ok(Number.isFinite(month.purchasingCapacity));
    assert.ok(month.purchasingCapacity >= 0);
  }
});

test("zero sales and zero capital produce zeros, not NaN", () => {
  const projection = projectCompounding({
    openingCapital: 0,
    turnoverPerMonth: null,
    cogsRatio: null,
    fixedExpenses: 0,
    variableExpenseRate: 0,
    unclassifiedExpenses: 0,
    demandRevenueByMonth: [0, 0],
    labels: ["M1", "M2"],
  });

  for (const month of projection.months) {
    assert.equal(month.revenue, 0);
    assert.equal(month.cogs, 0);
    assert.equal(month.netProfit, 0);
    assert.equal(month.closingCapital, 0);
  }
  assert.equal(projection.totalReinvested, 0);
});

test("cumulative reinvested profit accumulates across months", () => {
  const projection = projectCompounding({
    ...BASE,
    demandRevenueByMonth: [10_000_000, 10_000_000, 10_000_000],
  });
  const [a, b, c] = projection.months;
  assert.ok(a && b && c);
  assert.ok(Math.abs(c.cumulativeReinvested - (a.reinvestedProfit + b.reinvestedProfit + c.reinvestedProfit)) < 0.05);
  assert.equal(projection.totalReinvested, c.cumulativeReinvested);
});

test("one turn of the loop converts profit into stock, then into sales", () => {
  const cycle = buildReinvestmentCycle({
    netProfitThisMonth: 100_000,
    turnoverPerMonth: 2,
    cogsRatio: 0.87,
    variableExpenseRate: 0.02,
    demandHeadroom: null,
  });

  assert.equal(cycle.amountReinvested, 100_000);
  assert.equal(cycle.additionalInventorySupported, 100_000);
  // 100k of stock turning twice = 200k of cost, which at an 87% cost ratio is ~229,885 of sales.
  assert.ok(Math.abs((cycle.potentialAdditionalSales ?? 0) - 200_000 / 0.87) < 1);
  assert.ok((cycle.potentialAdditionalGrossProfit ?? 0) > 0);
  assert.ok(
    (cycle.potentialAdditionalNetProfit ?? 0) < (cycle.potentialAdditionalGrossProfit ?? 0),
  );
  assert.equal(cycle.cappedByDemand, false);
});

test("the loop respects a demand ceiling and says so", () => {
  const cycle = buildReinvestmentCycle({
    netProfitThisMonth: 100_000,
    turnoverPerMonth: 2,
    cogsRatio: 0.87,
    variableExpenseRate: 0.02,
    demandHeadroom: 50_000,
  });

  assert.equal(cycle.potentialAdditionalSales, 50_000);
  assert.equal(cycle.cappedByDemand, true);
  assert.ok(cycle.note.toLowerCase().includes("demand"));
});

test("a loss-making month reinvests nothing and claims no upside", () => {
  const cycle = buildReinvestmentCycle({
    netProfitThisMonth: -50_000,
    turnoverPerMonth: 2,
    cogsRatio: 0.87,
    variableExpenseRate: 0.02,
    demandHeadroom: null,
  });

  assert.equal(cycle.amountReinvested, 0);
  assert.equal(cycle.potentialAdditionalSales, 0);
  assert.equal(cycle.estimatedNetProfitThisMonth, -50_000);
});

test("missing turnover or margin reports null rather than a made-up number", () => {
  const noTurnover = buildReinvestmentCycle({
    netProfitThisMonth: 100_000,
    turnoverPerMonth: null,
    cogsRatio: 0.87,
    variableExpenseRate: 0,
    demandHeadroom: null,
  });
  assert.equal(noTurnover.potentialAdditionalSales, null);
  assert.equal(noTurnover.potentialAdditionalNetProfit, null);

  const noMargin = buildReinvestmentCycle({
    netProfitThisMonth: 100_000,
    turnoverPerMonth: 2,
    cogsRatio: null,
    variableExpenseRate: 0,
    demandHeadroom: null,
  });
  assert.equal(noMargin.potentialAdditionalSales, null);
});
