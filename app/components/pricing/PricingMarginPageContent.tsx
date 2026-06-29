"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  enrichPricingRow,
  profitPerUnit,
  type EnrichedPricingRow,
  type PricingProductRow,
} from "@/lib/pricing/metrics";
import type { ProductDoc } from "@/lib/types/firestore";
import {
  defaultPricingFilters,
  PricingFilters,
  type PricingFilterState,
} from "@/app/components/pricing/PricingFilters";
import {
  PricingSummaryCards,
  type SimplePricingSummary,
} from "@/app/components/pricing/PricingSummaryCards";
import { PricingTable } from "@/app/components/pricing/PricingTable";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

type Row = ProductDoc & { id: string };

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function applyFilters(
  rows: EnrichedPricingRow[],
  filters: PricingFilterState,
  debouncedSearch: string,
): EnrichedPricingRow[] {
  const q = debouncedSearch.trim().toLowerCase();
  return rows.filter((row) => {
    if (q) {
      const name = row.name.toLowerCase();
      const cat = (row.category ?? "").toLowerCase();
      if (!name.includes(q) && !cat.includes(q)) return false;
    }
    if (filters.category && (row.category ?? "") !== filters.category) return false;
    return true;
  });
}

function buildSummary(rows: EnrichedPricingRow[]): SimplePricingSummary {
  const margins = rows
    .map((r) => r.marginPercent)
    .filter((m): m is number => m !== null && Number.isFinite(m));

  return {
    totalProducts: rows.length,
    totalUnits: rows.reduce((sum, r) => sum + r.stock_quantity, 0),
    inventoryValueAtCost: rows.reduce((sum, r) => sum + r.inventoryValue, 0),
    inventoryValueAtSale: rows.reduce((sum, r) => sum + r.sale_price * r.stock_quantity, 0),
    profitOnStock: rows.reduce((sum, r) => sum + profitPerUnit(r.sale_price, r.cost_price) * r.stock_quantity, 0),
    averageMarginPercent:
      margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : null,
  };
}

export function PricingMarginPageContent() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<PricingFilterState>(defaultPricingFilters);

  const debouncedSearch = useDebouncedValue(filters.search, 200);

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
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  const enriched = useMemo(
    () => rows.map((r) => enrichPricingRow(r as PricingProductRow, {}, 15)),
    [rows],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const c = r.category?.trim();
      if (c) set.add(c);
    });
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows]);

  const filtered = useMemo(
    () => applyFilters(enriched, filters, debouncedSearch),
    [enriched, filters, debouncedSearch],
  );

  const summary = useMemo(() => buildSummary(filtered), [filtered]);

  return (
    <div className="space-y-8">
      {error ? (
        <InlineAlert variant="error" className="text-sm">
          {error}
        </InlineAlert>
      ) : null}

      <PricingSummaryCards summary={summary} loading={loading} />

      <Card>
        <CardHeader>
          <CardTitle>Product pricing</CardTitle>
          <CardDescription>
            Set sale prices manually. Cost comes from stock purchases; margin, markup, and profit on
            stock update when you save a new sale price.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PricingFilters filters={filters} categories={categories} onChange={setFilters} />
          {loading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading products…
            </p>
          ) : (
            <PricingTable rows={filtered} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
