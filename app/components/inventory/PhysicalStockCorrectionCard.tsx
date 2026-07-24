"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/Card";
import {
  applyCorrection,
  loadRecentCorrections,
  newIdempotencyKey,
  previewCorrection,
  searchProducts,
  type CorrectionPreview,
  type ProductSearchHit,
  type RecentCorrection,
} from "@/lib/inventory/physicalCorrectionClient";

const COST_SOURCE_LABEL: Record<string, string> = {
  latest_stock_in: "latest stock-in cost",
  product_cost_price: "product purchase cost",
  manual: "manually entered",
};

export function PhysicalStockCorrectionCard() {
  // one recount session per page load; groups all corrections done in this sitting
  const sessionRef = useRef<string>(newIdempotencyKey());
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<ProductSearchHit[]>([]);

  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [countInput, setCountInput] = useState("");
  const [manualCostInput, setManualCostInput] = useState("");
  // "auto" uses the resolved cost; "manual" lets the admin override it (e.g. a bulk
  // lot bought far cheaper than the latest small stock-in).
  const [costMode, setCostMode] = useState<"auto" | "manual">("auto");
  const [reason, setReason] = useState("");

  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyRef = useRef<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [recent, setRecent] = useState<RecentCorrection[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await loadRecentCorrections(25));
    } catch {
      /* non-fatal: history is a convenience */
    }
  }, []);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      setHits(await searchProducts(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function selectProduct(id: string) {
    setLoadingPreview(true);
    setError(null);
    setNotice(null);
    setResult(null);
    setCountInput("");
    setManualCostInput("");
    setReason("");
    try {
      const p = await previewCorrection(id);
      if (p.status === "error") {
        setError(p.message);
        setPreview(null);
      } else {
        setPreview(p);
        setHits([]);
        // Default to the auto-resolved cost, pre-filled so an override starts from it.
        if (p.resolved_unit_cost != null) {
          setCostMode("auto");
          setManualCostInput(String(p.resolved_unit_cost));
        } else {
          setCostMode("manual");
          setManualCostInput("");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load product.");
    } finally {
      setLoadingPreview(false);
    }
  }

  const parsedCount = useMemo(() => {
    if (countInput.trim() === "") return null;
    const n = Number(countInput);
    if (!Number.isInteger(n) || n < 0) return NaN;
    return n;
  }, [countInput]);

  const manualCost = manualCostInput.trim() === "" ? null : Number(manualCostInput);
  const manualCostValid = manualCost != null && Number.isFinite(manualCost) && manualCost > 0;

  // Admin may always override the auto-resolved cost. In "manual" mode the entered
  // value is authoritative; in "auto" mode the resolved cost is used.
  const usingManual = costMode === "manual";
  const effectiveCost = usingManual
    ? (manualCostValid ? manualCost : null)
    : preview?.resolved_unit_cost ?? null;
  const effectiveCostSource = usingManual ? "manual" : preview?.cost_source ?? null;

  const delta = preview != null && parsedCount != null && !Number.isNaN(parsedCount)
    ? parsedCount - preview.product.stock_quantity
    : null;

  const canConfirm =
    preview != null &&
    parsedCount != null &&
    !Number.isNaN(parsedCount) &&
    (parsedCount === 0 || effectiveCost != null);

  function openConfirm() {
    if (!canConfirm) return;
    idempotencyRef.current = newIdempotencyKey(); // fresh key per confirmation
    setConfirming(true);
  }

  async function confirmApply() {
    if (!preview || parsedCount == null || Number.isNaN(parsedCount)) return;
    if (submitting) return; // double-submit guard
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await applyCorrection({
        productId: preview.product.id,
        physicalCount: parsedCount,
        manualUnitCost: usingManual ? manualCost : null,
        reason,
        recountSessionId: sessionRef.current,
        idempotencyKey: idempotencyRef.current ?? newIdempotencyKey(),
        expectedCurrentStock: preview.product.stock_quantity,
        expectedOpenLotTotal: preview.before_lot_total,
      });

      if (res.status === "applied" || res.status === "already_applied") {
        const c = res.correction;
        setCompleted((prev) => new Set(prev).add(c.product_id));
        setResult({
          ok: c.post_update_validation.ok,
          text:
            `${preview.product.name}: set to ${c.physical_count} ` +
            `(${c.stock_delta >= 0 ? "+" : ""}${c.stock_delta}). ` +
            `${res.status === "already_applied" ? "Already applied (idempotent). " : ""}` +
            `Post-check ${c.post_update_validation.ok ? "passed ✓" : "FAILED ✗"}.`,
        });
        setConfirming(false);
        await refreshRecent();
      } else if (res.status === "stale_preview") {
        setConfirming(false);
        setError(
          `${res.message} Current stock is now ${res.current_stock}, open lots ${res.current_open_lot_total}. Reloading…`,
        );
        await selectProduct(preview.product.id); // refresh expected values; forces a fresh confirm
      } else if (res.status === "invalid_count" || res.status === "cost_required") {
        setConfirming(false);
        setError(res.message);
      } else if (res.status === "not_found") {
        setConfirming(false);
        setError("Product no longer exists.");
      } else {
        setConfirming(false);
        setError(res.message);
      }
    } catch (e) {
      setConfirming(false);
      setError(e instanceof Error ? e.message : "Correction failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function nextProduct() {
    setPreview(null);
    setQuery("");
    setHits([]);
    setResult(null);
    setError(null);
    setNotice(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Physical stock correction</CardTitle>
          <CardDescription>
            Enter the physically counted warehouse quantity for one product. The count is
            authoritative — nothing is reconstructed from history. Quantities are whole numbers
            (stock is integer-only). Undo is only a new, audited correction.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
          {notice ? <InlineAlert variant="info">{notice}</InlineAlert> : null}
          {result ? (
            <InlineAlert variant={result.ok ? "success" : "error"}>{result.text}</InlineAlert>
          ) : null}

          {/* Search */}
          {!preview ? (
            <div className="flex flex-col gap-3">
              <Label htmlFor="psc-search">Find a product (exact ID / SKU, or name)</Label>
              <div className="flex gap-2">
                <Input
                  id="psc-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSearch();
                  }}
                  placeholder="Type a product name or paste its ID"
                  autoComplete="off"
                />
                <Button type="button" size="sm" disabled={searching} onClick={() => void handleSearch()}>
                  {searching ? "Searching…" : "Search"}
                </Button>
              </div>
              {hits.length > 0 ? (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => void selectProduct(h.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
                      >
                        {h.image_url ? (
                          <img src={h.image_url} alt="" className="h-9 w-9 rounded object-cover" />
                        ) : (
                          <span className="h-9 w-9 rounded bg-muted" />
                        )}
                        <span className="flex-1">
                          <span className="block text-sm font-medium">{h.name || "(unnamed)"}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{h.sku}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          stock {h.stock_quantity}
                          {completed.has(h.id) ? " · ✓ corrected" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim() && !searching ? (
                <p className="text-sm text-muted-foreground">
                  Search, then pick a product. We never update from a typed name alone.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Selected product + count entry */}
          {loadingPreview ? <p className="text-sm text-muted-foreground">Loading product…</p> : null}
          {preview ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-4">
                {preview.product.image_url ? (
                  <img
                    src={preview.product.image_url}
                    alt=""
                    className="h-16 w-16 rounded-md border border-border object-cover"
                  />
                ) : (
                  <span className="h-16 w-16 rounded-md border border-border bg-muted" />
                )}
                <div className="flex-1">
                  <p className="text-base font-semibold">{preview.product.name || "(unnamed)"}</p>
                  <p className="font-mono text-xs text-muted-foreground">SKU {preview.product.sku}</p>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    <span>Current stock: <strong>{preview.product.stock_quantity}</strong></span>
                    <span>Open-lot total: <strong>{preview.before_lot_total}</strong></span>
                    <span className="text-muted-foreground">Open lots: {preview.open_lots.length}</span>
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={nextProduct}>
                  Change product
                </Button>
              </div>

              {preview.product.stock_quantity !== preview.before_lot_total ? (
                <InlineAlert variant="warning">
                  Heads up: this product’s book stock ({preview.product.stock_quantity}) already
                  disagrees with its open-lot total ({preview.before_lot_total}). The recount will
                  reset both to your counted number.
                </InlineAlert>
              ) : null}

              {preview.open_lots.length > 0 ? (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[28rem] text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Lot</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Remaining</th>
                        <th className="px-3 py-2 font-medium">Unit cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.open_lots.map((l) => (
                        <tr key={l.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 font-mono text-xs">{l.id.slice(0, 10)}…</td>
                          <td className="px-3 py-2 text-xs">{l.source}</td>
                          <td className="px-3 py-2">{l.qty_remaining}</td>
                          <td className="px-3 py-2">{l.unit_cost}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No open lots.</p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="psc-count">Physically counted quantity</Label>
                  <Input
                    id="psc-count"
                    inputMode="numeric"
                    value={countInput}
                    onChange={(e) => setCountInput(e.target.value)}
                    placeholder="Whole number, e.g. 32"
                  />
                  {parsedCount != null && Number.isNaN(parsedCount) ? (
                    <span className="text-xs text-destructive">Enter a whole number of 0 or more.</span>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="psc-cost">Unit cost for the new lot</Label>
                  {parsedCount === 0 ? (
                    <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
                      — (no lot created for a zero count)
                    </p>
                  ) : costMode === "auto" && preview.resolved_unit_cost != null ? (
                    <div className="flex items-center gap-2">
                      <p className="flex-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
                        {preview.resolved_unit_cost} ({COST_SOURCE_LABEL[preview.cost_source ?? "manual"]})
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setManualCostInput(String(preview.resolved_unit_cost ?? ""));
                          setCostMode("manual");
                        }}
                      >
                        Override
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Input
                        id="psc-cost"
                        inputMode="decimal"
                        value={manualCostInput}
                        onChange={(e) => setManualCostInput(e.target.value)}
                        placeholder="e.g. 52"
                      />
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={manualCostInput.trim() !== "" && !manualCostValid ? "text-destructive" : "text-muted-foreground"}>
                          {manualCostInput.trim() !== "" && !manualCostValid
                            ? "Cost must be a positive number."
                            : preview.resolved_unit_cost == null
                              ? "No cost on file — enter the unit cost."
                              : "Manual override."}
                        </span>
                        {preview.resolved_unit_cost != null ? (
                          <button
                            type="button"
                            className="underline hover:no-underline"
                            onClick={() => setCostMode("auto")}
                          >
                            Use auto ({preview.resolved_unit_cost})
                          </button>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="psc-reason">Reason / notes (optional)</Label>
                <Input
                  id="psc-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Warehouse recount 2026-07, shelf B"
                />
              </div>

              {/* Preview of the result */}
              {parsedCount != null && !Number.isNaN(parsedCount) ? (
                <div className="rounded-md border border-border bg-surface-muted px-4 py-3 text-sm">
                  <p>
                    New stock will be <strong>{parsedCount}</strong>{" "}
                    {delta != null ? (
                      <span
                        className={
                          delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground"
                        }
                      >
                        ({delta > 0 ? `+${delta} surplus` : delta < 0 ? `${delta} shrinkage` : "no change"})
                      </span>
                    ) : null}
                    .
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {preview.open_lots.length} existing lot(s) will be closed;{" "}
                    {parsedCount > 0 ? "one new baseline lot will be created." : "no new lot (count is 0)."}
                  </p>
                </div>
              ) : null}

              <div>
                <Button
                  type="button"
                  disabled={!canConfirm || submitting}
                  onClick={openConfirm}
                >
                  Update inventory
                </Button>
                {parsedCount != null && !Number.isNaN(parsedCount) && parsedCount > 0 && effectiveCost == null ? (
                  <span className="ml-3 text-xs text-destructive">Enter a valid unit cost first.</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Confirmation modal */}
      {confirming && preview && parsedCount != null && !Number.isNaN(parsedCount) ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-base font-semibold">Confirm stock correction</h3>
            <div className="mt-3 space-y-1 text-sm">
              <p><strong>{preview.product.name}</strong> <span className="font-mono text-xs text-muted-foreground">({preview.product.sku})</span></p>
              <p>Current stock: {preview.product.stock_quantity} → <strong>{parsedCount}</strong>{" "}
                {delta != null && delta !== 0 ? `(${delta > 0 ? "+" : ""}${delta})` : ""}
              </p>
              <p>
                {preview.open_lots.length} lot(s) closed;{" "}
                {parsedCount > 0
                  ? `1 new lot @ cost ${effectiveCost} (${COST_SOURCE_LABEL[effectiveCostSource ?? "manual"]})`
                  : "no new lot"}
              </p>
            </div>
            <InlineAlert variant="warning">
              This immediately corrects live inventory and writes a permanent audit record. It
              cannot be undone except by another correction.
            </InlineAlert>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={submitting} onClick={() => void confirmApply()}>
                {submitting ? "Updating…" : "Confirm update"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Recent corrections */}
      <Card>
        <CardHeader>
          <CardTitle>Recent corrections</CardTitle>
          <CardDescription>Most recent physical stock corrections (audit trail).</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No corrections yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Count</th>
                    <th className="px-3 py-2 font-medium">Δ</th>
                    <th className="px-3 py-2 font-medium">Cost source</th>
                    <th className="px-3 py-2 font-medium">By</th>
                    <th className="px-3 py-2 font-medium">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{r.product_name || r.product_id}</td>
                      <td className="px-3 py-2">{r.physical_count}</td>
                      <td className={`px-3 py-2 ${r.stock_delta > 0 ? "text-success" : r.stock_delta < 0 ? "text-destructive" : ""}`}>
                        {r.stock_delta > 0 ? "+" : ""}{r.stock_delta}
                      </td>
                      <td className="px-3 py-2 text-xs">{COST_SOURCE_LABEL[r.cost_source] ?? r.cost_source}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.operator_email}</td>
                      <td className="px-3 py-2 text-xs">{r.ok ? "✓" : "✗"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
