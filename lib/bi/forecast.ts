/**
 * The forecasting engine.
 *
 * Deliberately simple, inspectable arithmetic — no machine learning, no hidden
 * model. Every projection can be reproduced by hand from the numbers shown.
 *
 * Method, in order:
 *  1. Take completed calendar months only (a part-month would drag the trend down).
 *  2. Compute month-over-month growth rates.
 *  3. Take a *robust* growth rate: blend the median (resists one unusual month)
 *     with a recency-weighted mean (respects a real recent trend), then clamp it
 *     to a believable band.
 *  4. Compute the level by growing every historical month forward to "now" at that
 *     rate and taking a recency-weighted average — so the baseline is not simply
 *     the last month, which may itself be an outlier.
 *  5. Project forward: value(h) = level × (1 + g)^h.
 *  6. Derive scenarios from the business's own historical volatility, never from
 *     arbitrary multipliers.
 *
 * Confidence reflects how much history exists, how volatile it is, and whether
 * the history has gaps — not data quantity alone.
 */
import { clamp, median, stdDev } from "@/lib/bi/finance";

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";

export type ForecastConfidence = {
  level: ConfidenceLevel;
  label: string;
  /** Plain-language reasons, always populated — especially when confidence is low. */
  reasons: string[];
  monthsOfHistory: number;
  /** Coefficient of variation of month-over-month growth. Null with < 3 months. */
  volatility: number | null;
};

export type ScenarioId = "conservative" | "expected" | "aggressive";

export type ForecastProjection = {
  monthOffset: number;
  value: number;
};

export type MetricForecast = {
  /** Recency-weighted baseline for the *coming* month before growth is applied. */
  level: number;
  /** Monthly growth rate as a fraction, e.g. 0.13 for +13%. */
  growthRate: number;
  /** Growth rate per scenario. */
  scenarioGrowth: Record<ScenarioId, number>;
  confidence: ForecastConfidence;
  /** Projections 1..horizon months ahead for the selected scenario. */
  project: (monthsAhead: number, scenario?: ScenarioId) => number;
  /** Convenience: the next single month at the expected scenario. */
  nextMonth: number;
  /** Completed-month history the forecast was fitted on, oldest first. */
  history: number[];
};

/** Growth is clamped to ±40% a month — beyond that a wholesale trend is noise, not signal. */
export const MAX_MONTHLY_GROWTH = 0.4;
/** How many recent completed months the trend is fitted on. */
export const TREND_WINDOW_MONTHS = 6;

function monthOverMonthGrowth(history: readonly number[]): number[] {
  const rates: number[] = [];
  for (let i = 1; i < history.length; i += 1) {
    const previous = history[i - 1]!;
    const current = history[i]!;
    if (!Number.isFinite(previous) || previous <= 0) continue;
    rates.push((current - previous) / previous);
  }
  return rates;
}

/** Linear recency weights: the newest point counts n times the oldest. */
function recencyWeights(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

function weightedMean(values: readonly number[], weights: readonly number[]): number | null {
  if (values.length === 0 || values.length !== weights.length) return null;
  let total = 0;
  let weightSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    const w = weights[i]!;
    if (!Number.isFinite(v)) continue;
    total += v * w;
    weightSum += w;
  }
  return weightSum > 0 ? total / weightSum : null;
}

export function assessConfidence(history: readonly number[], growthRates: readonly number[]): ForecastConfidence {
  const monthsOfHistory = history.length;
  const reasons: string[] = [];

  // Growth rates are already normalised, so their standard deviation *is* the
  // volatility measure — no extra scaling by the mean level is needed.
  const growthSd = stdDev(growthRates);
  const volatility = growthSd !== null && Number.isFinite(growthSd) ? growthSd : null;

  const zeroMonths = history.filter((v) => !Number.isFinite(v) || v === 0).length;
  const gapShare = monthsOfHistory > 0 ? zeroMonths / monthsOfHistory : 1;
  // A month with nothing recorded is not history — a calendar full of empty
  // months must never read as a long, well-evidenced trend.
  const monthsWithActivity = monthsOfHistory - zeroMonths;

  if (monthsWithActivity < 2) {
    reasons.push(
      monthsWithActivity === 0
        ? "No completed month has any recorded activity yet — there is nothing to project from."
        : "Only one completed month has recorded activity. A single month cannot show a trend.",
    );
    return {
      level: "insufficient",
      label: "Insufficient data",
      reasons,
      monthsOfHistory: monthsWithActivity,
      volatility,
    };
  }

  let level: ConfidenceLevel;
  if (monthsWithActivity < 3) {
    level = "low";
    reasons.push(`Only ${monthsWithActivity} completed months of trading history — under 3 months the trend is fragile.`);
  } else if (monthsWithActivity < 6) {
    level = "medium";
    reasons.push(`${monthsWithActivity} completed months of trading history — enough for a direction, not a precise number.`);
  } else {
    level = "high";
    reasons.push(`${monthsWithActivity} completed months of trading history support the trend.`);
  }

  if (volatility !== null && volatility > 0.6) {
    reasons.push(
      `Month-to-month swings are large (growth varies by about ${(volatility * 100).toFixed(0)} percentage points), so the projection is wide.`,
    );
    level = level === "high" ? "medium" : "low";
  } else if (volatility !== null && volatility > 0.3) {
    reasons.push(`Moderate month-to-month variation (about ${(volatility * 100).toFixed(0)} points of swing).`);
    if (level === "high") level = "medium";
  } else if (volatility !== null) {
    reasons.push("Month-to-month performance has been steady.");
  }

  // One month in four with nothing recorded is enough to distrust the trend.
  if (gapShare >= 0.25) {
    reasons.push("Several months in the history have no recorded activity, so the history is incomplete.");
    level = level === "high" ? "medium" : "low";
  }

  const labels: Record<ConfidenceLevel, string> = {
    high: "High confidence",
    medium: "Medium confidence",
    low: "Low confidence",
    insufficient: "Insufficient data",
  };

  return { level, label: labels[level], reasons, monthsOfHistory: monthsWithActivity, volatility };
}

/**
 * Fit a forecast to a completed-month history (oldest first).
 * With no usable history at all, the forecast flatlines at zero and reports
 * `insufficient` confidence rather than inventing a trend.
 */
export function buildMetricForecast(historyInput: readonly number[]): MetricForecast {
  const finite = historyInput.filter((v) => Number.isFinite(v));
  // Months before the business had any activity are not a slow start — they are
  // simply not history, and must not drag the trend or the confidence rating.
  const firstActive = finite.findIndex((v) => v !== 0);
  const history = firstActive === -1 ? [] : finite.slice(firstActive);
  const window = history.slice(-TREND_WINDOW_MONTHS);
  const growthRates = monthOverMonthGrowth(window);
  const confidence = assessConfidence(window, growthRates);

  let growthRate = 0;
  if (growthRates.length >= 1) {
    const med = median(growthRates) ?? 0;
    const weighted = weightedMean(growthRates, recencyWeights(growthRates.length)) ?? med;
    // Median guards against one freak month; the weighted mean keeps a real
    // recent trend visible. An even blend of the two is the compromise.
    growthRate = clamp((med + weighted) / 2, -MAX_MONTHLY_GROWTH, MAX_MONTHLY_GROWTH);
  }
  // A fragile history should not extrapolate aggressively.
  if (confidence.level === "low") growthRate = clamp(growthRate, -0.15, 0.15);
  if (confidence.level === "insufficient") growthRate = 0;

  let level = 0;
  if (window.length > 0) {
    // Grow each past month forward to the latest month, then weight by recency.
    const lastIndex = window.length - 1;
    const detrended = window.map((v, i) => v * (1 + growthRate) ** (lastIndex - i));
    level = weightedMean(detrended, recencyWeights(window.length)) ?? window[lastIndex]!;
  }
  if (!Number.isFinite(level) || level < 0) level = 0;

  const spread = deriveScenarioSpread(growthRates, confidence);
  const scenarioGrowth: Record<ScenarioId, number> = {
    conservative: clamp(growthRate - spread, -MAX_MONTHLY_GROWTH, MAX_MONTHLY_GROWTH),
    expected: growthRate,
    aggressive: clamp(growthRate + spread, -MAX_MONTHLY_GROWTH, MAX_MONTHLY_GROWTH),
  };

  const project = (monthsAhead: number, scenario: ScenarioId = "expected"): number => {
    const horizon = Number.isFinite(monthsAhead) ? Math.max(0, monthsAhead) : 0;
    const rate = scenarioGrowth[scenario];
    const value = level * (1 + rate) ** horizon;
    return Number.isFinite(value) && value > 0 ? value : 0;
  };

  return {
    level,
    growthRate,
    scenarioGrowth,
    confidence,
    project,
    nextMonth: project(1, "expected"),
    history: window,
  };
}

/**
 * Scenario spread comes from the business's own volatility. When there is not
 * enough history to measure volatility, a documented ±8%/month band is used and
 * the confidence report already says why the projection is weak.
 */
function deriveScenarioSpread(
  growthRates: readonly number[],
  confidence: ForecastConfidence,
): number {
  const sd = stdDev(growthRates);
  if (sd === null || !Number.isFinite(sd)) {
    return confidence.level === "insufficient" ? 0 : 0.08;
  }
  // Half a standard deviation each way keeps the band inside observed behaviour.
  return clamp(sd / 2, 0.02, 0.25);
}

/** Project a metric across the standard 1/3/6/12-month grid. */
export function projectHorizons(
  forecast: MetricForecast,
  horizons: readonly number[],
  scenario: ScenarioId = "expected",
): ForecastProjection[] {
  return horizons.map((h) => ({ monthOffset: h, value: forecast.project(h, scenario) }));
}

/**
 * Run-rate for a part-month: what the month lands on if the current daily pace holds.
 * Returns null when no days have elapsed.
 */
export function monthRunRate(valueSoFar: number, daysElapsed: number, daysInMonth: number): number | null {
  if (!Number.isFinite(valueSoFar)) return null;
  if (!Number.isFinite(daysElapsed) || daysElapsed <= 0) return null;
  if (!Number.isFinite(daysInMonth) || daysInMonth <= 0) return null;
  return (valueSoFar / daysElapsed) * daysInMonth;
}

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  conservative: "Conservative",
  expected: "Expected",
  aggressive: "Aggressive",
};
