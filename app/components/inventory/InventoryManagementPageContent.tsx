"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, onSnapshot, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  filterLowStockProducts,
  type LowStockProductInput,
} from "@/lib/inventory/lowStock";
import type { ProductDoc } from "@/lib/types/firestore";
import { DiscardInventoryForm } from "@/app/components/inventory/DiscardInventoryForm";
import { InventoryDiscardList } from "@/app/components/inventory/InventoryDiscardList";
import { InventoryStockOperationsTab } from "@/app/components/inventory/InventoryStockOperationsTab";
import { PricingMarginPageContent } from "@/app/components/pricing/PricingMarginPageContent";
import { ProductStockInSummary } from "@/app/components/products/ProductStockInSummary";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { StatCard } from "@/app/components/ui/StatCard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";

type Tab = "overview" | "stock" | "discard" | "pricing";

const TAB_IDS: readonly Tab[] = ["overview", "stock", "discard", "pricing"];

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseTab(value: string | null): Tab {
  return TAB_IDS.includes(value as Tab) ? (value as Tab) : "overview";
}

type Row = ProductDoc & { id: string };

export function InventoryManagementPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = parseTab(searchParams.get("tab"));

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      query(collection(db, COLLECTIONS.products)),
      (snap) => {
        setError(null);
        setLoading(false);
        const next: Row[] = [];
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
    let valueAtSale = 0;
    for (const row of rows) {
      const stock = typeof row.stock_quantity === "number" ? row.stock_quantity : 0;
      const cost = typeof row.cost_price === "number" ? row.cost_price : 0;
      const sale = typeof row.sale_price === "number" ? row.sale_price : 0;
      units += stock;
      valueAtCost += cost * stock;
      valueAtSale += sale * stock;
    }
    const lowStockInputs: LowStockProductInput[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      stock_quantity: row.stock_quantity,
      cost_price: row.cost_price,
      sale_price: row.sale_price,
      pricing_mode: row.pricing_mode,
    }));
    const lowStockCount = filterLowStockProducts(
      lowStockInputs,
      DEFAULT_LOW_STOCK_THRESHOLD,
    ).length;
    return { units, valueAtCost, valueAtSale, lowStockCount };
  }, [rows]);

  const setTab = useCallback(
    (tab: Tab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "overview") params.delete("tab");
      else params.set("tab", tab);
      if (tab !== "stock") {
        params.delete("low");
        params.delete("threshold");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const goToLowStock = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "stock");
    params.set("low", "1");
    params.set("threshold", String(DEFAULT_LOW_STOCK_THRESHOLD));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "stock", label: "Stock" },
    { id: "discard", label: "Discard" },
    { id: "pricing", label: "Pricing" },
  ];

  return (
    <div className="space-y-8">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

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

      {activeTab === "overview" ? (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Units on hand" value={loading ? "…" : kpis.units.toLocaleString()} />
            <StatCard
              label="Inventory value (cost)"
              value={loading ? "…" : formatMoney(kpis.valueAtCost)}
              hint="Cost price × stock on hand"
            />
            <StatCard
              label="Inventory value (sale)"
              value={loading ? "…" : formatMoney(kpis.valueAtSale)}
              hint="Sale price × stock on hand"
            />
            <StatCard
              label="Low stock"
              value={loading ? "…" : kpis.lowStockCount.toLocaleString()}
              hint={
                kpis.lowStockCount > 0
                  ? `At or below ${DEFAULT_LOW_STOCK_THRESHOLD} units · click to review`
                  : "Nothing needs reordering"
              }
              onClick={goToLowStock}
              ariaLabel="Show low stock products"
            />
          </div>

          <ProductStockInSummary />

          <Card>
            <CardHeader>
              <CardTitle>Reports</CardTitle>
              <CardDescription>Deeper inventory analytics and FIFO costing.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Link
                href="/reports/purchases"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-surface-hover"
              >
                Purchase report
              </Link>
              <Link
                href="/reports/fifo"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-surface-hover"
              >
                FIFO reports
              </Link>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "stock" ? (
        <InventoryStockOperationsTab products={rows} loading={loading} />
      ) : null}

      {activeTab === "discard" ? (
        <div className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Discard items</CardTitle>
              <CardDescription>
                Write off damaged or failed QC items without an invoice. Stock is removed using FIFO
                costing and recorded as a COGS write-off. This cannot be undone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DiscardInventoryForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent discards</CardTitle>
              <CardDescription>Latest 50 stock write-offs, newest first.</CardDescription>
            </CardHeader>
            <CardContent>
              <InventoryDiscardList />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "pricing" ? <PricingMarginPageContent /> : null}
    </div>
  );
}
