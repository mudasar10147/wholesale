"use client";

import { type FormEvent, useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { updateProductDetails, updateProductSalePrice } from "@/lib/firestore/products";
import type { ProductDoc } from "@/lib/types/firestore";
import { parseNonNegativeDecimal } from "@/lib/validation/numbers";
import { discardUploadedImage, uploadProductImage } from "@/lib/upload/productImages";
import { ProductImage } from "@/app/components/products/ProductImage";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

export type ProductEditRow = ProductDoc & { id: string };

export function EditProductModal({ row, onDismiss }: { row: ProductEditRow; onDismiss: () => void }) {
  const [name, setName] = useState(row.name);
  const [category, setCategory] = useState(row.category ?? "");
  const [salePrice, setSalePrice] = useState(
    typeof row.sale_price === "number" ? String(row.sale_price) : "",
  );
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
    const sale = parseNonNegativeDecimal(salePrice);
    if (!sale.ok) {
      setError(sale.message ?? "Sale price must be zero or greater.");
      return;
    }
    setPending(true);
    // Deleting the old photo before the record is saved leaves the product pointing at a
    // file that no longer exists if the save then fails. Nothing is deleted until the
    // write has committed; if it does not, the new upload is cleaned up instead.
    const previousPath = row.image_path?.trim();
    let uploadedPath: string | undefined;
    let committed = false;
    try {
      if (imageFile) {
        const uploaded = await uploadProductImage(imageFile);
        uploadedPath = uploaded.path;
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
        committed = true;
        if (previousPath && previousPath !== uploaded.path) {
          await discardUploadedImage(previousPath);
        }
      } else if (removeImage) {
        await updateProductDetails(getDb(), row.id, {
          name: trimmed,
          category,
          image: { action: "remove" },
        });
        committed = true;
        if (previousPath) {
          await discardUploadedImage(previousPath);
        }
      } else {
        await updateProductDetails(getDb(), row.id, {
          name: trimmed,
          category,
          image: { action: "keep" },
        });
        committed = true;
      }
      if (sale.value !== row.sale_price) {
        await updateProductSalePrice(getDb(), row.id, sale.value);
      }
      onDismiss();
    } catch (err) {
      // The photo reached the bucket but the product never pointed at it.
      if (uploadedPath && !committed) {
        await discardUploadedImage(uploadedPath);
      }
      setError(getFirestoreUserMessage(err));
    } finally {
      setPending(false);
    }
  }

  const hasExistingImage = Boolean(row.image_path?.trim() || row.image_url?.trim());

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
        <p className="mt-1 text-sm text-muted-foreground">Name, category, sale price, and product image.</p>
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
            <Label htmlFor="edit-product-sale">Sale price</Label>
            <Input
              id="edit-product-sale"
              inputMode="decimal"
              min={0}
              step="any"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              Cost price is set from stock purchases and can’t be edited here.
            </p>
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
            {hasExistingImage ? (
              <ProductImage
                imagePath={row.image_path}
                imageUrl={row.image_url}
                alt={row.name}
                width={56}
                height={56}
                className="h-14 w-14 rounded-md border border-border p-1"
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
