"use client";

/**
 * Lightweight inline-SVG charts.
 *
 * No chart library is installed in TradeBridge and none is added for this page —
 * these are a few hundred lines of plain SVG that scale with the container, use
 * the app's own CSS colour tokens, and stay legible on a phone.
 *
 * Historical points are drawn solid; projected points are drawn dashed and
 * hollow, so a forecast can never be mistaken for a recorded number.
 */

import { useId } from "react";
import { formatPkrCompactWhole } from "@/lib/bi/format";
import { cn } from "@/lib/utils";

export type SeriesPoint = {
  label: string;
  value: number;
  /** True for projected points — drawn dashed. */
  forecast?: boolean;
};

export type ChartSeries = {
  name: string;
  color: string;
  points: SeriesPoint[];
};

const CHART_COLORS = {
  primary: "var(--primary)",
  success: "var(--success)",
  accent: "var(--accent)",
  destructive: "var(--destructive)",
  muted: "var(--muted)",
} as const;

export type ChartColorName = keyof typeof CHART_COLORS;

export function chartColor(name: ChartColorName): string {
  return CHART_COLORS[name];
}

function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function compactMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(1)}Cr`;
  if (abs >= 100_000) return `${sign}${(abs / 100_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

/* ── Line / area trend chart ──────────────────────────────────────────── */

export function TrendChart({
  series,
  height = 220,
  ariaLabel,
  valueFormatter = formatPkrCompactWhole,
  className,
}: {
  series: ChartSeries[];
  height?: number;
  ariaLabel: string;
  valueFormatter?: (n: number) => string;
  className?: string;
}) {
  const gradientId = useId();
  const width = 720;
  const padding = { top: 16, right: 12, bottom: 34, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const maxValue = niceCeiling(Math.max(0, ...allValues));
  const minValue = Math.min(0, ...allValues);
  const minBound = minValue < 0 ? -niceCeiling(Math.abs(minValue)) : 0;
  const span = maxValue - minBound || 1;
  const count = Math.max(1, labels.length);

  const x = (i: number) => padding.left + (count === 1 ? plotWidth / 2 : (i / (count - 1)) * plotWidth);
  const y = (v: number) => padding.top + plotHeight - ((v - minBound) / span) * plotHeight;

  if (labels.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface-muted px-4 py-8 text-center text-sm text-muted-foreground">
        No data to chart yet.
      </p>
    );
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  // Keep the x-axis readable on narrow screens by thinning the labels.
  const labelStep = Math.max(1, Math.ceil(count / 7));

  return (
    <figure className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {series.map((s, si) => (
            <linearGradient key={s.name} id={`${gradientId}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {gridLines.map((g) => {
          const value = minBound + span * (1 - g);
          const yy = padding.top + plotHeight * g;
          return (
            <g key={g}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yy}
                y2={yy}
                stroke="var(--border)"
                strokeWidth="1"
              />
              <text
                x={padding.left - 8}
                y={yy + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--muted-foreground)"
              >
                {compactMoney(value)}
              </text>
            </g>
          );
        })}

        {series.map((s, si) => {
          const historical = s.points.filter((p) => !p.forecast);
          const historicalCount = historical.length;
          const historicalPath = historical
            .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`)
            .join(" ");
          // The forecast path starts at the last historical point so the line joins up.
          const forecastStart = Math.max(0, historicalCount - 1);
          const forecastPoints = s.points.slice(forecastStart);
          const forecastPath = forecastPoints
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${x(forecastStart + i).toFixed(2)},${y(p.value).toFixed(2)}`,
            )
            .join(" ");

          const areaPath =
            historicalCount > 1
              ? `${historicalPath} L${x(historicalCount - 1).toFixed(2)},${y(minBound).toFixed(2)} L${x(0).toFixed(2)},${y(minBound).toFixed(2)} Z`
              : "";

          return (
            <g key={s.name}>
              {areaPath ? <path d={areaPath} fill={`url(#${gradientId}-${si})`} /> : null}
              {historicalCount > 1 ? (
                <path d={historicalPath} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              ) : null}
              {forecastPoints.length > 1 ? (
                <path
                  d={forecastPath}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.5"
                  strokeDasharray="6 5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.85"
                />
              ) : null}
              {s.points.map((p, i) => (
                <circle
                  key={`${s.name}-${p.label}-${i}`}
                  cx={x(i)}
                  cy={y(p.value)}
                  r={p.forecast ? 3.5 : 3}
                  fill={p.forecast ? "var(--surface)" : s.color}
                  stroke={s.color}
                  strokeWidth={p.forecast ? 2 : 1}
                >
                  <title>{`${s.name} · ${p.label}${p.forecast ? " (projected)" : ""}: ${valueFormatter(p.value)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {labels.map((label, i) =>
          i % labelStep === 0 || i === count - 1 ? (
            <text
              key={`${label}-${i}`}
              x={x(i)}
              y={height - 12}
              textAnchor="middle"
              fontSize="11"
              fill="var(--muted-foreground)"
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>
      <ChartLegend series={series} hasForecast={series.some((s) => s.points.some((p) => p.forecast))} />
    </figure>
  );
}

/* ── Grouped bar chart ────────────────────────────────────────────────── */

export function GroupedBarChart({
  series,
  height = 220,
  ariaLabel,
  valueFormatter = formatPkrCompactWhole,
  className,
}: {
  series: ChartSeries[];
  height?: number;
  ariaLabel: string;
  valueFormatter?: (n: number) => string;
  className?: string;
}) {
  const width = 720;
  const padding = { top: 16, right: 12, bottom: 34, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const maxValue = niceCeiling(Math.max(0, ...allValues));
  const minValue = Math.min(0, ...allValues);
  const minBound = minValue < 0 ? -niceCeiling(Math.abs(minValue)) : 0;
  const span = maxValue - minBound || 1;
  const groups = Math.max(1, labels.length);

  if (labels.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface-muted px-4 py-8 text-center text-sm text-muted-foreground">
        No data to chart yet.
      </p>
    );
  }

  const groupWidth = plotWidth / groups;
  const barGap = 3;
  const barWidth = Math.max(4, (groupWidth * 0.68 - barGap * (series.length - 1)) / series.length);
  const y = (v: number) => padding.top + plotHeight - ((v - minBound) / span) * plotHeight;
  const zeroY = y(0);
  const labelStep = Math.max(1, Math.ceil(groups / 7));

  return (
    <figure className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((g) => {
          const value = minBound + span * (1 - g);
          const yy = padding.top + plotHeight * g;
          return (
            <g key={g}>
              <line x1={padding.left} x2={width - padding.right} y1={yy} y2={yy} stroke="var(--border)" strokeWidth="1" />
              <text x={padding.left - 8} y={yy + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">
                {compactMoney(value)}
              </text>
            </g>
          );
        })}

        {labels.map((label, gi) => {
          const groupStart =
            padding.left + gi * groupWidth + (groupWidth - (barWidth * series.length + barGap * (series.length - 1))) / 2;
          return (
            <g key={`${label}-${gi}`}>
              {series.map((s, si) => {
                const point = s.points[gi];
                if (!point) return null;
                const barX = groupStart + si * (barWidth + barGap);
                const barY = point.value >= 0 ? y(point.value) : zeroY;
                const barHeight = Math.max(1, Math.abs(zeroY - y(point.value)));
                return (
                  <rect
                    key={`${s.name}-${gi}`}
                    x={barX}
                    y={barY}
                    width={barWidth}
                    height={barHeight}
                    rx="2"
                    fill={s.color}
                    opacity={point.forecast ? 0.45 : 0.9}
                    stroke={point.forecast ? s.color : "none"}
                    strokeDasharray={point.forecast ? "3 2" : undefined}
                  >
                    <title>{`${s.name} · ${point.label}${point.forecast ? " (projected)" : ""}: ${valueFormatter(point.value)}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}

        <line x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" strokeWidth="1" />

        {labels.map((label, i) =>
          i % labelStep === 0 || i === groups - 1 ? (
            <text
              key={`x-${label}-${i}`}
              x={padding.left + i * groupWidth + groupWidth / 2}
              y={height - 12}
              textAnchor="middle"
              fontSize="11"
              fill="var(--muted-foreground)"
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>
      <ChartLegend series={series} hasForecast={series.some((s) => s.points.some((p) => p.forecast))} />
    </figure>
  );
}

/* ── Horizontal comparison bars ───────────────────────────────────────── */

export function ComparisonBars({
  rows,
  ariaLabel,
  formatValue = formatPkrCompactWhole,
}: {
  rows: { label: string; value: number; color: string; note?: string }[];
  ariaLabel: string;
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-3" aria-label={ariaLabel}>
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
            <span className="font-medium text-foreground">{row.label}</span>
            <span className="tabular-nums text-foreground">{formatValue(row.value)}</span>
          </div>
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full transition-[width] duration-[var(--duration-normal)]"
              style={{
                width: `${Math.min(100, (Math.abs(row.value) / max) * 100)}%`,
                backgroundColor: row.color,
              }}
            />
          </div>
          {row.note ? <p className="mt-1 text-xs text-muted-foreground">{row.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/* ── Legend ───────────────────────────────────────────────────────────── */

function ChartLegend({ series, hasForecast }: { series: ChartSeries[]; hasForecast: boolean }) {
  return (
    <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          {s.name}
        </span>
      ))}
      {hasForecast ? (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0 w-4 border-t-2 border-dashed border-muted-foreground" />
          Dashed / hollow = projected
        </span>
      ) : null}
    </figcaption>
  );
}
