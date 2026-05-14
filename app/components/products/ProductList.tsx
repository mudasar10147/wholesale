"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import Link from "next/link";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ProductDoc } from "@/lib/types/firestore";
import { EditProductModal } from "@/app/components/products/EditProductModal";
import { ProductLotsModal } from "@/app/components/products/ProductLotsModal";
import { StockAdjustControls } from "@/app/components/products/StockAdjustControls";
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

export function ProductList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [lotsModalProductId, setLotsModalProductId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const lotsModalRow = lotsModalProductId
    ? (rows.find((r) => r.id === lotsModalProductId) ?? null)
    : null;

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const name = row.name.toLowerCase();
      const category = (row.category ?? "").toLowerCase();
      return name.includes(q) || category.includes(q);
    });
  }, [rows, searchQuery]);

  useEffect(() => {
    const db = getDb();
    const q = query(collection(db, COLLECTIONS.products), orderBy("created_at", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setLoading(false);
        const next: Row[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as ProductDoc;
          next.push({ id: docSnap.id, ...d });
        });
        setRows(next);
        setLotsModalProductId((openId) =>
          openId && !next.some((r) => r.id === openId) ? null : openId,
        );
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );

    return () => unsub();
  }, []);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading products…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No products yet. Add one using the form above.
      </p>
    );
  }

  const searchId = "product-list-search";

  return (
    <>
      {editingRow ? (
        <EditProductModal key={editingRow.id} row={editingRow} onDismiss={() => setEditingRow(null)} />
      ) : null}
      {lotsModalRow ? (
        <ProductLotsModal
          key={lotsModalRow.id}
          row={lotsModalRow}
          onDismiss={() => setLotsModalProductId(null)}
        />
      ) : null}
      <div className="space-y-3">
        <div className="max-w-md">
          <Label htmlFor={searchId} className="text-sm text-foreground">
            Search products
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
          <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-3 font-semibold text-foreground">Name</th>
                <th className="px-4 py-3 font-semibold text-foreground">Category</th>
                <th className="px-4 py-3 font-semibold text-foreground">Cost</th>
                <th className="px-4 py-3 font-semibold text-foreground">Sale</th>
                <th className="px-4 py-3 font-semibold text-foreground">Stock</th>
                <th className="px-4 py-3 font-semibold text-foreground">Inventory</th>
                <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
                <th className="px-4 py-3 font-semibold text-foreground">Added</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    {`No products match “${searchQuery.trim()}”. Try another search.`}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.category ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.cost_price)}</td>
                    <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.sale_price)}</td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {row.stock_quantity.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StockAdjustControls
                        productId={row.id}
                        currentStock={row.stock_quantity}
                        defaultUnitCost={row.cost_price}
                      />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        <Link
                          href={`/products/${row.id}`}
                          className={cn(
                            "inline-flex h-9 items-center justify-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-surface-hover",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring-offset)]",
                          )}
                        >
                          View
                        </Link>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 px-3 py-1.5 text-xs"
                          onClick={() => setLotsModalProductId(row.id)}
                        >
                          Lots
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 px-3 py-1.5 text-xs"
                          onClick={() => setEditingRow(row)}
                        >
                          Edit
                        </Button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(row.created_at)}</td>
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
