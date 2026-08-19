"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useProducts } from "@/lib/firestore/referenceData";
import { partitionProducts } from "@/lib/products/archive";
import { getProductCompleteness, type ProductRow } from "@/lib/products/productCompleteness";
import { AddProductModal } from "@/app/components/products/AddProductModal";
import { ProductCompletenessDashboard } from "@/app/components/products/ProductCompletenessDashboard";
import { ProductList } from "@/app/components/products/ProductList";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { StatCard } from "@/app/components/ui/StatCard";
import { Card, CardContent } from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";

type Tab = "all" | "archived" | "completeness";

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseTab(value: string | null): Tab {
  if (value === "completeness") return "completeness";
  if (value === "archived") return "archived";
  return "all";
}

export function ProductManagementPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = parseTab(searchParams.get("tab"));

  // One shared read for the whole page — the list and completeness tabs read the
  // same store rather than each opening their own listener.
  const { rows: productRows, loading, error } = useProducts();
  const [addOpen, setAddOpen] = useState(false);

  const kpis = useMemo(() => {
    const all: ProductRow[] = productRows.map(({ id, data }) => ({ id, ...data }));
    const { active, archived } = partitionProducts(all);
    let units = 0;
    let valueAtCost = 0;
    let incomplete = 0;
    // Every headline figure counts active products only — archiving a product is
    // what takes its stock out of the catalog's value.
    for (const row of active) {
      const stock = typeof row.stock_quantity === "number" ? row.stock_quantity : 0;
      const cost = typeof row.cost_price === "number" ? row.cost_price : 0;
      units += stock;
      valueAtCost += cost * stock;
      if (!getProductCompleteness(row).complete) incomplete += 1;
    }
    return { total: active.length, units, valueAtCost, incomplete, archived: archived.length };
  }, [productRows]);

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
    { id: "archived", label: kpis.archived > 0 ? `Archived (${kpis.archived})` : "Archived" },
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

      {activeTab === "completeness" ? (
        <ProductCompletenessDashboard variant="embedded" />
      ) : (
        <Card>
          <CardContent>
            {activeTab === "archived" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Archived products are hidden from pickers, catalogs, dashboards and stock
                  valuation. Their history is kept, so old invoices and ledger records still
                  show them. Restore puts a product back everywhere.
                </p>
                <ProductList scope="archived" />
              </div>
            ) : (
              <ProductList />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
