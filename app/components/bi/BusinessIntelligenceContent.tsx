"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { loadBusinessDataset } from "@/lib/bi/loadDataset";
import type { BusinessDataset } from "@/lib/bi/dataset";
import { analyzeBusiness } from "@/lib/bi/analyze";
import { resolveAnalysisPeriod } from "@/lib/bi/periods";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { BiControls, type BiControlsValue } from "@/app/components/bi/BiControls";
import { ExecutiveForecastSection } from "@/app/components/bi/ExecutiveForecastSection";
import { ReinvestmentSection } from "@/app/components/bi/ReinvestmentSection";
import { WorkingCapitalSection } from "@/app/components/bi/WorkingCapitalSection";
import { InventorySection } from "@/app/components/bi/InventorySection";
import { ProfitabilitySection } from "@/app/components/bi/ProfitabilitySection";
import { CashFlowSection } from "@/app/components/bi/CashFlowSection";
import { PartnersSection } from "@/app/components/bi/PartnersSection";
import { TargetsSection } from "@/app/components/bi/TargetsSection";
import { GrowthChartsSection } from "@/app/components/bi/GrowthChartsSection";
import { InsightsSection } from "@/app/components/bi/InsightsSection";
import { MonthComparisonSection } from "@/app/components/bi/MonthComparisonSection";
import { GlossarySection } from "@/app/components/bi/GlossarySection";

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <p className="text-sm text-muted-foreground">Loading your business data…</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((k) => (
          <div key={k} className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">…</p>
            <p className="mt-2 text-sm text-muted-foreground">Calculating…</p>
          </div>
        ))}
      </div>
      {[1, 2, 3].map((k) => (
        <div key={k} className="rounded-xl border border-border bg-surface p-5 shadow-card">
          <p className="text-sm text-muted-foreground">Calculating…</p>
        </div>
      ))}
    </div>
  );
}

export function BusinessIntelligenceContent() {
  const today = useMemo(() => new Date(), []);
  const [controls, setControls] = useState<BiControlsValue>(() => ({
    periodId: "last_3_months",
    customStart: toDateInputValue(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
    customEnd: toDateInputValue(today),
    horizon: "6",
    scenario: "expected",
  }));

  const [dataset, setDataset] = useState<BusinessDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setDataset(await loadBusinessDataset(getDb(), new Date()));
    } catch (e) {
      setError(getFirestoreUserMessage(e));
      setDataset(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Period resolution is cheap and independent of the dataset, so it can be
  // validated before any analysis runs.
  const period = useMemo(
    () =>
      resolveAnalysisPeriod(controls.periodId, dataset?.now ?? today, {
        startInput: controls.customStart,
        endInput: controls.customEnd,
      }),
    [controls.customEnd, controls.customStart, controls.periodId, dataset?.now, today],
  );

  // The whole report is derived in one memoised pass — changing a control
  // recomputes in memory without touching Firestore again.
  const report = useMemo(() => {
    if (!dataset || !period) return null;
    return analyzeBusiness(dataset, {
      period,
      horizon: controls.horizon,
      scenario: controls.scenario,
    });
  }, [controls.horizon, controls.scenario, dataset, period]);

  const hasAnyActivity =
    !!report && (report.series.monthsWithActivity > 0 || report.products.products.length > 0);

  return (
    <div className="space-y-8">
      <BiControls
        value={controls}
        onChange={setControls}
        onRefresh={() => void load(true)}
        refreshing={refreshing}
        periodDescription={period ? `${period.label.toLowerCase()} — ${period.description}` : null}
        invalidRange={!period}
      />

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      {loading ? <LoadingSkeleton /> : null}

      {!loading && !error && !period ? (
        <InlineAlert variant="warning">
          Select a valid date range to run the analysis.
        </InlineAlert>
      ) : null}

      {!loading && !error && report && !hasAnyActivity ? (
        <InlineAlert variant="info">
          No products, sales, expenses or stock receipts are recorded yet. Business Intelligence
          fills in as soon as TradeBridge has trading history to read — nothing here is simulated.
        </InlineAlert>
      ) : null}

      {!loading && !error && report && hasAnyActivity ? (
        <div className="space-y-12">
          <ExecutiveForecastSection report={report} />
          <ReinvestmentSection report={report} />
          <WorkingCapitalSection report={report} />
          <InventorySection report={report} />
          <ProfitabilitySection report={report} />
          <CashFlowSection report={report} />
          <PartnersSection report={report} />
          <TargetsSection report={report} />
          <GrowthChartsSection report={report} />
          <InsightsSection report={report} />
          <MonthComparisonSection report={report} />
          <GlossarySection />
        </div>
      ) : null}
    </div>
  );
}
