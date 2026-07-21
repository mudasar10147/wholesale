"use client";

import { useCallback, useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  loadLatestValidationRun,
  triggerValidationRun,
  type ClientValidationRun,
  type RunSeverity,
} from "@/lib/inventory/validationRunClient";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/Card";

const STALE_HOURS = 48;

function toDate(ts?: { toDate?: () => Date }): Date | null {
  return ts?.toDate ? ts.toDate() : null;
}

function ageHours(d: Date | null): number | null {
  return d ? (Date.now() - d.getTime()) / 3_600_000 : null;
}

function ageLabel(d: Date | null): string {
  const h = ageHours(d);
  if (h == null) return "never run";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const VERDICT_STYLE: Record<string, string> = {
  PASS: "bg-emerald-500/15 text-emerald-600",
  PASS_WITH_WARNINGS: "bg-amber-500/15 text-amber-600",
  FAIL: "bg-red-500/15 text-red-600",
};
const SEVERITY_STYLE: Record<RunSeverity, string> = {
  CRITICAL: "text-red-600",
  ERROR: "text-amber-600",
  WARNING: "text-muted-foreground",
};

export function InventoryValidationCard() {
  const [run, setRun] = useState<ClientValidationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<null | "full" | "incremental">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRun(await loadLatestValidationRun(getDb()));
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRun(mode: "full" | "incremental") {
    setRunning(mode);
    setError(null);
    setNotice(null);
    try {
      const res = await triggerValidationRun(mode);
      if (res.status === "started") {
        setNotice(`${mode === "full" ? "Full" : "Incremental"} validation complete: ${res.record.verdict}.`);
        await refresh();
      } else if (res.status === "in_progress") {
        setNotice("A validation run is already in progress. Showing its progress shortly.");
        await refresh();
      } else if (res.status === "rate_limited") {
        setNotice(`${res.message} Try again in ~${Math.ceil(res.retry_after_seconds / 60)} min.`);
      } else {
        setError(res.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed.");
    } finally {
      setRunning(null);
    }
  }

  const startedAt = toDate(run?.started_at);
  const stale = (ageHours(startedAt) ?? Infinity) > STALE_HOURS;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory validation</CardTitle>
        <CardDescription>
          Read-only invariant validation. Incremental re-checks recently-changed products; full scans everything.
          New drift is dated by <code>first_seen_at</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
        {notice ? <InlineAlert variant="info">{notice}</InlineAlert> : null}

        <div className="flex flex-wrap items-center gap-3 text-sm">
          {run ? (
            <>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[run.verdict] ?? "bg-muted"}`}>
                {run.verdict}
              </span>
              <span className={stale ? "text-amber-600" : "text-muted-foreground"}>
                Last run: {ageLabel(startedAt)}
                {stale ? " — stale (>48h)" : ""} · {run.mode}
                {run.complete ? "" : " · partial"}
              </span>
              <span className="text-muted-foreground">
                <strong className="text-red-600">{run.summary.critical}</strong> critical ·{" "}
                <strong className="text-amber-600">{run.summary.error}</strong> error ·{" "}
                <strong>{run.summary.warning}</strong> warning
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{loading ? "Loading…" : "No validation has run yet."}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={running !== null} onClick={() => void handleRun("incremental")}>
            {running === "incremental" ? "Running…" : "Run incremental"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={running !== null} onClick={() => void handleRun("full")}>
            {running === "full" ? "Running…" : "Run full scan"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>

        {run && run.issues.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Invariant</th>
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 font-medium">Entity</th>
                  <th className="px-3 py-2 font-medium">First seen</th>
                </tr>
              </thead>
              <tbody>
                {run.issues.slice(0, 50).map((issue, i) => (
                  <tr key={`${issue.invariant_id}-${issue.entity_id}-${i}`} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{issue.invariant_id}</td>
                    <td className={`px-3 py-2 text-xs font-medium ${SEVERITY_STYLE[issue.severity]}`}>{issue.severity}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {issue.entity_type}:{issue.entity_id}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {toDate(issue.first_seen_at)?.toLocaleDateString() ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {run.truncated ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Showing 50 of {run.issues_total}. Full detail in the run record.
              </p>
            ) : null}
          </div>
        ) : run ? (
          <p className="text-sm text-muted-foreground">No invariant violations in the last run.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
