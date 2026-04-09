"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { updateDraftInvoice } from "@/lib/firestore/invoices";
import { calculateInvoiceSummary } from "@/lib/invoices/calculations";
import type { CustomerDoc, InvoiceItemDoc, ProductDoc } from "@/lib/types/firestore";
import {
  parseNonNegativeDecimal,
  parsePositiveIntStrict,
  validateQuantityAgainstStock,
} from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";

type CustomerOption = { id: string; name: string; is_active: boolean };
type ProductOption = { id: string; name: string; sale_price: number; stock_quantity: number };
type ItemInput = {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  lineDiscount: string;
};

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function nextItem(seed = ""): ItemInput {
  return { id: crypto.randomUUID(), productId: seed, quantity: "1", unitPrice: "", lineDiscount: "0" };
}

type Props = {
  invoiceId: string;
  orderId: string;
  initialCustomerId: string;
  initialDiscount: string;
  initialDelivery: string;
  initialNotes: string;
  initialLines: Array<Pick<InvoiceItemDoc, "product_id" | "quantity" | "unit_price" | "line_discount">>;
  onSaved: () => void;
  onCancel: () => void;
};

export function EditDraftInvoiceForm({
  invoiceId,
  orderId,
  initialCustomerId,
  initialDiscount,
  initialDelivery,
  initialNotes,
  initialLines,
  onSaved,
  onCancel,
}: Props) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [invoiceDiscount, setInvoiceDiscount] = useState(initialDiscount);
  const [deliveryCharge, setDeliveryCharge] = useState(initialDelivery);
  const [notes, setNotes] = useState(initialNotes);
  const [items, setItems] = useState<ItemInput[]>(() =>
    initialLines.length > 0
      ? initialLines.map((l) => ({
          id: crypto.randomUUID(),
          productId: l.product_id,
          quantity: String(l.quantity),
          unitPrice: String(l.unit_price),
          lineDiscount: String(l.line_discount),
        }))
      : [nextItem()],
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.customers), (snap) => {
      setLoadingCustomers(false);
      const list: CustomerOption[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() as CustomerDoc;
        list.push({ id: docSnap.id, name: d.name, is_active: d.is_active });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setCustomers(list.filter((c) => c.is_active));
    });
    return () => unsub();
  }, []);

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

  const calcPreview = useMemo(() => {
    const parsed = items
      .map((line) => {
        const qty = parsePositiveIntStrict(line.quantity);
        const price = parseNonNegativeDecimal(line.unitPrice);
        const discount = parseNonNegativeDecimal(line.lineDiscount);
        if (!qty.ok || !price.ok || !discount.ok || !line.productId) return null;
        return {
          product_id: line.productId,
          quantity: qty.value,
          unit_price: price.value,
          line_discount: discount.value,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const parsedDelivery = parseNonNegativeDecimal(deliveryCharge);
    const parsedInvoiceDiscount = parseNonNegativeDecimal(invoiceDiscount);
    if (!parsedDelivery.ok || !parsedInvoiceDiscount.ok) return null;
    if (parsed.length === 0 || parsed.length !== items.length) return null;

    return calculateInvoiceSummary({
      lines: parsed,
      delivery_charge: parsedDelivery.value,
      discount_amount: parsedInvoiceDiscount.value,
    });
  }, [items, deliveryCharge, invoiceDiscount]);

  function updateLine(id: string, key: keyof ItemInput, value: string) {
    setItems((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        if (key === "productId") {
          const p = products.find((x) => x.id === value);
          return { ...line, productId: value, unitPrice: p ? String(p.sale_price) : line.unitPrice };
        }
        return { ...line, [key]: value };
      }),
    );
  }

  function addLine() {
    setItems((prev) => [...prev, nextItem()]);
  }

  function removeLine(id: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((line) => line.id !== id)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!customerId) {
      setError("Select a customer.");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one invoice item.");
      return;
    }

    const linePayload: {
      product_id: string;
      quantity: number;
      unit_price: number;
      line_discount: number;
    }[] = [];

    for (const line of items) {
      if (!line.productId) {
        setError("Select a product on every line.");
        return;
      }
      const qty = parsePositiveIntStrict(line.quantity);
      const price = parseNonNegativeDecimal(line.unitPrice);
      const discount = parseNonNegativeDecimal(line.lineDiscount);
      if (!qty.ok || !price.ok || !discount.ok) {
        setError("Check quantity, unit price, and discount values.");
        return;
      }
      const base = qty.value * price.value;
      if (discount.value > base) {
        setError("Line discount cannot exceed line amount.");
        return;
      }
      const selected = products.find((p) => p.id === line.productId);
      if (!selected) {
        setError("One or more selected products are missing.");
        return;
      }
      const stock = validateQuantityAgainstStock(qty.value, selected.stock_quantity);
      if (!stock.ok) {
        setError(`${selected.name}: ${stock.message}`);
        return;
      }
      linePayload.push({
        product_id: line.productId,
        quantity: qty.value,
        unit_price: price.value,
        line_discount: discount.value,
      });
    }

    const seen = new Set<string>();
    for (const line of linePayload) {
      if (seen.has(line.product_id)) {
        setError("A product can appear only once in this invoice.");
        return;
      }
      seen.add(line.product_id);
    }

    const invDiscount = parseNonNegativeDecimal(invoiceDiscount);
    const delivery = parseNonNegativeDecimal(deliveryCharge);
    if (!invDiscount.ok || !delivery.ok) {
      setError("Invoice discount and delivery charge must be zero or greater.");
      return;
    }

    setSubmitting(true);
    try {
      await updateDraftInvoice(getDb(), invoiceId, {
        customer_id: customerId,
        order_id: orderId,
        discount_amount: invDiscount.value,
        delivery_charge: delivery.value,
        notes,
        lines: linePayload,
      });
      onSaved();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-surface-muted p-4">
      <h3 className="text-sm font-semibold text-foreground">Edit draft</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="edit-invoice-customer">Customer</Label>
          <Select
            id="edit-invoice-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={loadingCustomers || submitting}
          >
            <option value="">
              {loadingCustomers ? "Loading customers…" : "Choose customer"}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-invoice-order-id">Order ID</Label>
          <Input id="edit-invoice-order-id" value={orderId} readOnly disabled className="bg-surface" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</h4>
          <Button type="button" variant="outline" onClick={addLine} disabled={submitting} className="text-xs">
            Add line
          </Button>
        </div>
        <div className="space-y-3">
          {items.map((line) => {
            const selected = products.find((p) => p.id === line.productId);
            return (
              <div key={line.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="space-y-1 sm:col-span-4">
                    <Label>Product</Label>
                    <Select
                      value={line.productId}
                      onChange={(e) => updateLine(line.id, "productId", e.target.value)}
                      disabled={loadingProducts || submitting}
                    >
                      <option value="">{loadingProducts ? "Loading…" : "Choose product"}</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (stock {p.stock_quantity.toLocaleString()})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Qty</Label>
                    <Input
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(e) => updateLine(line.id, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Unit sale</Label>
                    <Input
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(line.id, "unitPrice", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Discount</Label>
                    <Input
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={line.lineDiscount}
                      onChange={(e) => updateLine(line.id, "lineDiscount", e.target.value)}
                    />
                  </div>
                  <div className="flex items-end sm:col-span-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-destructive"
                      onClick={() => removeLine(line.id)}
                      disabled={items.length <= 1 || submitting}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                {selected ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Stock available: <span className="text-foreground">{selected.stock_quantity}</span>
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="edit-invoice-discount">Invoice discount</Label>
          <Input
            id="edit-invoice-discount"
            inputMode="decimal"
            min={0}
            step="any"
            value={invoiceDiscount}
            onChange={(e) => setInvoiceDiscount(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-invoice-delivery">Delivery charge</Label>
          <Input
            id="edit-invoice-delivery"
            inputMode="decimal"
            min={0}
            step="any"
            value={deliveryCharge}
            onChange={(e) => setDeliveryCharge(e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-3">
          <Label htmlFor="edit-invoice-notes">Notes (optional)</Label>
          <Input
            id="edit-invoice-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
          />
        </div>
      </div>

      {calcPreview ? (
        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Subtotal: <strong className="text-foreground">{money(calcPreview.subtotal_amount)}</strong>
            </span>
            <span>
              Delivery: <strong className="text-foreground">{money(calcPreview.delivery_charge)}</strong>
            </span>
            <span>
              Discount: <strong className="text-foreground">{money(calcPreview.discount_amount)}</strong>
            </span>
            <span>
              Total: <strong className="text-foreground">{money(calcPreview.total_amount)}</strong>
            </span>
          </div>
        </div>
      ) : null}

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting || loadingCustomers || loadingProducts}>
          {submitting ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
