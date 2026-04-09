"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { createDraftInvoice } from "@/lib/firestore/invoices";
import { calculateInvoiceSummary } from "@/lib/invoices/calculations";
import type { CustomerDoc, ProductDoc } from "@/lib/types/firestore";
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

const ALERT_ID = "invoice-form-alert";

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function createOrderId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `INV-${y}${m}${d}-${rand}`;
}

function nextItem(seed = ""): ItemInput {
  return { id: crypto.randomUUID(), productId: seed, quantity: "1", unitPrice: "", lineDiscount: "0" };
}

export function AddInvoiceForm() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [customerId, setCustomerId] = useState("");
  const [orderId, setOrderId] = useState(() => createOrderId());
  const [invoiceDiscount, setInvoiceDiscount] = useState("0");
  const [deliveryCharge, setDeliveryCharge] = useState("0");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemInput[]>([nextItem()]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);

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
    setSuccess(null);

    if (!customerId) {
      setError("Select a customer.");
      return;
    }
    if (!orderId.trim()) {
      setError("Order ID is required.");
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
      const result = await createDraftInvoice(getDb(), {
        customer_id: customerId,
        order_id: orderId,
        discount_amount: invDiscount.value,
        delivery_charge: delivery.value,
        notes,
        lines: linePayload,
      });
      setLastCreatedId(result.invoiceId);
      setSuccess(`Draft invoice created: ${result.invoiceId}`);
      setOrderId(createOrderId());
      setInvoiceDiscount("0");
      setDeliveryCharge("0");
      setNotes("");
      setItems([nextItem()]);
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="invoice-customer">Customer</Label>
          <Select
            id="invoice-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={loadingCustomers}
            aria-invalid={!!error && !customerId}
            aria-describedby={!!error && !customerId ? ALERT_ID : undefined}
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
          <Label htmlFor="invoice-order-id">Order ID</Label>
          <Input
            id="invoice-order-id"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="INV-YYYYMMDD-0001"
            maxLength={40}
            required
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Invoice items</h3>
          <Button type="button" variant="outline" onClick={addLine} disabled={submitting}>
            Add line
          </Button>
        </div>
        <div className="space-y-3">
          {items.map((line) => {
            const selected = products.find((p) => p.id === line.productId);
            return (
              <div key={line.id} className="rounded-lg border border-border bg-surface-muted p-3">
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="space-y-1 sm:col-span-4">
                    <Label>Product</Label>
                    <Select
                      value={line.productId}
                      onChange={(e) => updateLine(line.id, "productId", e.target.value)}
                      disabled={loadingProducts || submitting}
                    >
                      <option value="">
                        {loadingProducts ? "Loading…" : "Choose product"}
                      </option>
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
          <Label htmlFor="invoice-discount">Invoice discount</Label>
          <Input
            id="invoice-discount"
            inputMode="decimal"
            min={0}
            step="any"
            value={invoiceDiscount}
            onChange={(e) => setInvoiceDiscount(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invoice-delivery">Delivery charge</Label>
          <Input
            id="invoice-delivery"
            inputMode="decimal"
            min={0}
            step="any"
            value={deliveryCharge}
            onChange={(e) => setDeliveryCharge(e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-3">
          <Label htmlFor="invoice-notes">Notes (optional)</Label>
          <Input
            id="invoice-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
            placeholder="Delivery note, remarks..."
          />
        </div>
      </div>

      {calcPreview ? (
        <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
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

      {error ? (
        <InlineAlert variant="error" id={ALERT_ID}>
          {error}
        </InlineAlert>
      ) : null}
      {success ? (
        <InlineAlert variant="success">
          <span className="block">{success}</span>
          {lastCreatedId ? (
            <span className="mt-2 block">
              <Link
                href={`/sales/${encodeURIComponent(lastCreatedId)}`}
                className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
              >
                View invoice
              </Link>
            </span>
          ) : null}
        </InlineAlert>
      ) : null}

      <Button
        type="submit"
        disabled={
          submitting ||
          loadingCustomers ||
          loadingProducts ||
          customers.length === 0 ||
          products.length === 0
        }
      >
        {submitting ? "Saving…" : "Create draft invoice"}
      </Button>
    </form>
  );
}
