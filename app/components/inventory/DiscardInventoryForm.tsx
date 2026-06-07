"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { postInventoryDiscard } from "@/lib/firestore/inventoryDiscards";
import type { ProductDoc } from "@/lib/types/firestore";
import {
  parsePositiveIntStrict,
  validateQuantityAgainstStock,
} from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { SearchableSelect } from "@/app/components/ui/SearchableSelect";

type ProductOption = {
  id: string;
  name: string;
  stock_quantity: number;
  cost_price: number;
  searchText: string;
};

type LineInput = {
  id: string;
  productId: string;
  quantity: string;
};

function nextLine(seed = ""): LineInput {
  return { id: crypto.randomUUID(), productId: seed, quantity: "1" };
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function DiscardInventoryForm() {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [lines, setLines] = useState<LineInput[]>([nextLine()]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.products), (snap) => {
      setLoadingProducts(false);
      const list: ProductOption[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() as ProductDoc;
        list.push({
          id: docSnap.id,
          name: d.name,
          stock_quantity: typeof d.stock_quantity === "number" ? d.stock_quantity : 0,
          cost_price: typeof d.cost_price === "number" ? d.cost_price : 0,
          searchText: `${d.name} ${d.stock_quantity}`.toLowerCase(),
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(list);
    });
    return () => unsub();
  }, []);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function updateLine(id: string, key: keyof LineInput, value: string) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, [key]: value } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, nextLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((line) => line.id !== id)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const parsedLines: Array<{ product_id: string; quantity: number }> = [];
    for (const line of lines) {
      if (!line.productId) {
        setError("Select a product on each line.");
        return;
      }
      const qty = parsePositiveIntStrict(line.quantity);
      if (!qty.ok) {
        setError(qty.message ?? "Enter a valid quantity on each line.");
        return;
      }
      const product = productById.get(line.productId);
      const stockCheck = validateQuantityAgainstStock(qty.value, product?.stock_quantity ?? 0);
      if (!stockCheck.ok) {
        const label = product?.name ?? "Product";
        setError(`${label}: ${stockCheck.message}`);
        return;
      }
      parsedLines.push({ product_id: line.productId, quantity: qty.value });
    }

    setSubmitting(true);
    try {
      await postInventoryDiscard(getDb(), {
        lines: parsedLines,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setLines([nextLine()]);
      setReason("");
      setNotes("");
      setSuccess("Stock discarded. Inventory and COGS write-off recorded.");
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {lines.map((line, index) => {
          const product = line.productId ? productById.get(line.productId) : undefined;
          return (
            <div
              key={line.id}
              className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-[1fr_120px_auto]"
            >
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor={`discard-product-${line.id}`}>
                  Product {lines.length > 1 ? `#${index + 1}` : ""}
                </Label>
                <SearchableSelect
                  options={products}
                  value={line.productId}
                  onChange={(id) => updateLine(line.id, "productId", id)}
                  getDisplayValue={(o) => o.name}
                  renderOption={(o) => (
                    <span>
                      {o.name}{" "}
                      <span className="text-muted-foreground">({o.stock_quantity} in stock)</span>
                    </span>
                  )}
                  placeholder={loadingProducts ? "Loading products…" : "Search product…"}
                  disabled={loadingProducts || submitting}
                  ariaLabel={`Product line ${index + 1}`}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`discard-qty-${line.id}`}>Qty to discard</Label>
                <Input
                  id={`discard-qty-${line.id}`}
                  inputMode="numeric"
                  min={1}
                  value={line.quantity}
                  onChange={(e) => updateLine(line.id, "quantity", e.target.value)}
                  disabled={submitting}
                />
                {product ? (
                  <p className="text-xs text-muted-foreground">
                    Available: {product.stock_quantity} · Cost ~{money(product.cost_price)}
                  </p>
                ) : null}
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => removeLine(line.id)}
                  disabled={lines.length <= 1 || submitting}
                  className="px-3 py-2"
                >
                  Remove
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Button type="button" variant="outline" onClick={addLine} disabled={submitting}>
        Add another product
      </Button>

      <div className="grid gap-4 sm:max-w-md">
        <div className="space-y-2">
          <Label htmlFor="discard-reason">Reason (optional)</Label>
          <Input
            id="discard-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. QC failed, damaged in storage"
            maxLength={300}
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="discard-notes">Notes (optional)</Label>
          <Input
            id="discard-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra detail"
            maxLength={500}
            disabled={submitting}
          />
        </div>
      </div>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}

      <Button type="submit" disabled={submitting || loadingProducts}>
        {submitting ? "Discarding…" : "Discard stock"}
      </Button>
    </form>
  );
}
