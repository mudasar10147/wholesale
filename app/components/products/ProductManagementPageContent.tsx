"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, onSnapshot, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { getProductCompleteness, type ProductRow } from "@/lib/products/productCompleteness";
import type { ProductDoc } from "@/lib/types/firestore";
import { AddProductModal } from "@/app/components/products/AddProductModal";
import { ProductCompletenessDashboard } from "@/app/components/products/ProductCompletenessDashboard";
import { ProductList } from "@/app/components/products/ProductList";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { StatCard } from "@/app/components/ui/StatCard";
import { Card, CardContent } from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";

type Tab = "all" | "completeness";

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseTab(value: string | null): Tab {
  return value === "completeness" ? "completeness" : "all";
}

export function ProductManagementPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = parseTab(searchParams.get("tab"));

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      query(collection(db, COLLECTIONS.products)),
      (snap) => {
        setError(null);
        setLoading(false);
        const next: ProductRow[] = [];
        snap.forEach((docSnap) => next.push({ id: docSnap.id, ...(docSnap.data() as ProductDoc) }));
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  const kpis = useMemo(() => {
    let units = 0;
    let valueAtCost = 0;
    let incomplete = 0;
    for (const row of rows) {
      const stock = typeof row.stock_quantity === "number" ? row.stock_quantity : 0;
      const cost = typeof row.cost_price === "number" ? row.cost_price : 0;
      units += stock;
      valueAtCost += cost * stock;
      if (!getProductCompleteness(row).complete) incomplete += 1;
    }
    return { total: rows.length, units, valueAtCost, incomplete };
  }, [rows]);

  const setTab = useCallback(
    (tab: Tab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "all") params.delete("tab");
      else params.set("tab", tab);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: "All products" },
    {
      id: "completeness",
      label: kpis.incomplete > 0 ? `Catalog completeness (${kpis.incomplete})` : "Catalog completeness",
    },
  ];

  return (
    <div className="space-y-8">
      {addOpen ? <AddProductModal onDismiss={() => setAddOpen(false)} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Browse and edit your catalog. Click any product to see its full details, purchases, and sales.
        </p>
        <Button type="button" variant="primary" className="shrink-0" onClick={() => setAddOpen(true)}>
          Add product
        </Button>
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total products" value={loading ? "…" : kpis.total.toLocaleString()} />
        <StatCard label="Units on hand" value={loading ? "…" : kpis.units.toLocaleString()} />
        <StatCard
          label="Inventory value (cost)"
          value={loading ? "…" : formatMoney(kpis.valueAtCost)}
          hint="Cost price × stock on hand"
        />
        <StatCard
          label="Incomplete catalog"
          value={loading ? "…" : kpis.incomplete.toLocaleString()}
          hint={kpis.incomplete > 0 ? "Click to review and fix" : "All products complete"}
          onClick={() => setTab("completeness")}
          ariaLabel="Show products with incomplete catalog details"
        />
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-muted p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "all" ? (
        <Card>
          <CardContent>
            <ProductList />
          </CardContent>
        </Card>
      ) : (
        <ProductCompletenessDashboard variant="embedded" />
      )}
    </div>
  );
}
