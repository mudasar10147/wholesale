"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { updateProductPricing } from "@/lib/firestore/pricing";
import {
  marginColorBand,
  marginColorClass,
  type EnrichedPricingRow,
} from "@/lib/pricing/metrics";
import { parseNonNegativeDecimal } from "@/lib/validation/numbers";
import { formatMoney, formatPercent } from "@/app/components/pricing/format";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { cn } from "@/lib/utils";

export type PricingSortKey =
  | "name"
  | "cost_price"
  | "sale_price"
  | "profitPerUnit"
  | "marginPercent"
  | "markupPercent"
  | "stock_quantity"
  | "inventoryValue"
  | "profitOnStock";

type PricingTableProps = {
  rows: EnrichedPricingRow[];
};

function profitOnStock(row: EnrichedPricingRow): number {
  return row.profitPerUnit * row.stock_quantity;
}

function PricingRow({ row }: { row: EnrichedPricingRow }) {
  const [saleInput, setSaleInput] = useState(() => String(row.sale_price));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const band = marginColorBand(row.marginPercent);

  useEffect(() => {
    setSaleInput(String(row.sale_price));
    setError(null);
  }, [row.id, row.sale_price]);

  async function handleSave() {
    setError(null);
    const parsed = parseNonNegativeDecimal(saleInput);
    if (!parsed.ok) {
      setError(parsed.message ?? "Invalid sale price.");
      return;
    }
    if (parsed.value === row.sale_price) {
      setError("No change to save.");
      return;
    }
    setPending(true);
    try {
      await updateProductPricing(getDb(), row.id, { sale_price: parsed.value });
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <tr className="border-b border-border/60 hover:bg-surface-hover/40">
      <td className="max-w-[180px] truncate px-3 py-2 font-medium">
        <Link href={`/products/${row.id}`} className="hover:underline">
          {row.name}
        </Link>
      </td>
      <td className="px-3 py-2 tabular-nums">{formatMoney(row.cost_price)}</td>
      <td className="px-3 py-2">
        <div className="flex min-w-[9rem] flex-col gap-1">
          <Input
            className="h-8 w-28 px-2 py-1 text-sm tabular-nums"
            inputMode="decimal"
            min={0}
            value={saleInput}
            onChange={(e) => setSaleInput(e.target.value)}
            aria-label={`Sale price for ${row.name}`}
          />
          {error ? (
            <span className="text-[10px] text-destructive" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2">
        <Button
          type="button"
          variant="outline"
          className="h-8 px-2 text-xs"
          disabled={pending}
          onClick={() => void handleSave()}
        >
          {pending ? "…" : "Save"}
        </Button>
      </td>
      <td className="px-3 py-2 tabular-nums">{formatMoney(row.profitPerUnit)}</td>
      <td className={cn("px-3 py-2 tabular-nums", marginColorClass(band))}>
        {formatPercent(row.marginPercent)}
      </td>
      <td className="px-3 py-2 tabular-nums">{formatPercent(row.markupPercent)}</td>
      <td className="px-3 py-2 tabular-nums">{row.stock_quantity.toLocaleString()}</td>
      <td className="px-3 py-2 tabular-nums">{formatMoney(row.inventoryValue)}</td>
      <td className="px-3 py-2 tabular-nums">{formatMoney(profitOnStock(row))}</td>
    </tr>
  );
}

function groupRowsByCategory(rows: EnrichedPricingRow[]): Array<{ label: string; rows: EnrichedPricingRow[] }> {
  const map = new Map<string, EnrichedPricingRow[]>();
  for (const row of rows) {
    const label = row.category?.trim() || "Uncategorized";
    const list = map.get(label);
    if (list) list.push(row);
    else map.set(label, [row]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === "Uncategorized") return 1;
      if (b === "Uncategorized") return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    })
    .map(([label, groupRows]) => ({
      label,
      rows: sortPricingRows(groupRows, "name", "asc"),
    }));
}

export function PricingTable({ rows }: PricingTableProps) {
  const groups = useMemo(() => groupRowsByCategory(rows), [rows]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No products match the current filters.</p>;
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Cost</th>
                  <th className="px-3 py-2 font-semibold">Sale price</th>
                  <th className="px-3 py-2 font-semibold"> </th>
                  <th className="px-3 py-2 font-semibold">Profit/unit</th>
                  <th className="px-3 py-2 font-semibold">Margin %</th>
                  <th className="px-3 py-2 font-semibold">Markup %</th>
                  <th className="px-3 py-2 font-semibold">Stock</th>
                  <th className="px-3 py-2 font-semibold">Inv. value</th>
                  <th className="px-3 py-2 font-semibold">Profit on stock</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <PricingRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
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
      case "profitOnStock":
        av = profitOnStock(a);
        bv = profitOnStock(b);
        break;
    }
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * dir;
    }
    return ((av as number) - (bv as number)) * dir;
  });
}
