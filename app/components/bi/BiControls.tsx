"use client";

import type { AnalysisPeriodId, ForecastHorizonId } from "@/lib/bi/periods";
import { ANALYSIS_PERIOD_OPTIONS, FORECAST_HORIZON_OPTIONS } from "@/lib/bi/periods";
import { SCENARIO_LABELS, type ScenarioId } from "@/lib/bi/forecast";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

const SCENARIO_HINTS: Record<ScenarioId, string> = {
  conservative: "Growth one half-deviation below trend, from your own month-to-month volatility.",
  expected: "The trend itself — the default view.",
  aggressive: "Growth one half-deviation above trend, from your own month-to-month volatility.",
};

export type BiControlsValue = {
  periodId: AnalysisPeriodId;
  customStart: string;
  customEnd: string;
  horizon: ForecastHorizonId;
  scenario: ScenarioId;
};

export function BiControls({
  value,
  onChange,
  onRefresh,
  refreshing,
  periodDescription,
  invalidRange,
}: {
  value: BiControlsValue;
  onChange: (next: BiControlsValue) => void;
  onRefresh: () => void;
  refreshing: boolean;
  periodDescription: string | null;
  invalidRange: boolean;
}) {
  const set = (patch: Partial<BiControlsValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <fieldset className="min-w-0 flex-1">
          <legend className="text-sm font-semibold text-foreground">Analysis period</legend>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Drives margins, expenses, stock analysis and every ratio below.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ANALYSIS_PERIOD_OPTIONS.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={value.periodId === option.id ? "primary" : "outline"}
                aria-pressed={value.periodId === option.id}
                onClick={() => set({ periodId: option.id })}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </fieldset>

        <Button
          type="button"
          variant="outline"
          className="shrink-0 self-start"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {value.periodId === "custom" ? (
        <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bi-custom-start">From</Label>
            <Input
              id="bi-custom-start"
              type="date"
              value={value.customStart}
              onChange={(e) => set({ customStart: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bi-custom-end">To</Label>
            <Input
              id="bi-custom-end"
              type="date"
              value={value.customEnd}
              onChange={(e) => set({ customEnd: e.target.value })}
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-semibold text-foreground">Forecast horizon</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {FORECAST_HORIZON_OPTIONS.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={value.horizon === option.id ? "primary" : "outline"}
                aria-pressed={value.horizon === option.id}
                onClick={() => set({ horizon: option.id })}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-foreground">Scenario</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((id) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={value.scenario === id ? "primary" : "outline"}
                aria-pressed={value.scenario === id}
                onClick={() => set({ scenario: id })}
                title={SCENARIO_HINTS[id]}
              >
                {SCENARIO_LABELS[id]}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{SCENARIO_HINTS[value.scenario]}</p>
        </fieldset>
      </div>

      <p
        className={cn(
          "text-xs",
          invalidRange ? "font-medium text-destructive" : "text-muted-foreground",
        )}
      >
        {invalidRange
          ? "Select a valid date range — the start date must not be after the end date."
          : `Showing ${periodDescription ?? "—"}.`}
      </p>
    </div>
  );
}
