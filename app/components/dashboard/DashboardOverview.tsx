"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { loadStockSummary, type StockSummaryData } from "@/lib/inventory/stockSummary";
import { loadProfitForPeriod } from "@/lib/profit/loadPeriod";
import {
  getBoundsFromDateInputs,
  getCurrentMonthBounds,
  getCurrentYearBounds,
  getTodayBounds,
  parseLocalDateInput,
} from "@/lib/profit/periods";
import type { ProfitBreakdown } from "@/lib/profit/metrics";
import { loadCashInHandSnapshot, type CashInHandSnapshot } from "@/lib/finance/loadCashInHand";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { PeriodKpiRow } from "@/app/components/dashboard/PeriodKpiRow";
import { SalesDrilldownModal } from "@/app/components/dashboard/SalesDrilldownModal";
import { ProfitBreakdownCard } from "@/app/components/dashboard/ProfitBreakdownCard";
import { StockSummary } from "@/app/components/dashboard/StockSummary";
import { CashInHandCard } from "@/app/components/dashboard/CashInHandCard";
import { CashInHandStatCard } from "@/app/components/dashboard/CashInHandStatCard";
import { CashEntryForm } from "@/app/components/dashboard/CashEntryForm";
import { CashEntryLedgerTable } from "@/app/components/dashboard/CashEntryLedgerTable";
import { TotalAssetsCard } from "@/app/components/dashboard/TotalAssetsCard";
import { DashboardSecondaryStatRow } from "@/app/components/dashboard/DashboardSecondaryStatRow";
import { ExpectedCashCards } from "@/app/components/dashboard/ExpectedCashCards";
import { Input } from "@/app/components/ui/Input";

type KpiPreset = "today" | "day" | "month" | "year" | "custom";

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function DashboardOverview() {
  const initialNow = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<KpiPreset>("today");
  const [singleDayDate, setSingleDayDate] = useState(() => toDateInputValue(initialNow));
  const [customStartDate, setCustomStartDate] = useState(() => toDateInputValue(initialNow));
  const [customEndDate, setCustomEndDate] = useState(() => toDateInputValue(initialNow));
  const [selected, setSelected] = useState<ProfitBreakdown | null>(null);
  const [stock, setStock] = useState<StockSummaryData | null>(null);
  const [cashSnapshot, setCashSnapshot] = useState<CashInHandSnapshot | null>(null);
  const [cashLoading, setCashLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [salesDrillOpen, setSalesDrillOpen] = useState(false);

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
    if (preset === "day") {
      const bounds = getBoundsFromDateInputs(singleDayDate, singleDayDate);
      const parsed = parseLocalDateInput(singleDayDate);
      return {
        label: "One day",
        description: parsed
          ? parsed.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : singleDayDate,
        bounds,
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
  }, [customEndDate, customStartDate, preset, singleDayDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const db = getDb();

    setCashLoading(true);
    try {
      setCashSnapshot(await loadCashInHandSnapshot(db));
    } catch {
      setCashSnapshot(null);
    } finally {
      setCashLoading(false);
    }

    if (!selectedRange.bounds) {
      setError("Select a valid date or date range.");
      setSelected(null);
      setStock(null);
      setLoading(false);
      return;
    }

    try {
      const [periodSummary, s] = await Promise.all([
        loadProfitForPeriod(db, selectedRange.bounds.start, selectedRange.bounds.end),
        loadStockSummary(db),
      ]);
      setSelected(periodSummary);
      setStock(s);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
      setSelected(null);
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
          sold). Choose preset, one calendar day, or a custom range to view period totals. Inventory
          value is current product cost × units on hand.
          Cash in hand is an all-time estimate from recorded flows; set opening cash if you started
          mid-stream.
        </p>
        <Button type="button" variant="outline" className="shrink-0" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      <div className="space-y-4">
      {!error ? (
        <section aria-labelledby="selected-kpis-heading">
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
                variant={preset === "day" ? "primary" : "outline"}
                onClick={() => setPreset("day")}
              >
                One day
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
            {preset === "day" ? (
              <Input
                type="date"
                value={singleDayDate}
                onChange={(e) => setSingleDayDate(e.target.value)}
                aria-label="Date for one-day KPIs"
              />
            ) : null}
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
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-4" aria-label="Period KPIs and cash in hand">
        {!error ? (
          <div className="lg:col-span-3">
            <PeriodKpiRow
              breakdown={selected}
              loading={loading}
              salesLabel={`Total sales (${selectedRange.label.toLowerCase()})`}
              expensesLabel={`Total expenses (${selectedRange.label.toLowerCase()})`}
              profitLabel={`Profit (${selectedRange.label.toLowerCase()})`}
              onSalesClick={() => setSalesDrillOpen(true)}
            />
          </div>
        ) : null}
        <div className={error ? "lg:col-span-4" : "lg:col-span-1"}>
          <CashInHandStatCard
            snapshot={cashSnapshot}
            loading={cashLoading}
            className="h-full lg:min-h-full"
          />
        </div>
      </div>

      {!error && selectedRange.bounds ? (
        <SalesDrilldownModal
          open={salesDrillOpen}
          onClose={() => setSalesDrillOpen(false)}
          start={selectedRange.bounds.start}
          end={selectedRange.bounds.end}
          periodTitle={`${selectedRange.label}: ${selectedRange.description}`}
          kpiTotalSales={selected?.totalSales ?? 0}
        />
      ) : null}

      <DashboardSecondaryStatRow
        cashSnapshot={cashSnapshot}
        cashLoading={cashLoading}
        stock={stock}
        stockLoading={loading}
      />
      </div>

      <ExpectedCashCards
        snapshot={cashSnapshot}
        loading={cashLoading}
        onSaved={() => void load()}
      />

      <CashInHandCard
        snapshot={cashSnapshot}
        loading={cashLoading}
        onSaved={() => void load()}
      />

      <section aria-labelledby="cash-entry-ledger-heading" className="space-y-4">
        <div>
          <h2 id="cash-entry-ledger-heading" className="text-base font-semibold text-foreground">
            Cash entry ledger
          </h2>
          <p className="text-sm text-muted-foreground">
            Add or remove manual cash entries (such as owner investment or withdrawals). These
            entries are included in cash-in-hand calculations.
          </p>
        </div>
        <CashEntryForm onCreated={() => load()} />
        <CashEntryLedgerTable onChanged={() => load()} />
      </section>

      <TotalAssetsCard
        cashSnapshot={cashSnapshot}
        cashLoading={cashLoading}
        stock={stock}
        stockLoading={loading}
      />

      {!error ? (
        <>
          <StockSummary data={stock} loading={loading} />

          <ProfitBreakdownCard
            title={`${selectedRange.label} profit`}
            description="Sales minus expenses and COGS for selected period (local time)."
            breakdown={selected}
            loading={loading}
          />
        </>
      ) : null}
    </div>
  );
}
