"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  applyLowStockListFilters,
  collectProductCategories,
  computeLowStockKpis,
  DEFAULT_LOW_STOCK_THRESHOLD,
  filterLowStockProducts,
  lowStockStatusLabel,
  LOW_STOCK_THRESHOLD_PRESETS,
  normalizeThreshold,
  parseThresholdFromUrl,
  type LowStockListFilters,
  type LowStockProductInput,
  type LowStockStatusFilter,
} from "@/lib/inventory/lowStock";
import type { ProductDoc } from "@/lib/types/firestore";
import { formatMoney } from "@/app/components/dashboard/ProfitBreakdownCard";
import { ReorderListModal } from "@/app/components/inventory/ReorderListModal";
import { StockAdjustControls } from "@/app/components/products/StockAdjustControls";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
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

const defaultListFilters: LowStockListFilters = {
  search: "",
  category: "",
  status: "all",
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

function StatusBadge({ status }: { status: "out_of_stock" | "need_reorder" }) {
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

export function LowStockPageContent() {
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(() =>
    parseThresholdFromUrl(searchParams.get("threshold")),
  );
  const [thresholdInput, setThresholdInput] = useState(() =>
    String(parseThresholdFromUrl(searchParams.get("threshold"))),
  );
  const [listFilters, setListFilters] = useState<LowStockListFilters>(defaultListFilters);
  const [reorderModalOpen, setReorderModalOpen] = useState(false);

  useEffect(() => {
    const db = getDb();
    const q = query(collection(db, COLLECTIONS.products), orderBy("name", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setLoading(false);
        const next: Row[] = [];
        snap.forEach((docSnap) => {
          next.push({ id: docSnap.id, ...(docSnap.data() as ProductDoc) });
        });
        setProducts(next);
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

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

  const categories = useMemo(() => collectProductCategories(productInputs), [productInputs]);

  const thresholdRows = useMemo(
    () =>
      filterLowStockProducts(productInputs, threshold, {
        status: listFilters.status,
      }),
    [productInputs, threshold, listFilters.status],
  );

  const displayRows = useMemo(
    () => applyLowStockListFilters(thresholdRows, listFilters),
    [thresholdRows, listFilters],
  );

  const kpis = useMemo(() => computeLowStockKpis(displayRows), [displayRows]);

  function patchListFilters(partial: Partial<LowStockListFilters>) {
    setListFilters((prev) => ({ ...prev, ...partial }));
  }

  function setStatusFilter(status: LowStockStatusFilter) {
    patchListFilters({ status });
  }

  function applyThresholdValue(value: number) {
    const normalized = normalizeThreshold(value);
    setThreshold(normalized);
    setThresholdInput(String(normalized));
  }

  function handleThresholdInputChange(raw: string) {
    setThresholdInput(raw);
    if (raw.trim() === "") return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      setThreshold(normalizeThreshold(parsed));
    }
  }

  function handleThresholdBlur() {
    if (thresholdInput.trim() === "") {
      applyThresholdValue(DEFAULT_LOW_STOCK_THRESHOLD);
      return;
    }
    const parsed = Number(thresholdInput);
    applyThresholdValue(Number.isFinite(parsed) ? parsed : DEFAULT_LOW_STOCK_THRESHOLD);
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading products…
      </p>
    );
  }

  if (error) {
    return <InlineAlert variant="error">{error}</InlineAlert>;
  }

  const hasProducts = products.length > 0;
  const hasThresholdMatches = thresholdRows.length > 0;
  const emptyMessage = !hasProducts
    ? "No products yet."
    : !hasThresholdMatches
      ? `No products at or below ${threshold} units.`
      : "No products match your filters.";

  return (
    <div className="space-y-6">
      <ReorderListModal
        open={reorderModalOpen}
        onClose={() => setReorderModalOpen(false)}
        threshold={threshold}
        products={displayRows}
      />
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Set a stock threshold to list products at or below that level. Results update in real
            time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="low-stock-threshold">Stock threshold</Label>
              <Input
                id="low-stock-threshold"
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

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="low-stock-search">Search</Label>
              <Input
                id="low-stock-search"
                type="search"
                placeholder="Product name or category"
                value={listFilters.search}
                onChange={(e) => patchListFilters({ search: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="low-stock-category">Category</Label>
              <Select
                id="low-stock-category"
                value={listFilters.category}
                onChange={(e) => patchListFilters({ category: e.target.value })}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <FilterChip
              label="All low stock"
              active={listFilters.status === "all"}
              onClick={() => setStatusFilter("all")}
            />
            <FilterChip
              label="Out of stock"
              active={listFilters.status === "out_of_stock"}
              onClick={() => setStatusFilter("out_of_stock")}
            />
            <FilterChip
              label="Need reorder"
              active={listFilters.status === "need_reorder"}
              onClick={() => setStatusFilter("need_reorder")}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Showing {displayRows.length} product{displayRows.length === 1 ? "" : "s"} with stock ≤{" "}
            {threshold}
            {listFilters.search.trim() || listFilters.category ? " (filtered)" : ""}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Matching products
          </p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
            {kpis.matchingCount.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Out of stock
          </p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
            {kpis.outOfStockCount.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Need reorder
          </p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
            {kpis.reorderCount.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Units at risk
          </p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
            {kpis.totalUnitsAtRisk.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface-muted px-4 py-3 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Value at cost
          </p>
          <p className="mt-1 tabular-nums text-xl font-semibold text-foreground">
            {formatMoney(kpis.totalValueAtCost)}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Low stock products</CardTitle>
            <CardDescription>
              Sorted by stock ascending. Use stock in/out to restock without leaving this page.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={() => setReorderModalOpen(true)}
          >
            Shopping list
          </Button>
        </CardHeader>
        <CardContent>
          {displayRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-4 py-3 font-semibold text-foreground">Product</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Category</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Stock</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Cost</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Sale</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Value at cost</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Status</th>
                    <th className="px-4 py-3 font-semibold text-foreground">Inventory</th>
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
                          row.stock_quantity === 0
                            ? "text-destructive"
                            : "text-amber-700 dark:text-amber-400",
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
                      <td className="px-4 py-3 tabular-nums text-foreground">
                        {formatMoney(row.stockValueAtCost)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StockAdjustControls
                          productId={row.id}
                          currentStock={row.stock_quantity}
                          defaultUnitCost={row.cost_price}
                          pricingMode={row.pricing_mode}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/products/${row.id}`}
                          className={cn(
                            "inline-flex h-9 items-center justify-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-surface-hover",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring-offset)]",
                          )}
                        >
                          View
                        </Link>
                      </td>
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
