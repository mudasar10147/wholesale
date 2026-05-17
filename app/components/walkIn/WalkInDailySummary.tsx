"use client";

import { useMemo } from "react";
import type { Timestamp } from "firebase/firestore";
import {
  buildRecentWalkInDailyTotals,
  type WalkInLineAmount,
} from "@/lib/walkIn/dailyTotals";
import type { WalkInSessionDoc } from "@/lib/types/firestore";
import { StatCard } from "@/app/components/ui/StatCard";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";

type SessionRow = { id: string; data: WalkInSessionDoc };

type WalkInDailySummaryProps = {
  approved: SessionRow[];
  sessionLines: Record<string, WalkInLineAmount[] | undefined>;
  sessionsLoading: boolean;
};

function linesStillLoading(
  sessions: SessionRow[],
  linesBySession: Record<string, WalkInLineAmount[] | undefined>,
): boolean {
  return sessions.some((s) => linesBySession[s.id] === undefined);
}

export function WalkInDailySummary({
  approved,
  sessionLines,
  sessionsLoading,
}: WalkInDailySummaryProps) {
  const linesLoading = linesStillLoading(approved, sessionLines);

  const dailyTotals = useMemo(() => {
    const sessions = approved.map((row) => ({
      id: row.id,
      saleDate: row.data.sale_date as Timestamp | undefined,
    }));
    return buildRecentWalkInDailyTotals(sessions, sessionLines, 7);
  }, [approved, sessionLines]);

  const loading = sessionsLoading || linesLoading;

  return (
    <section className="space-y-4" aria-labelledby="walkin-daily-summary-heading">
      <div>
        <h2 id="walkin-daily-summary-heading" className="text-base font-semibold text-foreground">
          Daily totals
        </h2>
        <p className="text-sm text-muted-foreground">
          Approved walk-in sales by business date (last 7 days).
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-surface p-5 shadow-card"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">…</p>
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {dailyTotals.map((day) => (
            <StatCard
              key={day.dateKey}
              label={day.label}
              value={formatMoney(day.total)}
              hint={
                day.sessionCount === 0
                  ? "No approved sales"
                  : `${day.sessionCount} sale${day.sessionCount === 1 ? "" : "s"}`
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
