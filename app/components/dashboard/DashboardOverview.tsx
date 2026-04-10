"use client";

import { useCallback, useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { loadStockSummary, type StockSummaryData } from "@/lib/inventory/stockSummary";
import { loadProfitForPeriod } from "@/lib/profit/loadPeriod";
import {
  getCurrentMonthBounds,
  getCurrentYearBounds,
  getTodayBounds,
} from "@/lib/profit/periods";
import type { ProfitBreakdown } from "@/lib/profit/metrics";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { PeriodKpiRow } from "@/app/components/dashboard/PeriodKpiRow";
import { ProfitBreakdownCard } from "@/app/components/dashboard/ProfitBreakdownCard";
import { StockSummary } from "@/app/components/dashboard/StockSummary";
import { TodayKpiRow } from "@/app/components/dashboard/TodayKpiRow";

export function DashboardOverview() {
  const [today, setToday] = useState<ProfitBreakdown | null>(null);
  const [monthly, setMonthly] = useState<ProfitBreakdown | null>(null);
  const [yearly, setYearly] = useState<ProfitBreakdown | null>(null);
  const [stock, setStock] = useState<StockSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const db = getDb();
      const now = new Date();
      const day = getTodayBounds(now);
      const month = getCurrentMonthBounds(now);
      const year = getCurrentYearBounds(now);
      const [t, m, y, s] = await Promise.all([
        loadProfitForPeriod(db, day.start, day.end),
        loadProfitForPeriod(db, month.start, month.end),
        loadProfitForPeriod(db, year.start, year.end),
        loadStockSummary(db),
      ]);
      setToday(t);
      setMonthly(m);
      setYearly(y);
      setStock(s);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
      setToday(null);
      setMonthly(null);
      setYearly(null);
      setStock(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const monthYearLabel = new Date().toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  const calendarYear = new Date().getFullYear();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          KPIs use sales and expenses in local time. Profit subtracts COGS (cost_price × quantity
          sold). This month and this calendar year include all days in range. Inventory value is
          current product cost × units on hand.
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

          <section aria-labelledby="month-kpis-heading" className="space-y-3">
            <div>
              <h2 id="month-kpis-heading" className="text-base font-semibold text-foreground">
                This month
              </h2>
              <p className="text-sm text-muted-foreground">{monthYearLabel}</p>
            </div>
            <PeriodKpiRow
              breakdown={monthly}
              loading={loading}
              salesLabel="Total sales this month"
              expensesLabel="Total expenses this month"
              profitLabel="Profit this month"
            />
          </section>

          <section aria-labelledby="year-kpis-heading" className="space-y-3">
            <div>
              <h2 id="year-kpis-heading" className="text-base font-semibold text-foreground">
                This calendar year
              </h2>
              <p className="text-sm text-muted-foreground">{calendarYear}</p>
            </div>
            <PeriodKpiRow
              breakdown={yearly}
              loading={loading}
              salesLabel="Total sales this year"
              expensesLabel="Total expenses this year"
              profitLabel="Profit this year"
            />
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
