/**
 * Run: npm run test:bi-finance
 *
 * The core financial formulas, including every divide-by-zero and
 * missing-data path. If one of these breaks, a number on the Business
 * Intelligence page is lying.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  breakEvenRevenue,
  cashConversionCycle,
  clamp,
  cogsCapacityFromWorkingCapital,
  cogsRatio,
  expenseRatioPct,
  grossMarginPct,
  grossProfit,
  inventoryDays,
  inventoryTurnover,
  markupPct,
  marginOfSafetyPct,
  mean,
  median,
  netMarginPct,
  netProfit,
  payableDays,
  percentChange,
  receivableDays,
  revenueForTargetNetProfit,
  revenueFromCogs,
  roundMoney2,
  safeDivide,
  stdDev,
  workingCapitalRequired,
} from "./finance.ts";

test("gross profit is revenue minus cost of goods", () => {
  assert.equal(grossProfit(100_000, 87_000), 13_000);
  assert.equal(grossProfit(0, 0), 0);
  // A loss-making sale stays negative rather than being clamped.
  assert.equal(grossProfit(1_000, 1_500), -500);
});

test("gross margin is measured on the selling price", () => {
  assert.equal(grossMarginPct(100_000, 87_000), 13);
  assert.equal(grossMarginPct(1_000, 0), 100);
});

test("gross margin is null when there is no revenue", () => {
  assert.equal(grossMarginPct(0, 0), null);
  assert.equal(grossMarginPct(-50, 10), null);
  assert.equal(grossMarginPct(Number.NaN, 10), null);
});

test("markup is measured on cost and is NOT the same as margin", () => {
  const margin = grossMarginPct(100, 87);
  const markup = markupPct(100, 87);
  assert.equal(margin, 13);
  assert.ok(markup !== null);
  // 13/87 = 14.94…%, materially different from the 13% margin.
  assert.ok(Math.abs(markup - 14.9425) < 0.001);
  assert.notEqual(margin, markup);
});

test("markup is null when there is no cost", () => {
  assert.equal(markupPct(1_000, 0), null);
  assert.equal(markupPct(1_000, -5), null);
});

test("net profit subtracts operating expenses from gross profit", () => {
  assert.equal(netProfit(500_000, 435_000, 40_000), 25_000);
  // Expenses above gross profit produce a real loss.
  assert.equal(netProfit(100_000, 90_000, 20_000), -10_000);
  // Missing expense data is treated as zero, never as NaN.
  assert.equal(netProfit(100_000, 90_000, Number.NaN), 10_000);
});

test("net margin is null without revenue and negative on a loss", () => {
  assert.equal(netMarginPct(0, 0, 5_000), null);
  assert.equal(netMarginPct(100_000, 90_000, 20_000), -10);
});

test("cogs ratio and expense ratio guard a zero base", () => {
  assert.equal(cogsRatio(100, 87), 0.87);
  assert.equal(cogsRatio(0, 87), null);
  assert.equal(expenseRatioPct(200_000, 20_000), 10);
  assert.equal(expenseRatioPct(0, 20_000), null);
});

test("percent change refuses a zero or negative base", () => {
  assert.equal(percentChange(500_000, 565_000), 13);
  assert.equal(percentChange(0, 100), null);
  assert.equal(percentChange(-100, 100), null);
});

test("inventory turnover needs both cogs and stock", () => {
  assert.equal(inventoryTurnover(300_000, 100_000), 3);
  assert.equal(inventoryTurnover(300_000, 0), null);
  assert.equal(inventoryTurnover(0, 100_000), null);
  assert.equal(inventoryTurnover(300_000, -5), null);
});

test("inventory days invert turnover over the period length", () => {
  assert.equal(inventoryDays(300_000, 100_000, 30), 10);
  assert.equal(inventoryDays(0, 100_000, 30), null);
  assert.equal(inventoryDays(300_000, 100_000, 0), null);
  // No stock on hand is a real answer of zero days, not missing data.
  assert.equal(inventoryDays(300_000, 0, 30), 0);
});

test("receivable and payable days need a sales / purchase base", () => {
  assert.equal(receivableDays(300_000, 100_000, 30), 10);
  assert.equal(receivableDays(0, 100_000, 30), null);
  assert.equal(payableDays(300_000, 30_000, 30), 3);
  assert.equal(payableDays(0, 30_000, 30), null);
});

test("cash conversion cycle is null when any leg is unknown", () => {
  assert.equal(cashConversionCycle(30, 12, 8), 34);
  assert.equal(cashConversionCycle(30, 12, null), null);
  assert.equal(cashConversionCycle(null, 12, 8), null);
  // Untracked supplier credit is passed as an explicit zero, not as null.
  assert.equal(cashConversionCycle(30, 12, 0), 42);
});

test("break-even divides fixed cost by the contribution margin", () => {
  // 13% margin, 3% variable expenses → 10% contribution.
  assert.equal(breakEvenRevenue(50_000, 0.13, 0.03), 500_000);
});

test("break-even is null when variable costs eat the whole margin", () => {
  assert.equal(breakEvenRevenue(50_000, 0.1, 0.1), null);
  assert.equal(breakEvenRevenue(50_000, 0.05, 0.12), null);
  assert.equal(breakEvenRevenue(-1, 0.13, 0.03), null);
});

test("margin of safety compares revenue against break-even", () => {
  assert.equal(marginOfSafetyPct(600_000, 500_000), (100_000 / 600_000) * 100);
  // Below break-even reports negative rather than clamping to zero.
  assert.ok((marginOfSafetyPct(400_000, 500_000) ?? 0) < 0);
  assert.equal(marginOfSafetyPct(600_000, null), null);
  assert.equal(marginOfSafetyPct(0, 500_000), null);
});

test("target profit solves revenue from the contribution margin", () => {
  // (300k target + 50k fixed) / 0.10 contribution = 3.5m revenue.
  assert.equal(revenueForTargetNetProfit(300_000, 0.13, 0.03, 50_000), 3_500_000);
  // Unreachable when contribution is non-positive.
  assert.equal(revenueForTargetNetProfit(300_000, 0.05, 0.05, 50_000), null);
});

test("working capital required scales cogs by the cash cycle", () => {
  assert.equal(workingCapitalRequired(300_000, 30), 300_000);
  assert.equal(workingCapitalRequired(300_000, 60), 600_000);
  // A cycle of zero or less means capital is not locked up at all.
  assert.equal(workingCapitalRequired(300_000, 0), 0);
  assert.equal(workingCapitalRequired(300_000, -5), 0);
  assert.equal(workingCapitalRequired(300_000, null), null);
});

test("capacity is the inverse of the requirement", () => {
  assert.equal(cogsCapacityFromWorkingCapital(300_000, 30), 300_000);
  assert.equal(cogsCapacityFromWorkingCapital(600_000, 60), 300_000);
  assert.equal(cogsCapacityFromWorkingCapital(300_000, null), null);
  // No capital means no capacity, not a divide-by-zero.
  assert.equal(cogsCapacityFromWorkingCapital(0, 30), 0);
  assert.equal(cogsCapacityFromWorkingCapital(-100, 30), 0);
});

test("revenue from cogs needs a cost ratio", () => {
  assert.equal(revenueFromCogs(87_000, 0.87), 100_000);
  assert.equal(revenueFromCogs(87_000, null), null);
  assert.equal(revenueFromCogs(87_000, 0), null);
});

test("extremely high and low margins stay finite", () => {
  // Nearly-free goods: margin approaches 100%, markup explodes but stays finite.
  const highMargin = grossMarginPct(100_000, 1);
  assert.ok(highMargin !== null && highMargin > 99.9 && Number.isFinite(highMargin));
  const hugeMarkup = markupPct(100_000, 1);
  assert.ok(hugeMarkup !== null && Number.isFinite(hugeMarkup));
  // Selling below cost.
  assert.equal(grossMarginPct(100, 200), -100);
});

test("statistics helpers handle empty and single-value inputs", () => {
  assert.equal(mean([]), null);
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  // A single point has no deviation to measure.
  assert.equal(stdDev([5]), null);
  assert.equal(stdDev([2, 2, 2]), 0);
});

test("safeDivide, clamp and rounding never emit NaN or Infinity", () => {
  assert.equal(safeDivide(10, 0), null);
  assert.equal(safeDivide(Number.NaN, 2), null);
  assert.equal(safeDivide(10, 4), 2.5);
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(Number.NaN, 0, 1), 0);
  assert.equal(roundMoney2(1.005), 1);
  assert.equal(roundMoney2(1.0149), 1.01);
  assert.equal(roundMoney2(Number.NaN), 0);
});
