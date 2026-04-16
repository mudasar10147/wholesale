"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  loadPartnerLoanSummaryAllTime,
  loadPartnerLoanSummaryForPeriod,
} from "@/lib/finance/loadPartnerLoansPeriod";
import type { PartnerLoanSummary } from "@/lib/finance/partnerLoans";
import { loadStockSummary, type StockSummaryData } from "@/lib/inventory/stockSummary";
import { loadProfitForPeriod } from "@/lib/profit/loadPeriod";
import {
  getBoundsFromDateInputs,
  getCurrentMonthBounds,
  getCurrentYearBounds,
  getTodayBounds,
} from "@/lib/profit/periods";
import type { ProfitBreakdown } from "@/lib/profit/metrics";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { PartnerLoanSummaryCard } from "@/app/components/dashboard/PartnerLoanSummaryCard";
import { PeriodKpiRow } from "@/app/components/dashboard/PeriodKpiRow";
import { ProfitBreakdownCard } from "@/app/components/dashboard/ProfitBreakdownCard";
import { StockSummary } from "@/app/components/dashboard/StockSummary";
import { Input } from "@/app/components/ui/Input";

type KpiPreset = "today" | "month" | "year" | "custom";

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function DashboardOverview() {
  const initialNow = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<KpiPreset>("today");
  const [customStartDate, setCustomStartDate] = useState(() => toDateInputValue(initialNow));
  const [customEndDate, setCustomEndDate] = useState(() => toDateInputValue(initialNow));
  const [selected, setSelected] = useState<ProfitBreakdown | null>(null);
  const [loanAllTime, setLoanAllTime] = useState<PartnerLoanSummary | null>(null);
  const [loanMonthly, setLoanMonthly] = useState<PartnerLoanSummary | null>(null);
  const [stock, setStock] = useState<StockSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedRange = useMemo(() => {
    const current = new Date();
    if (preset === "today") {
      return {
        label: "Today",
        description: current.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        bounds: getTodayBounds(current),
      };
    }
    if (preset === "month") {
      const bounds = getCurrentMonthBounds(current);
      return {
        label: "This month",
        description: current.toLocaleString(undefined, { month: "long", year: "numeric" }),
        bounds,
      };
    }
    if (preset === "year") {
      return {
        label: "This year",
        description: String(current.getFullYear()),
        bounds: getCurrentYearBounds(current),
      };
    }

    const bounds = getBoundsFromDateInputs(customStartDate, customEndDate);
    return {
      label: "Custom range",
      description: `${customStartDate} to ${customEndDate}`,
      bounds,
    };
  }, [customEndDate, customStartDate, preset]);

  const load = useCallback(async () => {
    if (!selectedRange.bounds) {
      setError("Select a valid custom date range.");
      setSelected(null);
      setStock(null);
      setLoanAllTime(null);
      setLoanMonthly(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const db = getDb();
      const month = getCurrentMonthBounds(new Date());
      const [periodSummary, s, loanAll, loanMonth] = await Promise.all([
        loadProfitForPeriod(db, selectedRange.bounds.start, selectedRange.bounds.end),
        loadStockSummary(db),
        loadPartnerLoanSummaryAllTime(db),
        loadPartnerLoanSummaryForPeriod(db, month.start, month.end),
      ]);
      setSelected(periodSummary);
      setStock(s);
      setLoanAllTime(loanAll);
      setLoanMonthly(loanMonth);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
      setSelected(null);
      setLoanAllTime(null);
      setLoanMonthly(null);
      setStock(null);
    } finally {
      setLoading(false);
    }
  }, [selectedRange.bounds]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          KPIs use sales and expenses in local time. Profit subtracts COGS (cost_price × quantity
          sold). Choose preset or custom dates to view period totals. Inventory value is
          current product cost × units on hand. Partner loans are tracked separately from profit.
        </p>
        <Button type="button" variant="outline" className="shrink-0" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      {!error ? (
        <>
          <section aria-labelledby="selected-kpis-heading" className="space-y-4">
            <div className="flex flex-col gap-3">
              <h2 id="selected-kpis-heading" className="text-base font-semibold text-foreground">
                KPI period
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={preset === "today" ? "primary" : "outline"}
                  onClick={() => setPreset("today")}
                >
                  Today
                </Button>
                <Button
                  type="button"
                  variant={preset === "month" ? "primary" : "outline"}
                  onClick={() => setPreset("month")}
                >
                  This month
                </Button>
                <Button
                  type="button"
                  variant={preset === "year" ? "primary" : "outline"}
                  onClick={() => setPreset("year")}
                >
                  This year
                </Button>
                <Button
                  type="button"
                  variant={preset === "custom" ? "primary" : "outline"}
                  onClick={() => setPreset("custom")}
                >
                  Custom range
                </Button>
              </div>
              {preset === "custom" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    aria-label="Custom range start date"
                  />
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    aria-label="Custom range end date"
                  />
                </div>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Showing {selectedRange.label.toLowerCase()}: {selectedRange.description}
              </p>
            </div>
            <PeriodKpiRow
              breakdown={selected}
              loading={loading}
              salesLabel={`Total sales (${selectedRange.label.toLowerCase()})`}
              expensesLabel={`Total expenses (${selectedRange.label.toLowerCase()})`}
              profitLabel={`Profit (${selectedRange.label.toLowerCase()})`}
            />
          </section>

          <StockSummary data={stock} loading={loading} />

          <ProfitBreakdownCard
            title={`${selectedRange.label} profit`}
            description="Sales minus expenses and COGS for selected period (local time)."
            breakdown={selected}
            loading={loading}
          />
          <section aria-labelledby="partner-loan-heading" className="space-y-3">
            <div>
              <h2 id="partner-loan-heading" className="text-base font-semibold text-foreground">
                Partner loans
              </h2>
              <p className="text-sm text-muted-foreground">
                Liability tracking only. Loan entries are excluded from profit.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <PartnerLoanSummaryCard
                title="Pending loan (all time)"
                description="Company amount still owed to partners."
                summary={loanAllTime}
                loading={loading}
              />
              <PartnerLoanSummaryCard
                title="Partner loan activity this month"
                description="Borrowed/repaid movements during this calendar month."
                summary={loanMonthly}
                loading={loading}
              />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
