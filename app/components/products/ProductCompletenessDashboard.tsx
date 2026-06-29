"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  getProductCompleteness,
  type ProductRow,
} from "@/lib/products/productCompleteness";
import type { ProductDoc } from "@/lib/types/firestore";
import { EditProductModal } from "@/app/components/products/EditProductModal";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

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

type AugmentedRow = ProductRow & { missing: string[]; complete: boolean };

function ProductTable({
  rows,
  onEdit,
}: {
  rows: AugmentedRow[];
  onEdit: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        No products in this group.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-3 py-2.5 font-semibold text-foreground">Image</th>
            <th className="px-3 py-2.5 font-semibold text-foreground">ID</th>
            <th className="px-3 py-2.5 font-semibold text-foreground">Name</th>
            <th className="px-3 py-2.5 font-semibold text-foreground">Category</th>
            <th className="px-3 py-2.5 font-semibold text-foreground">Cost</th>
            <th className="px-3 py-2.5 font-semibold text-foreground">Sale</th>
            <th className="px-3 py-2.5 font-semibold text-foreground">Stock</th>
            <th className="px-3 py-2.5 font-semibold text-foreground">Created</th>
            <th className="px-3 py-2.5 font-semibold text-foreground">Gaps</th>
            <th className="px-3 py-2.5 font-semibold text-foreground">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2 align-middle">
                {row.image_url ? (
                  <Image
                    src={row.image_url}
                    alt={row.name || "Product"}
                    width={48}
                    height={48}
                    className="h-12 w-12 rounded-md border border-border bg-surface-muted object-contain p-0.5"
                    unoptimized
                  />
                ) : row.image_path ? (
                  <span
                    className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-[10px] text-muted-foreground"
                    title={row.image_path}
                  >
                    File
                  </span>
                ) : (
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
                    None
                  </span>
                )}
              </td>
              <td className="px-3 py-2 align-middle font-mono text-xs text-muted-foreground">
                {row.id}
              </td>
              <td className="px-3 py-2 align-middle font-medium text-foreground">{row.name || "—"}</td>
              <td className="px-3 py-2 align-middle text-muted-foreground">{row.category?.trim() || "—"}</td>
              <td className="px-3 py-2 align-middle tabular-nums">
                {typeof row.cost_price === "number" ? formatMoney(row.cost_price) : "—"}
              </td>
              <td className="px-3 py-2 align-middle tabular-nums">
                {typeof row.sale_price === "number" ? formatMoney(row.sale_price) : "—"}
              </td>
              <td className="px-3 py-2 align-middle tabular-nums">
                {typeof row.stock_quantity === "number" ? row.stock_quantity : "—"}
              </td>
              <td className="px-3 py-2 align-middle text-xs text-muted-foreground whitespace-nowrap">
                {row.created_at && typeof row.created_at === "object" && "toDate" in row.created_at
                  ? formatDate(row.created_at as Timestamp)
                  : "—"}
              </td>
              <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                {row.complete ? (
                  <span className="text-emerald-700 dark:text-emerald-400">None</span>
                ) : (
                  <ul className="list-disc space-y-1 pl-4">
                    {row.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="px-3 py-2 align-middle whitespace-nowrap">
                <Button
                  type="button"
                  variant="outline"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => onEdit(row.id)}
                >
                  Edit
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ProductCompletenessDashboardProps = {
  /** "embedded" trims intro copy and hides the complete-records table (shown inside the Products hub). */
  variant?: "standalone" | "embedded";
};

export function ProductCompletenessDashboard({
  variant = "standalone",
}: ProductCompletenessDashboardProps = {}) {
  const embedded = variant === "embedded";
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);

  const editingRow = useMemo(
    () => (editingProductId ? (rows.find((r) => r.id === editingProductId) ?? null) : null),
    [rows, editingProductId],
  );

  useEffect(() => {
    const db = getDb();
    const q = query(collection(db, COLLECTIONS.products), orderBy("created_at", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setLoading(false);
        const next: ProductRow[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as ProductDoc;
          next.push({ id: docSnap.id, ...d });
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

  const augmented = useMemo(() => {
    return rows.map((r) => {
      const { complete, missing } = getProductCompleteness(r);
      return { ...r, complete, missing };
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return augmented;
    return augmented.filter((row) => {
      const name = (row.name ?? "").toLowerCase();
      const category = (row.category ?? "").toLowerCase();
      const id = row.id.toLowerCase();
      return name.includes(q) || category.includes(q) || id.includes(q);
    });
  }, [augmented, searchQuery]);

  const completeRows = useMemo(() => filtered.filter((r) => r.complete), [filtered]);
  const incompleteRows = useMemo(() => filtered.filter((r) => !r.complete), [filtered]);

  const searchId = "product-completeness-search";

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading products…
      </p>
    );
  }

  if (error) {
    return (
      <InlineAlert variant="error" className="text-sm">
        {error}
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-8">
      {editingRow ? (
        <EditProductModal
          key={editingRow.id}
          row={editingRow}
          onDismiss={() => setEditingProductId(null)}
        />
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-md flex-1">
          <Label htmlFor={searchId} className="text-sm text-foreground">
            Search
          </Label>
          <Input
            id={searchId}
            type="search"
            className="mt-1.5 h-10"
            placeholder="Name, category, or product ID"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            aria-describedby={`${searchId}-hint`}
          />
          <p id={`${searchId}-hint`} className="mt-1 text-[11px] text-muted-foreground">
            {filtered.length === rows.length
              ? `${rows.length} product${rows.length === 1 ? "" : "s"} loaded`
              : `Showing ${filtered.length} of ${rows.length} products`}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Use <span className="font-medium text-foreground">Edit</span> to fill missing fields, including uploading a
          product image.
          {!embedded
            ? " Uploads go through the same server flow as the Products page, including GCS when configured."
            : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Incomplete records</CardTitle>
          <CardDescription>
            {incompleteRows.length} product{incompleteRows.length === 1 ? "" : "s"} missing at least one catalog
            field (including image). Use the gaps column to see what to fix.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductTable rows={incompleteRows} onEdit={setEditingProductId} />
        </CardContent>
      </Card>

      {embedded ? (
        <p className="text-sm text-muted-foreground">
          {completeRows.length} product{completeRows.length === 1 ? "" : "s"} already complete.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Complete records</CardTitle>
            <CardDescription>
              {completeRows.length} product{completeRows.length === 1 ? "" : "s"} with name, category, valid prices and
              stock, created date, and an image URL or uploaded image path.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProductTable rows={completeRows} onEdit={setEditingProductId} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
