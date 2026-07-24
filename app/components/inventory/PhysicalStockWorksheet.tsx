"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/Card";
import {
  applyCorrection,
  loadWorksheet,
  newIdempotencyKey,
  type WorksheetRow,
} from "@/lib/inventory/physicalCorrectionClient";

const COST_SOURCE_LABEL: Record<string, string> = {
  latest_stock_in: "latest stock-in",
  product_cost_price: "product cost",
  manual: "manual",
};

type Done = { count: number; delta: number };

export function PhysicalStockWorksheet() {
  const sessionRef = useRef<string>(newIdempotencyKey());
  const [rows, setRows] = useState<WorksheetRow[]>([]);
  const [done, setDone] = useState<Record<string, Done>>({});
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadWorksheet());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load products.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle),
    );
  }, [rows, filter]);

  const applied = useCallback((id: string, newStock: number, d: Done) => {
    setDone((prev) => ({ ...prev, [id]: d }));
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, stock_quantity: newStock, open_lot_total: newStock } : r,
      ),
    );
  }, []);

  const staleUpdate = useCallback((id: string, stock: number, lotTotal: number) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, stock_quantity: stock, open_lot_total: lotTotal } : r,
      ),
    );
  }, []);

  const editAgain = useCallback((id: string) => {
    setDone((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const doneCount = Object.keys(done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick worksheet</CardTitle>
        <CardDescription>
          Type each product’s counted quantity and press <kbd>Enter</kbd> to save it. The cost
          auto-fills from the latest stock-in — click ✎ to override. Every save is a single
          validated, audited transaction; big changes (zeroing or large swings) ask for one
          confirm click.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or ID…"
            className="max-w-xs"
          />
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
            {loading ? "Loading…" : "Reload"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {filtered.length} shown · {rows.length} total · <strong className="text-success">{doneCount}</strong> corrected
          </span>
        </div>

        <div className="max-h-[70vh] overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-surface text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Current</th>
                <th className="px-3 py-2 font-medium">Counted</th>
                <th className="px-3 py-2 font-medium">New / Δ</th>
                <th className="px-3 py-2 font-medium">Cost</th>
                <th className="px-3 py-2 font-medium">Save</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  done={done[row.id]}
                  sessionId={sessionRef.current}
                  onApplied={applied}
                  onStale={staleUpdate}
                  onEditAgain={editAgain}
                />
              ))}
              {filtered.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No products match “{filter}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

type RowProps = {
  row: WorksheetRow;
  done?: Done;
  sessionId: string;
  onApplied: (id: string, newStock: number, d: Done) => void;
  onStale: (id: string, stock: number, lotTotal: number) => void;
  onEditAgain: (id: string) => void;
};

function Row({ row, done, sessionId, onApplied, onStale, onEditAgain }: RowProps) {
  const [count, setCount] = useState("");
  const [costInput, setCostInput] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [status, setStatus] = useState<"idle" | "confirm" | "saving" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const current = row.stock_quantity;
  const parsed = count.trim() === "" ? null : Number(count);
  const validCount = parsed != null && Number.isInteger(parsed) && parsed >= 0;
  const delta = validCount ? (parsed as number) - current : null;

  const overrideVal = costInput.trim() === "" ? null : Number(costInput);
  const overrideValid = overrideVal != null && Number.isFinite(overrideVal) && overrideVal > 0;
  const usingManual = overriding || row.resolved_unit_cost == null;
  const effectiveCost = usingManual ? (overrideValid ? overrideVal : null) : row.resolved_unit_cost;

  const positive = validCount && (parsed as number) > 0;
  const canSave = validCount && ((parsed as number) === 0 || effectiveCost != null);
  const risky =
    validCount &&
    ((parsed as number) === 0 || Math.abs(delta as number) > Math.max(50, current));

  function resetStatus() {
    if (status !== "saving") {
      setStatus("idle");
      setMessage(null);
    }
  }

  async function save() {
    if (status === "saving") return;
    if (!validCount) {
      setStatus("error");
      setMessage("Whole number ≥ 0");
      return;
    }
    if (positive && effectiveCost == null) {
      setStatus("error");
      setMessage("Enter a unit cost");
      return;
    }
    if (risky && status !== "confirm") {
      setStatus("confirm");
      return;
    }
    setStatus("saving");
    setMessage(null);
    try {
      const res = await applyCorrection({
        productId: row.id,
        physicalCount: parsed as number,
        manualUnitCost: usingManual ? overrideVal : null,
        reason: "Worksheet recount",
        recountSessionId: sessionId,
        idempotencyKey: newIdempotencyKey(),
        expectedCurrentStock: current,
        expectedOpenLotTotal: row.open_lot_total,
      });
      if (res.status === "applied" || res.status === "already_applied") {
        onApplied(row.id, res.correction.physical_count, {
          count: res.correction.physical_count,
          delta: res.correction.stock_delta,
        });
        setStatus("idle");
      } else if (res.status === "stale_preview") {
        onStale(row.id, res.current_stock, res.current_open_lot_total);
        setStatus("error");
        setMessage(`Stock changed to ${res.current_stock} — re-enter`);
      } else if (res.status === "cost_required" || res.status === "invalid_count") {
        setStatus("error");
        setMessage(res.message);
      } else if (res.status === "not_found") {
        setStatus("error");
        setMessage("Not found");
      } else {
        setStatus("error");
        setMessage(res.message ?? "Failed");
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Failed");
    }
  }

  if (done) {
    return (
      <tr className="border-b border-border bg-success-muted/40 last:border-0">
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            {row.image_url ? (
              <img src={row.image_url} alt="" className="h-7 w-7 rounded object-cover" />
            ) : (
              <span className="h-7 w-7 rounded bg-muted" />
            )}
            <span>
              <span className="block font-medium">{row.name || "(unnamed)"}</span>
              <span className="block font-mono text-[0.7rem] text-muted-foreground">{row.sku}</span>
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-success" colSpan={3}>
          ✓ set to <strong>{done.count}</strong> ({done.delta >= 0 ? "+" : ""}
          {done.delta})
        </td>
        <td className="px-3 py-2" />
        <td className="px-3 py-2">
          <button type="button" className="text-xs underline hover:no-underline" onClick={() => onEditAgain(row.id)}>
            Edit again
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {row.image_url ? (
            <img src={row.image_url} alt="" className="h-7 w-7 rounded object-cover" />
          ) : (
            <span className="h-7 w-7 rounded bg-muted" />
          )}
          <span>
            <span className="block font-medium">{row.name || "(unnamed)"}</span>
            <span className="block font-mono text-[0.7rem] text-muted-foreground">{row.sku}</span>
          </span>
        </div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={current !== row.open_lot_total ? "text-amber-600" : ""}>
          {current}
          {current !== row.open_lot_total ? ` / lots ${row.open_lot_total}` : ""}
        </span>
      </td>
      <td className="px-3 py-2">
        <Input
          inputMode="numeric"
          value={count}
          onChange={(e) => {
            setCount(e.target.value);
            resetStatus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          placeholder="qty"
          className="w-20"
        />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {validCount ? (
          <span className={delta! > 0 ? "text-success" : delta! < 0 ? "text-destructive" : "text-muted-foreground"}>
            {parsed} ({delta! > 0 ? "+" : ""}{delta})
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {!positive ? (
          <span className="text-muted-foreground">—</span>
        ) : usingManual ? (
          <div className="flex items-center gap-1">
            <Input
              inputMode="decimal"
              value={costInput}
              onChange={(e) => {
                setCostInput(e.target.value);
                resetStatus();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="cost"
              className="w-20"
            />
            {row.resolved_unit_cost != null ? (
              <button
                type="button"
                className="text-[0.7rem] underline"
                onClick={() => {
                  setOverriding(false);
                  setCostInput("");
                  resetStatus();
                }}
              >
                auto
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span>
              {row.resolved_unit_cost}
              <span className="ml-1 text-[0.7rem] text-muted-foreground">
                ({COST_SOURCE_LABEL[row.cost_source ?? "manual"]})
              </span>
            </span>
            <button
              type="button"
              className="text-xs"
              title="Override cost"
              onClick={() => {
                setOverriding(true);
                setCostInput(String(row.resolved_unit_cost ?? ""));
              }}
            >
              ✎
            </button>
          </div>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={status === "confirm" ? "destructive" : "primary"}
            disabled={status === "saving" || !canSave}
            onClick={() => void save()}
          >
            {status === "saving"
              ? "Saving…"
              : status === "confirm"
                ? `Confirm ${delta! >= 0 ? "+" : ""}${delta}`
                : "Save"}
          </Button>
          {message ? (
            <span className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
              {message}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
