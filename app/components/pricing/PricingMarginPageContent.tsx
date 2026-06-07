"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { loadPricingSettings, type PricingSettingsData } from "@/lib/firestore/pricingSettings";
import {
  aggregatePricingSummary,
  enrichPricingRow,
  type EnrichedPricingRow,
  type PricingProductRow,
} from "@/lib/pricing/metrics";
import type { ProductDoc } from "@/lib/types/firestore";
import { BelowTargetAnalytics } from "@/app/components/pricing/BelowTargetAnalytics";
import { CategoryMarginTemplates } from "@/app/components/pricing/CategoryMarginTemplates";
import {
  defaultPricingFilters,
  PricingFilters,
  type PricingFilterState,
} from "@/app/components/pricing/PricingFilters";
import { PricingSummaryCards } from "@/app/components/pricing/PricingSummaryCards";
import {
  PricingTable,
  sortPricingRows,
  type PricingSortKey,
} from "@/app/components/pricing/PricingTable";
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
  const marginMin = filters.marginMin.trim() !== "" ? Number(filters.marginMin) : null;
  const marginMax = filters.marginMax.trim() !== "" ? Number(filters.marginMax) : null;

  return rows.filter((row) => {
    if (q) {
      const name = row.name.toLowerCase();
      const cat = (row.category ?? "").toLowerCase();
      if (!name.includes(q) && !cat.includes(q)) return false;
    }
    if (filters.category && (row.category ?? "") !== filters.category) return false;
    if (marginMin !== null && Number.isFinite(marginMin)) {
      if (row.marginPercent === null || row.marginPercent < marginMin) return false;
    }
    if (marginMax !== null && Number.isFinite(marginMax)) {
      if (row.marginPercent === null || row.marginPercent > marginMax) return false;
    }
    if (filters.lowMarginOnly && !row.isLowMargin) return false;
    if (filters.outOfStockOnly && !row.isOutOfStock) return false;
    if (filters.belowTargetOnly && !row.isBelowTarget) return false;
    return true;
  });
}

export function PricingMarginPageContent() {
  const [rows, setRows] = useState<Row[]>([]);
  const [settings, setSettings] = useState<PricingSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<PricingFilterState>(defaultPricingFilters);
  const [sortKey, setSortKey] = useState<PricingSortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const debouncedSearch = useDebouncedValue(filters.search, 200);

  useEffect(() => {
    void loadPricingSettings(getDb())
      .then(setSettings)
      .catch((e) => setError(getFirestoreUserMessage(e)));
  }, []);

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

  const globalDefault = settings?.globalDefaultTargetMarginPercent ?? 15;
  const categoryTemplates = settings?.categoryTemplates ?? {};

  const enriched = useMemo(
    () => rows.map((r) => enrichPricingRow(r, categoryTemplates, globalDefault)),
    [rows, categoryTemplates, globalDefault],
  );

  const summary = useMemo(
    () => aggregatePricingSummary(rows, globalDefault, categoryTemplates),
    [rows, globalDefault, categoryTemplates],
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

  const sorted = useMemo(
    () => sortPricingRows(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );

  useEffect(() => {
    setPage(1);
  }, [filters, debouncedSearch, sortKey, sortDir, pageSize]);

  function handleSort(key: PricingSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function handleBelowTargetClick() {
    setFilters((f) => ({ ...f, belowTargetOnly: true }));
  }

  return (
    <div className="space-y-8">
      {error ? (
        <InlineAlert variant="error" className="text-sm">
          {error}
        </InlineAlert>
      ) : null}

      <PricingSummaryCards
        summary={summary}
        loading={loading}
        onBelowTargetClick={handleBelowTargetClick}
      />

      <Card>
        <CardHeader>
          <CardTitle>Below target margin</CardTitle>
          <CardDescription>
            Products selling below their effective target margin and estimated profit left on the
            shelf.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <BelowTargetAnalytics rows={enriched} />
          )}
        </CardContent>
      </Card>

      <CategoryMarginTemplates
        settings={settings}
        knownCategories={categories}
        onSettingsChange={setSettings}
      />

      <Card>
        <CardHeader>
          <CardTitle>Product pricing</CardTitle>
          <CardDescription>
            Sort, filter, and bulk-update margins. Automatic mode recalculates sale price when cost
            or target margin changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PricingFilters filters={filters} categories={categories} onChange={setFilters} />
          {loading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading products…
            </p>
          ) : (
            <PricingTable
              rows={sorted}
              page={page}
              pageSize={pageSize}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
