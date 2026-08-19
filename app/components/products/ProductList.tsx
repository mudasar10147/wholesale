"use client";

import { useMemo, useState } from "react";
import { type Timestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { archiveProduct, restoreProduct } from "@/lib/firestore/products";
import { useProducts } from "@/lib/firestore/referenceData";
import { archiveConfirmMessage, isProductArchived, partitionProducts } from "@/lib/products/archive";
import type { ProductDoc } from "@/lib/types/firestore";
import { ArchivedBadge } from "@/app/components/products/ArchivedBadge";
import { EditProductModal } from "@/app/components/products/EditProductModal";
import { NewArrivalBadge } from "@/app/components/products/NewArrivalBadge";
import { OfferPriceText } from "@/app/components/pricing/OfferPriceText";
import { useLiveOffers } from "@/lib/firestore/liveOffers";
import { useNewArrivalSettings } from "@/lib/firestore/newArrivalSettings";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

type Row = ProductDoc & { id: string };

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(ts: Timestamp) {
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

export function ProductList({ scope = "active" }: { scope?: "active" | "archived" }) {
  const router = useRouter();
  const { settings: newArrivalSettings } = useNewArrivalSettings();
  const { index: offerIndex } = useLiveOffers();
  const { rows: productRows, loading, error: loadError } = useProducts();
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const showingArchived = scope === "archived";

  const rows = useMemo(() => {
    const all = productRows.map(({ id, data }) => ({ id, ...data }));
    const { active, archived } = partitionProducts(all);
    const scoped = showingArchived ? archived : active;
    // The old query ordered by created_at desc; the shared store is unordered, so
    // the sort moves here rather than costing another read of the collection.
    return scoped.sort(
      (a, b) => (b.created_at?.toMillis?.() ?? 0) - (a.created_at?.toMillis?.() ?? 0),
    );
  }, [productRows, showingArchived]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const name = row.name.toLowerCase();
      const category = (row.category ?? "").toLowerCase();
      return name.includes(q) || category.includes(q);
    });
  }, [rows, searchQuery]);

  async function handleArchiveToggle(row: Row) {
    const archived = isProductArchived(row);
    if (!archived && !window.confirm(archiveConfirmMessage(row))) return;

    setActionError(null);
    setPendingId(row.id);
    try {
      if (archived) await restoreProduct(getDb(), row.id);
      else await archiveProduct(getDb(), row.id);
    } catch (err) {
      setActionError(getFirestoreUserMessage(err));
    } finally {
      setPendingId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading products…
      </p>
    );
  }

  if (loadError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {loadError}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {showingArchived
          ? "No archived products. Archiving retires a product from pickers and dashboards while keeping its history."
          : "No products yet. Use Add product to create your first one."}
      </p>
    );
  }

  const searchId = `product-list-search-${scope}`;

  return (
    <>
      {editingRow ? (
        <EditProductModal key={editingRow.id} row={editingRow} onDismiss={() => setEditingRow(null)} />
      ) : null}
      <div className="space-y-3">
        {actionError ? <InlineAlert variant="error">{actionError}</InlineAlert> : null}
        <div className="max-w-md">
          <Label htmlFor={searchId} className="text-sm text-foreground">
            {showingArchived ? "Search archived products" : "Search products"}
          </Label>
          <Input
            id={searchId}
            type="search"
            className="mt-1.5 h-10"
            placeholder="Name or category"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            aria-describedby={`${searchId}-hint`}
          />
          <p id={`${searchId}-hint`} className="mt-1 text-[11px] text-muted-foreground">
            {filteredRows.length === rows.length
              ? `${rows.length} product${rows.length === 1 ? "" : "s"}`
              : `Showing ${filteredRows.length} of ${rows.length}`}
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-3 font-semibold text-foreground">Name</th>
                <th className="px-4 py-3 font-semibold text-foreground">Category</th>
                <th className="px-4 py-3 font-semibold text-foreground">Cost</th>
                <th className="px-4 py-3 font-semibold text-foreground">Sale</th>
                <th className="px-4 py-3 font-semibold text-foreground">Stock</th>
                <th className="px-4 py-3 font-semibold text-foreground">Added</th>
                <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    {`No products match “${searchQuery.trim()}”. Try another search.`}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, i) => (
                  <tr
                    key={row.id}
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(`/products/${row.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/products/${row.id}`);
                      }
                    }}
                    className={cn(
                      "cursor-pointer border-b border-border last:border-b-0 transition-colors hover:bg-surface-hover",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      <span className="flex items-center gap-2">
                        {row.name}
                        <NewArrivalBadge
                          createdAt={row.created_at}
                          thresholdDays={newArrivalSettings.thresholdDays}
                        />
                        <ArchivedBadge product={row} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.category ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.cost_price)}</td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      <OfferPriceText
                        price={offerIndex.price({
                          id: row.id,
                          salePrice: row.sale_price,
                          createdAt: row.created_at,
                        })}
                        format={formatMoney}
                      />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {row.stock_quantity.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 px-3 py-1.5 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingRow(row);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant={showingArchived ? "outline" : "destructive"}
                          className="h-9 px-3 py-1.5 text-xs"
                          disabled={pendingId === row.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleArchiveToggle(row);
                          }}
                        >
                          {pendingId === row.id
                            ? showingArchived
                              ? "Restoring…"
                              : "Archiving…"
                            : showingArchived
                              ? "Restore"
                              : "Archive"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
