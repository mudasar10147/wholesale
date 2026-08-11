"use client";

import { useMemo, useState } from "react";
import type { BusinessIntelligenceReport } from "@/lib/bi/analyze";
import {
  buildRevenueTargetPlan,
  buildTargetPlan,
  simulateAdditionalCapital,
} from "@/lib/bi/targets";
import {
  formatDays,
  formatMonthsToTarget,
  formatPercent,
  formatPkr,
  formatPkrCompactWhole,
  formatTurns,
} from "@/lib/bi/format";
import {
  BiCard,
  BiSection,
  DataNote,
  InsufficientData,
  KeyValueRow,
  MetricGrid,
  MetricTile,
  ScrollTable,
  StatusPill,
  Td,
  Th,
} from "@/app/components/bi/BiPrimitives";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

function parseAmount(value: string): number | null {
  const parsed = Number.parseFloat(value.trim().replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function TargetsSection({ report }: { report: BusinessIntelligenceReport }) {
  return (
    <BiSection
      id="targets"
      title="Targets & simulators"
      description="What it takes to reach a profit or revenue level, and what extra capital would actually buy. Every figure is a projection at today's economics, clearly labelled as such."
    >
      <MilestonesCard report={report} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfitTargetCalculator report={report} />
        <RevenueTargetCalculator report={report} />
      </div>
      <CapitalSimulator report={report} />
    </BiSection>
  );
}

function MilestonesCard({ report }: { report: BusinessIntelligenceReport }) {
  const { milestones } = report;

  return (
    <BiCard
      title="Profit milestones"
      description="Projections, not commitments — what each monthly net-profit level would demand of revenue and capital."
    >
      <ScrollTable minWidth={780} label="Profit milestones">
        <thead>
          <tr>
            <Th>Monthly net profit</Th>
            <Th numeric>Revenue required</Th>
            <Th numeric>Additional revenue</Th>
            <Th numeric>Sales increase</Th>
            <Th numeric>Working capital needed</Th>
            <Th numeric>Additional capital</Th>
            <Th>Projected timeline</Th>
          </tr>
        </thead>
        <tbody>
          {milestones.map((milestone) => (
            <tr key={milestone.targetNetProfit} className="odd:bg-surface even:bg-surface-muted/40">
              <Td className="whitespace-nowrap font-medium">
                {formatPkrCompactWhole(milestone.targetNetProfit)}
                {milestone.reached ? (
                  <span className="ml-2 inline-block align-middle">
                    <StatusPill tone="positive">Reached</StatusPill>
                  </span>
                ) : null}
              </Td>
              <Td numeric>{formatPkrCompactWhole(milestone.requiredRevenue)}</Td>
              <Td numeric>{formatPkrCompactWhole(milestone.additionalRevenue)}</Td>
              <Td numeric>{formatPercent(milestone.requiredRevenueIncreasePct)}</Td>
              <Td numeric>{formatPkrCompactWhole(milestone.requiredWorkingCapital)}</Td>
              <Td numeric>{formatPkrCompactWhole(milestone.additionalWorkingCapital)}</Td>
              <Td className="text-xs">
                {milestone.reached ? "Already reached" : formatMonthsToTarget(milestone.monthsToReach)}
              </Td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
      <DataNote className="mt-3">
        Timelines assume the current growth trend continues and the margin, expense structure and
        cash cycle hold. They are projections — not a claim about future results.
      </DataNote>
    </BiCard>
  );
}

function ProfitTargetCalculator({ report }: { report: BusinessIntelligenceReport }) {
  const [input, setInput] = useState("300000");
  const [applied, setApplied] = useState(300_000);
  const plan = useMemo(() => buildTargetPlan(applied, report.economics), [applied, report.economics]);

  return (
    <BiCard title="Profit target calculator" description="Enter the monthly net profit you want.">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parseAmount(input);
          if (parsed !== null) setApplied(parsed);
        }}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="bi-profit-target">Desired monthly net profit (Rs.)</Label>
          <Input
            id="bi-profit-target"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-describedby="bi-profit-target-help"
          />
        </div>
        <Button type="submit" className="shrink-0">
          Calculate
        </Button>
      </form>
      <p id="bi-profit-target-help" className="mt-1.5 text-xs text-muted-foreground">
        Showing results for {formatPkr(applied)} a month.
      </p>

      {!plan.achievable ? (
        <div className="mt-4">
          <InsufficientData metric="Profit target" reason={plan.note} />
        </div>
      ) : (
        <div className="mt-4 space-y-0">
          <KeyValueRow label="Monthly revenue required" value={formatPkr(plan.requiredRevenue)} emphasize />
          <KeyValueRow label="Additional revenue needed" value={formatPkr(plan.additionalRevenue)} />
          <KeyValueRow label="Sales increase required" value={formatPercent(plan.requiredRevenueIncreasePct)} />
          <KeyValueRow label="Gross profit required" value={formatPkr(plan.requiredGrossProfit)} info="gross_profit" />
          <KeyValueRow label="Expected expenses at that level" value={formatPkr(plan.expectedExpenses)} />
          <KeyValueRow label="Monthly purchases required" value={formatPkr(plan.requiredMonthlyPurchases)} />
          <KeyValueRow label="Working capital required" value={formatPkr(plan.requiredWorkingCapital)} info="working_capital" />
          <KeyValueRow
            label="Additional capital needed"
            value={formatPkr(plan.additionalWorkingCapital)}
            tone={(plan.additionalWorkingCapital ?? 0) > 0 ? "warning" : "positive"}
          />
          <KeyValueRow
            label="Projected timeline"
            value={formatMonthsToTarget(plan.monthsToReach)}
            emphasize
          />
        </div>
      )}
      <DataNote className="mt-3">{plan.note}</DataNote>
    </BiCard>
  );
}

function RevenueTargetCalculator({ report }: { report: BusinessIntelligenceReport }) {
  const [input, setInput] = useState("1000000");
  const [applied, setApplied] = useState(1_000_000);
  const plan = useMemo(
    () => buildRevenueTargetPlan(applied, report.economics),
    [applied, report.economics],
  );

  const unavailable = plan.estimatedCogs === null;

  return (
    <BiCard title="Revenue target calculator" description="Enter the monthly revenue you want.">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parseAmount(input);
          if (parsed !== null) setApplied(parsed);
        }}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="bi-revenue-target">Desired monthly revenue (Rs.)</Label>
          <Input
            id="bi-revenue-target"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-describedby="bi-revenue-target-help"
          />
        </div>
        <Button type="submit" className="shrink-0">
          Calculate
        </Button>
      </form>
      <p id="bi-revenue-target-help" className="mt-1.5 text-xs text-muted-foreground">
        Showing results for {formatPkr(applied)} a month.
      </p>

      {unavailable ? (
        <div className="mt-4">
          <InsufficientData metric="Revenue target" reason={plan.note} />
        </div>
      ) : (
        <div className="mt-4 space-y-0">
          <KeyValueRow label="Estimated cost of goods" value={formatPkr(plan.estimatedCogs)} />
          <KeyValueRow label="Expected gross profit" value={formatPkr(plan.expectedGrossProfit)} info="gross_profit" />
          <KeyValueRow label="Estimated operating expenses" value={formatPkr(plan.estimatedOperatingExpenses)} />
          <KeyValueRow
            label="Expected net profit"
            value={formatPkr(plan.expectedNetProfit)}
            emphasize
            tone={(plan.expectedNetProfit ?? 0) >= 0 ? "positive" : "danger"}
            info="net_profit"
          />
          <KeyValueRow
            label="Purchasing capacity required"
            value={formatPkr(plan.requiredPurchasingCapacity)}
            info="purchasing_capacity"
          />
          <KeyValueRow label="Working capital required" value={formatPkr(plan.requiredWorkingCapital)} />
          <KeyValueRow
            label="Working-capital gap"
            value={formatPkr(plan.workingCapitalGap)}
            tone={(plan.workingCapitalGap ?? 0) > 0 ? "warning" : "positive"}
          />
          <KeyValueRow label="Sales increase required" value={formatPercent(plan.requiredRevenueIncreasePct)} />
          <KeyValueRow label="Projected timeline" value={formatMonthsToTarget(plan.monthsToReach)} />
        </div>
      )}
      <DataNote className="mt-3">{plan.note}</DataNote>
    </BiCard>
  );
}

function CapitalSimulator({ report }: { report: BusinessIntelligenceReport }) {
  const [input, setInput] = useState("100000");
  const [applied, setApplied] = useState(100_000);

  const demandHeadroom = useMemo(() => {
    const first = report.compounding.months[0];
    if (!first || first.capacityRevenue === null) return null;
    return Math.max(0, first.demandRevenue - first.revenue);
  }, [report.compounding.months]);

  const simulation = useMemo(
    () =>
      simulateAdditionalCapital({
        additionalCapital: applied,
        economics: report.economics,
        demandHeadroom,
        currentWorkingCapitalGap: report.workingCapital.gap,
      }),
    [applied, demandHeadroom, report.economics, report.workingCapital.gap],
  );

  const unavailable = simulation.additionalMonthlyRevenue === null;

  return (
    <BiCard
      title="Additional capital simulator"
      description="What would an extra Rs. X actually do? Capital only earns its margin each time it rotates, so rotation speed — not a flat margin multiplication — drives the answer."
    >
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parseAmount(input);
          if (parsed !== null) setApplied(parsed);
        }}
      >
        <div className="flex-1 space-y-2 sm:max-w-sm">
          <Label htmlFor="bi-additional-capital">Additional capital (Rs.)</Label>
          <Input
            id="bi-additional-capital"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-describedby="bi-capital-help"
          />
        </div>
        <Button type="submit" className="shrink-0">
          Simulate
        </Button>
      </form>
      <p id="bi-capital-help" className="mt-1.5 text-xs text-muted-foreground">
        Showing what {formatPkr(applied)} of new capital could do.
      </p>

      {unavailable ? (
        <div className="mt-4">
          <InsufficientData metric="Additional capital simulation" reason={simulation.note} />
        </div>
      ) : (
        <>
          <div className="mt-4">
            <MetricGrid columns={4}>
              <MetricTile
                label="Extra stock it buys"
                value={formatPkrCompactWhole(simulation.additionalInventory)}
                hint={`Rotating ${formatTurns(simulation.rotationsPerMonth)} a month.`}
              />
              <MetricTile
                label="Potential extra revenue"
                value={`${formatPkrCompactWhole(simulation.additionalMonthlyRevenue)}/month`}
                tone="positive"
              />
              <MetricTile
                label="Potential extra gross profit"
                value={`${formatPkrCompactWhole(simulation.additionalMonthlyGrossProfit)}/month`}
                info="gross_profit"
              />
              <MetricTile
                label="Potential extra net profit"
                value={`${formatPkrCompactWhole(simulation.additionalMonthlyNetProfit)}/month`}
                tone={(simulation.additionalMonthlyNetProfit ?? 0) >= 0 ? "positive" : "danger"}
                info="net_profit"
              />
            </MetricGrid>
          </div>

          <div className="mt-4 space-y-0">
            <KeyValueRow
              label="Inventory rotations per month"
              value={formatTurns(simulation.rotationsPerMonth)}
              info="inventory_turnover"
            />
            <KeyValueRow
              label="Time for the capital to recycle"
              value={formatDays(simulation.capitalRecycleDays)}
              info="cash_conversion_cycle"
            />
            <KeyValueRow
              label="Effect on the working-capital gap"
              value={
                simulation.gapReduction === null
                  ? "—"
                  : `Closes ${formatPkr(simulation.gapReduction)}`
              }
            />
            <KeyValueRow
              label="Remaining gap after the injection"
              value={
                simulation.remainingGap === null
                  ? "—"
                  : simulation.remainingGap > 0
                    ? formatPkr(simulation.remainingGap)
                    : "None — fully covered"
              }
              tone={(simulation.remainingGap ?? 0) > 0 ? "warning" : "positive"}
            />
            <KeyValueRow
              label="Months for the capital to pay for itself"
              value={formatMonthsToTarget(simulation.paybackMonths)}
              emphasize
            />
          </div>

          {simulation.cappedByDemand ? (
            <div className="mt-3">
              <StatusPill tone="warning">Capped by demand, not capital</StatusPill>
            </div>
          ) : null}
        </>
      )}
      <DataNote className="mt-3">{simulation.note}</DataNote>
    </BiCard>
  );
}
