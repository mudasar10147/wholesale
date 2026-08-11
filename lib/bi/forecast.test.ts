/**
 * Run: npm run test:bi-forecast
 *
 * Forecasting behaviour that matters commercially: a single freak month must not
 * hijack the trend, thin history must be labelled low confidence, and no input
 * may produce NaN.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assessConfidence,
  buildMetricForecast,
  MAX_MONTHLY_GROWTH,
  monthRunRate,
  projectHorizons,
} from "./forecast.ts";

test("steady growth is projected forward", () => {
  const forecast = buildMetricForecast([100, 110, 121, 133.1, 146.41, 161.05]);
  // ~10% a month.
  assert.ok(Math.abs(forecast.growthRate - 0.1) < 0.01);
  assert.ok(forecast.nextMonth > 161.05);
  assert.equal(forecast.confidence.level, "high");
});

test("flat history projects flat, not zero", () => {
  const forecast = buildMetricForecast([200, 200, 200, 200, 200, 200]);
  assert.equal(forecast.growthRate, 0);
  assert.ok(Math.abs(forecast.nextMonth - 200) < 0.001);
});

test("one freak month does not hijack the trend", () => {
  const steady = [100, 100, 100, 100, 100];
  const withSpike = [100, 100, 900, 100, 100];
  const steadyForecast = buildMetricForecast(steady);
  const spikeForecast = buildMetricForecast(withSpike);

  // The spike pulls the level up but the *rate* stays near flat, because the
  // median of the month-over-month rates cancels the up-then-down move.
  assert.ok(Math.abs(spikeForecast.growthRate) < 0.2);
  // And the projection stays inside a sane band rather than compounding the spike.
  assert.ok(spikeForecast.nextMonth < 900);
  assert.ok(spikeForecast.nextMonth > steadyForecast.nextMonth);
});

test("growth is clamped to a believable band", () => {
  // Doubling every month would extrapolate absurdly if left unclamped.
  const forecast = buildMetricForecast([10, 100, 1_000, 10_000, 100_000, 1_000_000]);
  assert.ok(forecast.growthRate <= MAX_MONTHLY_GROWTH);
});

test("declining history projects a decline but never below zero", () => {
  const forecast = buildMetricForecast([1_000, 800, 600, 400, 200, 100]);
  assert.ok(forecast.growthRate < 0);
  assert.ok(forecast.project(12) >= 0);
  assert.ok(Number.isFinite(forecast.project(12)));
});

test("less than two months is insufficient, not a guess", () => {
  const none = buildMetricForecast([]);
  assert.equal(none.confidence.level, "insufficient");
  assert.equal(none.growthRate, 0);
  assert.equal(none.nextMonth, 0);
  assert.ok(none.confidence.reasons.length > 0);

  const one = buildMetricForecast([500]);
  assert.equal(one.confidence.level, "insufficient");
  assert.equal(one.growthRate, 0);
  // With one month the level is still that month — a flat carry-forward.
  assert.equal(one.nextMonth, 500);
});

test("two months is low confidence and extrapolates cautiously", () => {
  const forecast = buildMetricForecast([100, 200]);
  assert.equal(forecast.confidence.level, "low");
  // A 100% jump is damped to the low-confidence cap.
  assert.ok(forecast.growthRate <= 0.15);
});

test("three to five months is medium confidence", () => {
  const forecast = buildMetricForecast([100, 105, 110, 115]);
  assert.equal(forecast.confidence.level, "medium");
  assert.equal(forecast.confidence.monthsOfHistory, 4);
});

test("volatile history is downgraded even with plenty of months", () => {
  const steady = assessConfidence([100, 102, 104, 106, 108, 110], [0.02, 0.02, 0.02, 0.02, 0.02]);
  assert.equal(steady.level, "high");

  const volatile = buildMetricForecast([100, 400, 90, 500, 80, 450]);
  assert.notEqual(volatile.confidence.level, "high");
  assert.ok(volatile.confidence.volatility !== null && volatile.confidence.volatility > 0.3);
  assert.ok(volatile.confidence.reasons.some((r) => r.toLowerCase().includes("swing")));
});

test("gaps in the history lower confidence and are explained", () => {
  const gappy = buildMetricForecast([100, 0, 120, 0, 130, 140]);
  assert.notEqual(gappy.confidence.level, "high");
  assert.ok(gappy.confidence.reasons.some((r) => r.includes("no recorded activity")));
});

test("scenarios come from the business's own volatility", () => {
  const steady = buildMetricForecast([100, 102, 104, 106, 108, 110]);
  const volatile = buildMetricForecast([100, 160, 90, 170, 85, 165]);

  const steadySpread = steady.scenarioGrowth.aggressive - steady.scenarioGrowth.conservative;
  const volatileSpread = volatile.scenarioGrowth.aggressive - volatile.scenarioGrowth.conservative;

  // A jumpy business gets a wider band than a steady one.
  assert.ok(volatileSpread > steadySpread);
  assert.ok(steady.scenarioGrowth.conservative <= steady.scenarioGrowth.expected);
  assert.ok(steady.scenarioGrowth.expected <= steady.scenarioGrowth.aggressive);
});

test("scenario ordering holds in the projected values too", () => {
  const forecast = buildMetricForecast([100, 110, 120, 130, 140, 150]);
  const conservative = forecast.project(6, "conservative");
  const expected = forecast.project(6, "expected");
  const aggressive = forecast.project(6, "aggressive");
  assert.ok(conservative <= expected);
  assert.ok(expected <= aggressive);
});

test("projections across horizons are finite and non-negative", () => {
  const forecast = buildMetricForecast([100, 90, 80, 70, 60, 50]);
  for (const projection of projectHorizons(forecast, [1, 3, 6, 12])) {
    assert.ok(Number.isFinite(projection.value));
    assert.ok(projection.value >= 0);
  }
});

test("non-finite inputs are filtered out rather than poisoning the fit", () => {
  const forecast = buildMetricForecast([100, Number.NaN, 110, Number.POSITIVE_INFINITY, 120]);
  assert.ok(Number.isFinite(forecast.growthRate));
  assert.ok(Number.isFinite(forecast.nextMonth));
  assert.equal(forecast.history.length, 3);
});

test("run rate scales a part month without dividing by zero", () => {
  assert.equal(monthRunRate(150_000, 15, 30), 300_000);
  assert.equal(monthRunRate(150_000, 0, 30), null);
  assert.equal(monthRunRate(150_000, 15, 0), null);
  assert.equal(monthRunRate(Number.NaN, 15, 30), null);
});
