"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  bulkRecalculateSalePrices,
  bulkSetPricingMode,
  bulkUpdateTargetMargin,
} from "@/lib/firestore/pricing";
import {
  marginColorBand,
  marginColorClass,
  type EnrichedPricingRow,
} from "@/lib/pricing/metrics";
import type { PricingMode } from "@/lib/types/firestore";
import { EditPricingModal } from "@/app/components/pricing/EditPricingModal";
import { formatDate, formatMoney, formatPercent } from "@/app/components/pricing/format";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";
import { cn } from "@/lib/utils";

export type PricingSortKey =
  | "name"
  | "category"
  | "cost_price"
  | "sale_price"
  | "profitPerUnit"
  | "marginPercent"
  | "markupPercent"
  | "stock_quantity"
  | "inventoryValue"
  | "effectiveTargetMarginPercent"
  | "potentialProfitLost"
  | "lastUpdated";

type PricingTableProps = {
  rows: EnrichedPricingRow[];
  page: number;
  pageSize: number;
  sortKey: PricingSortKey;
  sortDir: "asc" | "desc";
  onSort: (key: PricingSortKey) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100];

function SortHeader({
  label,
  sortKey,
  activeKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  sortKey: PricingSortKey;
  activeKey: PricingSortKey;
  sortDir: "asc" | "desc";
  onSort: (key: PricingSortKey) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={cn("px-3 py-2 font-semibold", className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-left hover:text-foreground"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
}

function MobilePricingCard({
  row,
  selected,
  onToggle,
  onEdit,
}: {
  row: EnrichedPricingRow;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const band = marginColorBand(row.marginPercent);
  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${row.name}`}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <Link href={`/products/${row.id}`} className="font-medium text-foreground hover:underline">
            {row.name}
          </Link>
          <p className="text-xs text-muted-foreground">{row.category ?? "—"}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Cost</dt>
              <dd className="tabular-nums">{formatMoney(row.cost_price)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sale</dt>
              <dd className="tabular-nums">{formatMoney(row.sale_price)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Margin</dt>
              <dd className={cn("tabular-nums", marginColorClass(band))}>
                {formatPercent(row.marginPercent)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Stock</dt>
              <dd className="tabular-nums">{row.stock_quantity.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Target</dt>
              <dd className="tabular-nums">{row.effectiveTargetMarginPercent.toFixed(1)}%</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Profit lost</dt>
              <dd className="tabular-nums">{formatMoney(row.potentialProfitLost)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" className="h-8 px-2 text-xs" onClick={onEdit}>
              Edit pricing
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function PricingTable({
  rows,
  page,
  pageSize,
  sortKey,
  sortDir,
  onSort,
  onPageChange,
  onPageSizeChange,
}: PricingTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EnrichedPricingRow | null>(null);
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkMode, setBulkMode] = useState<PricingMode>("automatic");
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);

  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  function toggleAllPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageRows.forEach((r) => next.delete(r.id));
      } else {
        pageRows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(action: "margin" | "mode" | "recalc") {
    setBulkError(null);
    const ids = [...selected];
    if (ids.length === 0) {
      setBulkError("Select at least one product.");
      return;
    }
    setBulkPending(true);
    try {
      if (action === "margin") {
        const t = Number(bulkTarget);
        if (!Number.isFinite(t)) throw new Error("Enter a valid target margin.");
        await bulkUpdateTargetMargin(getDb(), ids, t);
      } else if (action === "mode") {
        await bulkSetPricingMode(getDb(), ids, bulkMode);
      } else {
        await bulkRecalculateSalePrices(getDb(), ids);
      }
      setSelected(new Set());
    } catch (e) {
      setBulkError(getFirestoreUserMessage(e));
    } finally {
      setBulkPending(false);
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No products match the current filters.</p>;
  }

  return (
    <>
      {editing ? (
        <EditPricingModal
          row={editing}
          onDismiss={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : null}

      {selected.size > 0 ? (
        <div className="sticky top-0 z-10 mb-4 space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card">
          <p className="text-sm font-medium text-foreground">{selected.size} selected</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="bulk-target">Bulk target margin %</Label>
              <Input
                id="bulk-target"
                className="w-28"
                inputMode="decimal"
                value={bulkTarget}
                onChange={(e) => setBulkTarget(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={bulkPending}
              onClick={() => void runBulk("margin")}
            >
              Apply target
            </Button>
            <div className="space-y-1">
              <Label htmlFor="bulk-mode">Bulk mode</Label>
              <Select
                id="bulk-mode"
                className="w-36"
                value={bulkMode}
                onChange={(e) => setBulkMode(e.target.value as PricingMode)}
              >
                <option value="manual">Manual</option>
                <option value="automatic">Automatic</option>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={bulkPending}
              onClick={() => void runBulk("mode")}
            >
              Apply mode
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={bulkPending}
              onClick={() => void runBulk("recalc")}
            >
              Recalculate prices
            </Button>
          </div>
          {bulkError ? (
            <InlineAlert variant="error" className="text-sm">
              {bulkError}
            </InlineAlert>
          ) : null}
        </div>
      ) : null}

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1200px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleAllPage}
                  aria-label="Select all on page"
                />
              </th>
              <SortHeader label="Product" sortKey="name" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Category" sortKey="category" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Cost" sortKey="cost_price" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Sale" sortKey="sale_price" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Profit/unit" sortKey="profitPerUnit" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Margin %" sortKey="marginPercent" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Markup %" sortKey="markupPercent" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Stock" sortKey="stock_quantity" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Inv. value" sortKey="inventoryValue" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Target %" sortKey="effectiveTargetMarginPercent" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Profit lost" sortKey="potentialProfitLost" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Updated" sortKey="lastUpdated" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <th className="px-3 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const band = marginColorBand(row.marginPercent);
              const lastTs = row.pricing_updated_at ?? row.created_at;
              return (
                <tr key={row.id} className="border-b border-border/60 hover:bg-surface-hover/40">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`Select ${row.name}`}
                    />
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2 font-medium">
                    <Link href={`/products/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.category ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{formatMoney(row.cost_price)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatMoney(row.sale_price)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatMoney(row.profitPerUnit)}</td>
                  <td className={cn("px-3 py-2 tabular-nums", marginColorClass(band))}>
                    {formatPercent(row.marginPercent)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatPercent(row.markupPercent)}</td>
                  <td className="px-3 py-2 tabular-nums">{row.stock_quantity.toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums">{formatMoney(row.inventoryValue)}</td>
                  <td className="px-3 py-2 tabular-nums">{row.effectiveTargetMarginPercent.toFixed(1)}%</td>
                  <td className="px-3 py-2 tabular-nums">{formatMoney(row.potentialProfitLost)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {formatDate(lastTs)}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() => setEditing(row)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {pageRows.map((row) => (
          <MobilePricingCard
            key={row.id}
            row={row}
            selected={selected.has(row.id)}
            onToggle={() => toggleRow(row.id)}
            onEdit={() => setEditing(row)}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, rows.length)} of{" "}
          {rows.length}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="page-size" className="sr-only">
            Page size
          </Label>
          <Select
            id="page-size"
            className="w-auto"
            value={String(pageSize)}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            className="h-9 px-3"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
          >
            Previous
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            Page {safePage} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-9 px-3"
            disabled={safePage >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
export function sortPricingRows(
  rows: EnrichedPricingRow[],
  sortKey: PricingSortKey,
  sortDir: "asc" | "desc",
): EnrichedPricingRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av: string | number = 0;
    let bv: string | number = 0;
    switch (sortKey) {
      case "name":
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
        break;
      case "category":
        av = (a.category ?? "").toLowerCase();
        bv = (b.category ?? "").toLowerCase();
        break;
      case "cost_price":
        av = a.cost_price;
        bv = b.cost_price;
        break;
      case "sale_price":
        av = a.sale_price;
        bv = b.sale_price;
        break;
      case "profitPerUnit":
        av = a.profitPerUnit;
        bv = b.profitPerUnit;
        break;
      case "marginPercent":
        av = a.marginPercent ?? -Infinity;
        bv = b.marginPercent ?? -Infinity;
        break;
      case "markupPercent":
        av = a.markupPercent ?? -Infinity;
        bv = b.markupPercent ?? -Infinity;
        break;
      case "stock_quantity":
        av = a.stock_quantity;
        bv = b.stock_quantity;
        break;
      case "inventoryValue":
        av = a.inventoryValue;
        bv = b.inventoryValue;
        break;
      case "effectiveTargetMarginPercent":
        av = a.effectiveTargetMarginPercent;
        bv = b.effectiveTargetMarginPercent;
        break;
      case "potentialProfitLost":
        av = a.potentialProfitLost;
        bv = b.potentialProfitLost;
        break;
      case "lastUpdated": {
        const am = a.pricing_updated_at?.toMillis?.() ?? a.created_at?.toMillis?.() ?? 0;
        const bm = b.pricing_updated_at?.toMillis?.() ?? b.created_at?.toMillis?.() ?? 0;
        av = am;
        bv = bm;
        break;
      }
    }
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * dir;
    }
    return ((av as number) - (bv as number)) * dir;
  });
}

