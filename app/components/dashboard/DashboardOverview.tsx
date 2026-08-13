"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  computeCashSnapshot,
  computeDashboard,
  type DashboardRaw,
} from "@/lib/dashboard/dashboardData";
import { getDashboardRaw } from "@/lib/dashboard/dashboardCache";
import {
  getBoundsFromDateInputs,
  getCurrentMonthBounds,
  getCurrentYearBounds,
  getTodayBounds,
  parseLocalDateInput,
} from "@/lib/profit/periods";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { PeriodKpiRow } from "@/app/components/dashboard/PeriodKpiRow";
import { SalesDrilldownModal } from "@/app/components/dashboard/SalesDrilldownModal";
import { CashInHandStatCard } from "@/app/components/dashboard/CashInHandStatCard";
import { DashboardExtendedKpiGrid } from "@/app/components/dashboard/DashboardExtendedKpiGrid";
import { Input } from "@/app/components/ui/Input";

type KpiPreset = "today" | "day" | "month" | "year" | "custom";

function RefreshIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.72-4" />
      <path d="M13.75 2.5v3.5h-3.5" />
    </svg>
  );
}

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
  const [raw, setRaw] = useState<DashboardRaw | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
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

  /**
   * Fetches only when the session cache has nothing fresh. Note the empty
   * dependency list: changing the KPI period recomputes from documents already
   * held rather than refetching, so preset clicks cost no reads.
   */
  const load = useCallback(async (force = false) => {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await getDashboardRaw(getDb(), { force });
      setRaw(result.raw);
      setFetchedAt(result.fetchedAt);
    } catch (e) {
      setFetchError(getFirestoreUserMessage(e));
      setRaw(null);
      setFetchedAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Cash is period-independent, so it survives an invalid date range.
  const cashSnapshot = useMemo(() => (raw ? computeCashSnapshot(raw) : null), [raw]);

  const dashboard = useMemo(
    () => (raw && selectedRange.bounds ? computeDashboard(raw, selectedRange.bounds) : null),
    [raw, selectedRange.bounds],
  );

  const rangeError = selectedRange.bounds ? null : "Select a valid date or date range.";
  const error = fetchError ?? rangeError;

  const selected = dashboard?.profit ?? null;
  const stock = dashboard?.stock ?? null;
  const customerCount = dashboard?.activeCustomerCount ?? null;
  const weeklyVelocity = dashboard?.velocity ?? null;
  const ytdWeeklySales = dashboard?.ytdWeeklySales ?? null;

  return (
    <div className="space-y-6">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      <div className="space-y-4">
      <section aria-label="KPI period">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              {fetchedAt ? (
                <p className="text-xs text-muted-foreground">
                  Figures as of{" "}
                  {fetchedAt.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void load(true)}
                disabled={loading}
                aria-label="Refresh dashboard"
                title="Refresh"
              >
                <RefreshIcon />
              </Button>
            </div>
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
            loading={loading}
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

      {!error && selectedRange.bounds ? (
        <DashboardExtendedKpiGrid
          breakdown={selected}
          stock={stock}
          customerCount={customerCount}
          rollingVelocity={weeklyVelocity}
          ytdWeeklySales={ytdWeeklySales}
          loading={loading}
          periodLabel={selectedRange.label}
        />
      ) : null}

      </div>
    </div>
  );
}
