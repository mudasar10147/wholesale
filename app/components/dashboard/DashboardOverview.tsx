"use client";

import { useCallback, useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { loadStockSummary, type StockSummaryData } from "@/lib/inventory/stockSummary";
import { loadProfitForPeriod } from "@/lib/profit/loadPeriod";
import { getCurrentMonthBounds, getTodayBounds } from "@/lib/profit/periods";
import type { ProfitBreakdown } from "@/lib/profit/metrics";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { ProfitBreakdownCard } from "@/app/components/dashboard/ProfitBreakdownCard";
import { StockSummary } from "@/app/components/dashboard/StockSummary";
import { TodayKpiRow } from "@/app/components/dashboard/TodayKpiRow";

export function DashboardOverview() {
  const [today, setToday] = useState<ProfitBreakdown | null>(null);
  const [monthly, setMonthly] = useState<ProfitBreakdown | null>(null);
  const [stock, setStock] = useState<StockSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const db = getDb();
      const day = getTodayBounds();
      const month = getCurrentMonthBounds();
      const [t, m, s] = await Promise.all([
        loadProfitForPeriod(db, day.start, day.end),
        loadProfitForPeriod(db, month.start, month.end),
        loadStockSummary(db),
      ]);
      setToday(t);
      setMonthly(m);
      setStock(s);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
      setToday(null);
      setMonthly(null);
      setStock(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Today&apos;s KPIs use sales and expenses through end of day (local time). Profit subtracts
          COGS (cost_price × quantity sold). Monthly block is the full calendar month.
        </p>
        <Button type="button" variant="outline" className="shrink-0" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      {!error ? (
        <>
          <section aria-labelledby="today-kpis-heading">
            <h2 id="today-kpis-heading" className="sr-only">
              Today overview
            </h2>
            <TodayKpiRow today={today} loading={loading} />
          </section>

          <StockSummary data={stock} loading={loading} />

          <ProfitBreakdownCard
            title="Monthly profit"
            description="Current calendar month (local time), including COGS."
            breakdown={monthly}
            loading={loading}
          />
        </>
      ) : null}
    </div>
  );
}
