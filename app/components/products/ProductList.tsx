"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import Image from "next/image";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { updateProductDetails } from "@/lib/firestore/products";
import type { ProductDoc } from "@/lib/types/firestore";
import { deleteProductImageByPath, uploadProductImage } from "@/lib/upload/productImages";
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

function EditProductModal({ row, onDismiss }: { row: Row; onDismiss: () => void }) {
  const [name, setName] = useState(row.name);
  const [category, setCategory] = useState(row.category ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setPending(true);
    try {
      if (imageFile) {
        const uploaded = await uploadProductImage(imageFile);
        const oldPath = row.image_path?.trim();
        if (oldPath) {
          void deleteProductImageByPath(oldPath);
        }
        await updateProductDetails(getDb(), row.id, {
          name: trimmed,
          category,
          image: {
            action: "replace",
            file: {
              path: uploaded.path,
              mimeType: uploaded.mimeType,
              size: uploaded.size,
              previewUrl: uploaded.url,
            },
          },
        });
      } else if (removeImage) {
        const oldPath = row.image_path?.trim();
        if (oldPath) {
          void deleteProductImageByPath(oldPath);
        }
        await updateProductDetails(getDb(), row.id, {
          name: trimmed,
          category,
          image: { action: "remove" },
        });
      } else {
        await updateProductDetails(getDb(), row.id, {
          name: trimmed,
          category,
          image: { action: "keep" },
        });
      }
      onDismiss();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="edit-product-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-product-title" className="text-lg font-semibold text-foreground">
          Edit product
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Name, category, and product image.</p>
        <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="edit-product-name">Name</Label>
            <Input
              id="edit-product-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              aria-invalid={error === "Name is required."}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-product-category">Category (optional)</Label>
            <Input
              id="edit-product-category"
              autoComplete="off"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Grains"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-product-image">Replace image (optional)</Label>
            <Input
              id="edit-product-image"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              onChange={(e) => {
                setImageFile(e.target.files?.[0] ?? null);
                if (e.target.files?.[0]) setRemoveImage(false);
              }}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={removeImage}
                onChange={(e) => {
                  const next = e.target.checked;
                  setRemoveImage(next);
                  if (next) setImageFile(null);
                }}
              />
              Remove existing image
            </label>
            {row.image_url ? (
              <Image
                src={row.image_url}
                alt={row.name}
                width={56}
                height={56}
                className="h-14 w-14 rounded-md border border-border bg-surface-muted object-contain p-1"
                unoptimized
              />
            ) : null}
          </div>
          {error ? (
            <InlineAlert variant="error" className="text-sm">
              {error}
            </InlineAlert>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
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
          <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
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
