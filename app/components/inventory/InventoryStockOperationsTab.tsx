"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  applyLowStockListFilters,
  computeLowStockKpis,
  DEFAULT_LOW_STOCK_THRESHOLD,
  filterLowStockProducts,
  lowStockStatusLabel,
  LOW_STOCK_THRESHOLD_PRESETS,
  normalizeThreshold,
  parseThresholdFromUrl,
  toLowStockRow,
  type LowStockProductInput,
  type LowStockProductRow,
  type LowStockStatus,
  type LowStockStatusFilter,
} from "@/lib/inventory/lowStock";
import type { ProductDoc } from "@/lib/types/firestore";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";
import { ReorderListModal } from "@/app/components/inventory/ReorderListModal";
import { StockAdjustModal } from "@/app/components/inventory/StockAdjustModal";
import { ProductLotsModal } from "@/app/components/products/ProductLotsModal";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";

type Row = ProductDoc & { id: string };

type DisplayRow = {
  id: string;
  name: string;
  category: string | null;
  stock_quantity: number;
  cost_price: number;
  sale_price: number;
  status: LowStockStatus | null;
};

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-surface text-muted-foreground hover:bg-surface-hover",
      )}
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: LowStockStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        status === "out_of_stock"
          ? "bg-destructive-muted text-destructive"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      )}
    >
      {lowStockStatusLabel(status)}
    </span>
  );
}

export function InventoryStockOperationsTab({
  products,
  loading,
}: {
  products: Row[];
  loading: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lowOnly = searchParams.get("low") === "1";

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [statusFilter, setStatusFilter] = useState<LowStockStatusFilter>("all");
  const [threshold, setThreshold] = useState(() =>
    parseThresholdFromUrl(searchParams.get("threshold")),
  );
  const [thresholdInput, setThresholdInput] = useState(() =>
    String(parseThresholdFromUrl(searchParams.get("threshold"))),
  );
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState<string | null>(null);
  const [lotsModalProductId, setLotsModalProductId] = useState<string | null>(null);

  function updateParams(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function setLowOnly(next: boolean) {
    updateParams((p) => {
      if (next) {
        p.set("low", "1");
        p.set("threshold", String(threshold));
      } else {
        p.delete("low");
        p.delete("threshold");
      }
    });
  }

  function applyThresholdValue(value: number) {
    const normalized = normalizeThreshold(value);
    setThreshold(normalized);
    setThresholdInput(String(normalized));
    updateParams((p) => p.set("threshold", String(normalized)));
  }

  function handleThresholdInputChange(raw: string) {
    setThresholdInput(raw);
    if (raw.trim() === "") return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) setThreshold(normalizeThreshold(parsed));
  }

  function handleThresholdBlur() {
    if (thresholdInput.trim() === "") {
      applyThresholdValue(DEFAULT_LOW_STOCK_THRESHOLD);
      return;
    }
    const parsed = Number(thresholdInput);
    applyThresholdValue(Number.isFinite(parsed) ? parsed : DEFAULT_LOW_STOCK_THRESHOLD);
  }

  const productInputs: LowStockProductInput[] = useMemo(
    () =>
      products.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        stock_quantity: row.stock_quantity,
        cost_price: row.cost_price,
        sale_price: row.sale_price,
        pricing_mode: row.pricing_mode,
      })),
    [products],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((r) => {
      const c = r.category?.trim();
      if (c) set.add(c);
    });
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [products]);

  // Low-stock rows (used for the KPI strip and reorder PDF when the filter is on).
  const lowStockRows: LowStockProductRow[] = useMemo(() => {
    if (!lowOnly) return [];
    const thresholdRows = filterLowStockProducts(productInputs, threshold, {
      status: statusFilter,
    });
    return applyLowStockListFilters(thresholdRows, { search, category, status: statusFilter });
  }, [lowOnly, productInputs, threshold, statusFilter, search, category]);

  const normalRows: DisplayRow[] = useMemo(() => {
    if (lowOnly) return [];
    const q = search.trim().toLowerCase();
    return productInputs
      .map((p) => {
        const r = toLowStockRow(p);
        return {
          id: r.id,
          name: r.name,
          category: r.category,
          stock_quantity: r.stock_quantity,
          cost_price: r.cost_price,
          sale_price: r.sale_price,
          status: null,
        };
      })
      .filter((r) => {
        if (category && (r.category ?? "") !== category) return false;
        if (q) {
          const name = r.name.toLowerCase();
          const cat = (r.category ?? "").toLowerCase();
          if (!name.includes(q) && !cat.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [lowOnly, productInputs, search, category]);

  const displayRows: DisplayRow[] = lowOnly
    ? lowStockRows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        stock_quantity: r.stock_quantity,
        cost_price: r.cost_price,
        sale_price: r.sale_price,
        status: r.status,
      }))
    : normalRows;

  const kpis = useMemo(() => computeLowStockKpis(lowStockRows), [lowStockRows]);

  const adjustRow = adjustProductId
    ? (products.find((r) => r.id === adjustProductId) ?? null)
    : null;
  const lotsModalRow = lotsModalProductId
    ? (products.find((r) => r.id === lotsModalProductId) ?? null)
    : null;

  const emptyMessage = lowOnly
    ? products.length === 0
      ? "No products yet."
      : `No products at or below ${threshold} units${search.trim() || category ? " match your filters" : ""}.`
    : products.length === 0
      ? "No products yet."
      : "No products match your filters.";

  return (
    <>
      <ReorderListModal
        open={reorderModalOpen}
        onClose={() => setReorderModalOpen(false)}
        threshold={threshold}
        products={lowStockRows}
      />
      {adjustRow ? (
        <StockAdjustModal
          key={adjustRow.id}
          productId={adjustRow.id}
          productName={adjustRow.name}
          currentStock={adjustRow.stock_quantity}
          defaultUnitCost={adjustRow.cost_price}
          pricingMode={adjustRow.pricing_mode ?? "manual"}
          onDismiss={() => setAdjustProductId(null)}
        />
      ) : null}
      {lotsModalRow ? (
        <ProductLotsModal
          key={lotsModalRow.id}
          row={lotsModalRow}
          onDismiss={() => setLotsModalProductId(null)}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Stock</CardTitle>
          <CardDescription>
            Record stock in and out, edit FIFO lots, and review levels. Turn on
            <span className="font-medium text-foreground"> Low stock only</span> to focus on items that
            need reordering.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="stock-search">Search</Label>
              <Input
                id="stock-search"
                type="search"
                placeholder="Product name or category"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="stock-category">Category</Label>
              <Select
                id="stock-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <label className="flex w-fit items-center gap-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
            />
            Low stock only
          </label>

          {lowOnly ? (
            <div className="space-y-4 rounded-lg border border-border bg-surface-muted/40 p-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label htmlFor="stock-threshold">Stock threshold</Label>
                  <Input
                    id="stock-threshold"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    className="h-10 w-28 tabular-nums"
                    value={thresholdInput}
                    onChange={(e) => handleThresholdInputChange(e.target.value)}
                    onBlur={handleThresholdBlur}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Presets</p>
                  <div className="flex flex-wrap gap-2">
                    {LOW_STOCK_THRESHOLD_PRESETS.map((preset) => (
                      <FilterChip
                        key={preset}
                        label={String(preset)}
                        active={threshold === preset}
                        onClick={() => applyThresholdValue(preset)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <FilterChip
                  label="All low stock"
                  active={statusFilter === "all"}
                  onClick={() => setStatusFilter("all")}
                />
                <FilterChip
                  label="Out of stock"
                  active={statusFilter === "out_of_stock"}
                  onClick={() => setStatusFilter("out_of_stock")}
                />
                <FilterChip
                  label="Need reorder"
                  active={statusFilter === "need_reorder"}
                  onClick={() => setStatusFilter("need_reorder")}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-surface px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Out of stock
                  </p>
                  <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
                    {kpis.outOfStockCount.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Need reorder
                  </p>
                  <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
                    {kpis.reorderCount.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Units at risk
                  </p>
                  <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
                    {kpis.totalUnitsAtRisk.toLocaleString()}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => setReorderModalOpen(true)}
              >
                Shopping list
              </Button>
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `Showing ${displayRows.length} product${displayRows.length === 1 ? "" : "s"}${
                  lowOnly ? ` at or below ${threshold} units` : ""
                }`}
          </p>

          {displayRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{loading ? "Loading…" : emptyMessage}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[840px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-4 py-3 font-semibold text-foreground">Product</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Category</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Stock</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Cost</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Sale</th>
                    {lowOnly ? (
                      <th className="px-4 py-3 font-semibold text-foreground">Status</th>
                    ) : null}
                    <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, i) => (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-b border-border last:border-b-0",
                        i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                      )}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        <Link
                          href={`/products/${row.id}`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.category ?? "—"}</td>
                      <td
                        className={cn(
                          "px-4 py-3 tabular-nums font-medium",
                          lowOnly && row.stock_quantity === 0
                            ? "text-destructive"
                            : lowOnly
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-foreground",
                        )}
                      >
                        {row.stock_quantity.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">
                        {formatMoney(row.cost_price)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">
                        {formatMoney(row.sale_price)}
                      </td>
                      {lowOnly ? (
                        <td className="px-4 py-3">
                          {row.status ? <StatusBadge status={row.status} /> : null}
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            variant="primary"
                            className="h-9 px-3 py-1.5 text-xs"
                            onClick={() => setAdjustProductId(row.id)}
                          >
                            Adjust stock
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 px-3 py-1.5 text-xs"
                            onClick={() => setLotsModalProductId(row.id)}
                          >
                            Lots
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
