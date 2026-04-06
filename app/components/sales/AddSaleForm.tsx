"use client";

import { useEffect, useState, type FormEvent } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { recordSale } from "@/lib/firestore/sales";
import type { ProductDoc } from "@/lib/types/firestore";
import {
  parsePositiveIntStrict,
  validateQuantityAgainstStock,
} from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";

type ProductOption = {
  id: string;
  name: string;
  sale_price: number;
  stock_quantity: number;
};

const FORM_ALERT_ID = "add-sale-form-alert";

export function AddSaleForm() {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
          sale_price: d.sale_price,
          stock_quantity: d.stock_quantity,
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(list);
    });
    return () => unsub();
  }, []);

  const selected = products.find((p) => p.id === productId);

  const productInvalid = error === "Select a product.";
  const qtyInvalid = Boolean(error && error !== "Select a product.");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!productId) {
      setError("Select a product.");
      return;
    }

    const parsed = parsePositiveIntStrict(quantity);
    if (!parsed.ok) {
      setError(parsed.message ?? "Enter a positive whole number for quantity.");
      return;
    }

    const sel = products.find((p) => p.id === productId);
    if (sel) {
      const vs = validateQuantityAgainstStock(parsed.value, sel.stock_quantity);
      if (!vs.ok) {
        setError(vs.message ?? "Not enough stock.");
        return;
      }
    }

    setSubmitting(true);
    try {
      await recordSale(getDb(), { productId, quantity: parsed.value });
      setQuantity("1");
      setSuccess(true);
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:max-w-md">
        <div className="space-y-2">
          <Label htmlFor="sale-product">Product</Label>
          <Select
            id="sale-product"
            name="product_id"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            disabled={loadingProducts}
            required
            aria-invalid={productInvalid}
            aria-describedby={productInvalid ? FORM_ALERT_ID : undefined}
          >
            <option value="">
              {loadingProducts ? "Loading products…" : "Choose a product"}
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — stock {p.stock_quantity.toLocaleString()} · sale{" "}
                {p.sale_price.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}
              </option>
            ))}
          </Select>
        </div>

        {selected ? (
          <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
            <span className="text-foreground">Unit sale price: </span>
            {selected.sale_price.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}
            <span className="mx-2 text-border-strong">·</span>
            Available stock:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {selected.stock_quantity.toLocaleString()}
            </span>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="sale-qty">Quantity</Label>
          <Input
            id="sale-qty"
            name="quantity"
            inputMode="numeric"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="1"
            aria-invalid={qtyInvalid}
            aria-describedby={qtyInvalid ? FORM_ALERT_ID : undefined}
          />
        </div>
      </div>

      {error ? (
        <InlineAlert variant="error" id={FORM_ALERT_ID}>
          {error}
        </InlineAlert>
      ) : null}
      {success ? (
        <InlineAlert variant="success">Sale recorded and stock updated.</InlineAlert>
      ) : null}

      <Button type="submit" disabled={submitting || loadingProducts || products.length === 0}>
        {submitting ? "Saving…" : "Record sale"}
      </Button>

      {!loadingProducts && products.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add products first on the Products page.</p>
      ) : null}
    </form>
  );
}
