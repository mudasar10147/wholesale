"use client";

import { useState, type FormEvent } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  parseNonNegativeDecimal,
  parseNonNegativeIntStrict,
} from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

const FORM_ALERT_ID = "add-product-form-alert";

export function AddProductForm() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const nameInvalid = error === "Name is required.";
  const numbersInvalid = Boolean(error && error !== "Name is required.");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }

    const cost = parseNonNegativeDecimal(costPrice);
    if (!cost.ok) {
      setError(cost.message ?? "Invalid cost price.");
      return;
    }
    const sale = parseNonNegativeDecimal(salePrice);
    if (!sale.ok) {
      setError(sale.message ?? "Invalid sale price.");
      return;
    }
    const stock = parseNonNegativeIntStrict(stockQuantity);
    if (!stock.ok) {
      setError(stock.message ?? "Invalid stock quantity.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: trimmedName,
        cost_price: cost.value,
        sale_price: sale.value,
        stock_quantity: stock.value,
        created_at: serverTimestamp(),
      };
      const cat = category.trim();
      if (cat) {
        payload.category = cat;
      }

      await addDoc(collection(getDb(), COLLECTIONS.products), payload);
      setName("");
      setCategory("");
      setCostPrice("");
      setSalePrice("");
      setStockQuantity("");
      setSuccess(true);
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="product-name">Name</Label>
          <Input
            id="product-name"
            name="name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rice 25kg"
            required
            maxLength={200}
            aria-invalid={nameInvalid}
            aria-describedby={nameInvalid ? FORM_ALERT_ID : undefined}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="product-category">Category (optional)</Label>
          <Input
            id="product-category"
            name="category"
            autoComplete="off"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Grains"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-cost">Cost price</Label>
          <Input
            id="product-cost"
            name="cost_price"
            inputMode="decimal"
            min={0}
            step="any"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
            placeholder="0"
            aria-invalid={numbersInvalid}
            aria-describedby={numbersInvalid ? FORM_ALERT_ID : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-sale">Sale price</Label>
          <Input
            id="product-sale"
            name="sale_price"
            inputMode="decimal"
            min={0}
            step="any"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
            placeholder="0"
            aria-invalid={numbersInvalid}
            aria-describedby={numbersInvalid ? FORM_ALERT_ID : undefined}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="product-stock">Stock quantity</Label>
          <Input
            id="product-stock"
            name="stock_quantity"
            inputMode="numeric"
            min={0}
            step={1}
            value={stockQuantity}
            onChange={(e) => setStockQuantity(e.target.value)}
            placeholder="0"
            aria-invalid={numbersInvalid}
            aria-describedby={numbersInvalid ? FORM_ALERT_ID : undefined}
          />
        </div>
      </div>

      {error ? (
        <InlineAlert variant="error" id={FORM_ALERT_ID}>
          {error}
        </InlineAlert>
      ) : null}
      {success ? (
        <InlineAlert variant="success">Product saved.</InlineAlert>
      ) : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Add product"}
      </Button>
    </form>
  );
}
