"use client";

import { type FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { updateProductDetails } from "@/lib/firestore/products";
import type { ProductDoc } from "@/lib/types/firestore";
import { deleteProductImageByPath, getSignedProductImageUrl, uploadProductImage } from "@/lib/upload/productImages";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

export type ProductEditRow = ProductDoc & { id: string };

export function EditProductModal({ row, onDismiss }: { row: ProductEditRow; onDismiss: () => void }) {
  const [name, setName] = useState(row.name);
  const [category, setCategory] = useState(row.category ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathPreviewUrl, setPathPreviewUrl] = useState<string | null>(null);
  const [pathPreviewError, setPathPreviewError] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useEffect(() => {
    let cancelled = false;
    const path = row.image_path?.trim();
    const url = row.image_url?.trim();
    if (url || !path) {
      setPathPreviewUrl(null);
      setPathPreviewError(false);
      return;
    }
    void getSignedProductImageUrl(path)
      .then((u) => {
        if (!cancelled) {
          setPathPreviewUrl(u);
          setPathPreviewError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPathPreviewUrl(null);
          setPathPreviewError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [row.image_path, row.image_url]);

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

  const directImageUrl = row.image_url?.trim();
  const signedPreview = pathPreviewUrl?.trim();

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
            {directImageUrl ? (
              <Image
                src={directImageUrl}
                alt={row.name}
                width={56}
                height={56}
                className="h-14 w-14 rounded-md border border-border bg-surface-muted object-contain p-1"
                unoptimized
              />
            ) : signedPreview ? (
              // Signed GCS URLs are short-lived and arbitrary host; avoid next/image remote config.
              // eslint-disable-next-line @next/next/no-img-element -- signed read URL from our API
              <img
                src={signedPreview}
                alt={row.name}
                width={56}
                height={56}
                className="h-14 w-14 rounded-md border border-border bg-surface-muted object-contain p-1"
              />
            ) : row.image_path?.trim() && pathPreviewError ? (
              <p className="text-xs text-muted-foreground">Could not load image preview. You can still replace it.</p>
            ) : row.image_path?.trim() && !pathPreviewError ? (
              <p className="text-xs text-muted-foreground">Loading image preview…</p>
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
