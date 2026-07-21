"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { updateDraftInvoice } from "@/lib/firestore/invoices";
import { calculateInvoiceSummary } from "@/lib/invoices/calculations";
import { calculateCounterSaleSummary } from "@/lib/invoices/counterSaleCalculations";
import { useInvoiceReturnLines, type ReturnLineDraft } from "@/app/components/invoices/useInvoiceReturnLines";
import {
  InvoiceReturnLineRow,
  buildPurchaseOptions,
} from "@/app/components/invoices/InvoiceReturnLinesSection";
import {
  buildPosReceiptInputFromCalc,
  printPosReceipt,
} from "@/lib/invoices/posReceiptPdf";
import type {
  CustomerDoc,
  InvoiceItemDoc,
  InvoiceReturnLineEmbedded,
  ProductDoc,
} from "@/lib/types/firestore";
import {
  parseNonNegativeDecimal,
  parsePositiveIntStrict,
  validateQuantityAgainstStock,
} from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { SearchableSelect } from "@/app/components/ui/SearchableSelect";

type CustomerOption = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  is_active: boolean;
  searchText: string;
};
type ProductOption = {
  id: string;
  name: string;
  sale_price: number;
  cost_price: number;
  stock_quantity: number;
  searchText: string;
};
type ItemInput = {
  id: string;
  /** Position in the combined line list (shared counter with return/discard rows). */
  seq: number;
  productId: string;
  quantity: string;
  unitPrice: string;
  lineDiscount: string;
};

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function nextItem(seq: number, seed = ""): ItemInput {
  return {
    id: crypto.randomUUID(),
    seq,
    productId: seed,
    quantity: "1",
    unitPrice: "",
    lineDiscount: "0",
  };
}

type Props = {
  invoiceId: string;
  orderId: string;
  /** Shown on POS receipt as invoice date */
  invoiceCreatedAtLabel: string;
  initialCustomerId: string;
  initialDiscount: string;
  initialDelivery: string;
  initialNotes: string;
  initialLines: Array<Pick<InvoiceItemDoc, "product_id" | "quantity" | "unit_price" | "line_discount">>;
  /** Existing inline return lines on the draft, so editing doesn't wipe them. */
  initialReturnLines?: InvoiceReturnLineEmbedded[];
  onSaved: () => void;
  onCancel: () => void;
  /** Called after save when POS print succeeds or fails (or skipped) */
  onReceiptPrintResult?: (result: { ok: true } | { ok: false; message: string }) => void;
};

export function EditDraftInvoiceForm({
  invoiceId,
  orderId,
  invoiceCreatedAtLabel,
  initialCustomerId,
  initialDiscount,
  initialDelivery,
  initialNotes,
  initialLines,
  initialReturnLines,
  onSaved,
  onCancel,
  onReceiptPrintResult,
}: Props) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [invoiceDiscount, setInvoiceDiscount] = useState(initialDiscount);
  const [deliveryCharge, setDeliveryCharge] = useState(initialDelivery);
  const [notes, setNotes] = useState(initialNotes);
  /**
   * Rebuilds the saved combined order: return/discard rows sit at their stored `sort_order`
   * slots and the sale lines fill the remaining slots in their stored order.
   */
  const [initialSeed] = useState(() => {
    const returnRows: ReturnLineDraft[] = (initialReturnLines ?? []).map((rl, i) => ({
      id: crypto.randomUUID(),
      seq: typeof rl.sort_order === "number" ? rl.sort_order : 10_000 + i,
      purchaseLineId: rl.original_invoice_item_id,
      quantity: String(rl.quantity_returned),
      mode:
        rl.quantity_discard >= rl.quantity_returned && rl.quantity_returned > 0
          ? ("discard" as const)
          : ("restock" as const),
    }));
    const usedSeqs = new Set(returnRows.map((r) => r.seq));
    let cursor = 0;
    const itemRows: ItemInput[] = initialLines.map((l) => {
      do {
        cursor += 1;
      } while (usedSeqs.has(cursor));
      return {
        id: crypto.randomUUID(),
        seq: cursor,
        productId: l.product_id,
        quantity: String(l.quantity),
        unitPrice: String(l.unit_price),
        lineDiscount: String(l.line_discount),
      };
    });
    const maxSeq = Math.max(0, ...returnRows.map((r) => r.seq), ...itemRows.map((i) => i.seq));
    return { returnRows, itemRows, maxSeq };
  });

  const seqRef = useRef(initialSeed.maxSeq);
  const nextSeq = useCallback(() => {
    seqRef.current += 1;
    return seqRef.current;
  }, []);

  const [items, setItems] = useState<ItemInput[]>(() =>
    initialSeed.itemRows.length > 0 ? initialSeed.itemRows : [nextItem(initialSeed.maxSeq + 1)],
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockGateMessage, setStockGateMessage] = useState<string | null>(null);

  const productNameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.name] as const)),
    [products],
  );
  const returnLines = useInvoiceReturnLines(customerId, initialSeed.returnRows);

  const purchaseOptions = useMemo(
    () => buildPurchaseOptions(returnLines.purchaseLines, productNameById),
    [returnLines.purchaseLines, productNameById],
  );
  const purchaseOptionById = useMemo(
    () => new Map(purchaseOptions.map((o) => [o.id, o])),
    [purchaseOptions],
  );

  /** Sale lines and return/discard rows in one list, ordered by when they were added. */
  const combinedLines = useMemo(() => {
    const merged = [
      ...items.map((line) => ({ kind: "sale" as const, seq: line.seq, line })),
      ...returnLines.rows.map((row) => ({ kind: "return" as const, seq: row.seq, row })),
    ];
    return merged.sort((a, b) => a.seq - b.seq);
  }, [items, returnLines.rows]);

  useEffect(() => {
    setStockGateMessage(null);
  }, [items, customerId, invoiceDiscount, deliveryCharge, notes]);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.customers), (snap) => {
      setLoadingCustomers(false);
      const list: CustomerOption[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() as CustomerDoc;
        list.push({
          id: docSnap.id,
          name: d.name,
          phone: d.phone?.trim(),
          email: d.email?.trim(),
          address: d.address?.trim(),
          is_active: d.is_active,
          searchText: `${d.name} ${d.phone ?? ""} ${d.email ?? ""} ${d.address ?? ""}`.toLowerCase(),
        });
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
          cost_price: d.cost_price,
          stock_quantity: d.stock_quantity,
          searchText: `${d.name} ${d.sale_price} ${d.cost_price} ${d.stock_quantity}`.toLowerCase(),
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
    setItems((prev) => [...prev, nextItem(nextSeq())]);
  }

  function removeLine(id: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((line) => line.id !== id)));
  }

  async function performSave(allowInsufficientStockForDraft: boolean) {
    setError(null);
    if (!allowInsufficientStockForDraft) {
      setStockGateMessage(null);
    }

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

    const stockIssues: string[] = [];

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
      if (!allowInsufficientStockForDraft) {
        const stock = validateQuantityAgainstStock(qty.value, selected.stock_quantity);
        if (!stock.ok) {
          stockIssues.push(`${selected.name}: ${stock.message}`);
        }
      }
      linePayload.push({
        product_id: line.productId,
        quantity: qty.value,
        unit_price: price.value,
        line_discount: discount.value,
      });
    }

    if (stockIssues.length > 0 && !allowInsufficientStockForDraft) {
      setStockGateMessage(stockIssues.join(" · "));
      return;
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

    if (returnLines.resolved.hasInvalid) {
      setError("Check the return lines: pick a purchase and a quantity within what's returnable.");
      return;
    }

    setSubmitting(true);
    try {
      await updateDraftInvoice(
        getDb(),
        invoiceId,
        {
          customer_id: customerId,
          order_id: orderId,
          discount_amount: invDiscount.value,
          delivery_charge: delivery.value,
          notes,
          lines: linePayload,
          return_lines: returnLines.resolved.inputs,
        },
        { allowInsufficientStockForDraft },
      );
      setStockGateMessage(null);

      const calc = calculateInvoiceSummary({
        lines: linePayload,
        delivery_charge: delivery.value,
        discount_amount: invDiscount.value,
      });
      const customer = customers.find((c) => c.id === customerId);
      if (customer) {
        const productNames = new Map(products.map((p) => [p.id, p.name] as const));
        try {
          await printPosReceipt(
            buildPosReceiptInputFromCalc({
              order_id: orderId,
              status: "draft",
              customer_name: customer.name,
              customer_phone: customer.phone,
              customer_address: customer.address,
              customer_email: customer.email,
              notes: notes.trim() || undefined,
              created_at_label: invoiceCreatedAtLabel,
              calc,
              productNames,
              returnLines: returnLines.resolved.display.map((d) => ({
                product_name: productNames.get(d.productId) ?? d.productId,
                quantity: d.quantity,
                unit_price: d.unitPrice,
                line_total: d.lineTotal,
                mode: d.mode,
              })),
            }),
          );
          onReceiptPrintResult?.({ ok: true });
        } catch (printErr) {
          console.error(printErr);
          onReceiptPrintResult?.({
            ok: false,
            message:
              printErr instanceof Error ? printErr.message : "POS receipt did not open.",
          });
        }
      } else {
        onReceiptPrintResult?.({ ok: true });
      }

      onSaved();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void performSave(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-surface-muted p-4">
      <h3 className="text-sm font-semibold text-foreground">Edit draft</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="edit-invoice-customer">Customer</Label>
          <SearchableSelect
            options={customers}
            value={customerId}
            onChange={setCustomerId}
            getDisplayValue={(c) => c.name}
            renderOption={(c) => (
              <div className="space-y-0.5">
                <p className="font-medium text-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.phone ? `Phone: ${c.phone}` : "Phone: -"} {c.address ? `| Address: ${c.address}` : ""}
                </p>
              </div>
            )}
            placeholder={loadingCustomers ? "Loading customers..." : "Search customer by name, phone, address"}
            emptyText="No customers match your search."
            disabled={loadingCustomers || submitting}
            ariaLabel="Choose customer"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-invoice-order-id">Order ID</Label>
          <Input id="edit-invoice-order-id" value={orderId} readOnly disabled className="bg-surface" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</h4>
        </div>

        {returnLines.error ? (
          <InlineAlert variant="error">{returnLines.error}</InlineAlert>
        ) : null}

        <div className="space-y-3">
          {combinedLines.map((entry, idx) => {
            if (entry.kind === "return") {
              return (
                <InvoiceReturnLineRow
                  key={entry.row.id}
                  row={entry.row}
                  position={idx + 1}
                  options={purchaseOptions}
                  optionById={purchaseOptionById}
                  updateRow={returnLines.updateRow}
                  removeRow={returnLines.removeRow}
                  disabled={submitting}
                />
              );
            }
            const line = entry.line;
            const selected = products.find((p) => p.id === line.productId);
            return (
              <div key={line.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">{idx + 1}.</span>
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                    Sale
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="space-y-1 sm:col-span-4">
                    <Label>Product</Label>
                    <SearchableSelect
                      options={products}
                      value={line.productId}
                      onChange={(id) => updateLine(line.id, "productId", id)}
                      getDisplayValue={(p) => p.name}
                      renderOption={(p) => (
                        <div className="space-y-0.5">
                          <p className="font-medium text-foreground">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Stock: {p.stock_quantity.toLocaleString()} | Sale: {money(p.sale_price)} | Purchase:{" "}
                            {money(p.cost_price)}
                          </p>
                        </div>
                      )}
                      placeholder={loadingProducts ? "Loading products..." : "Search product name, stock, or price"}
                      emptyText="No products match your search."
                      disabled={loadingProducts || submitting}
                      ariaLabel="Choose product"
                    />
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {customerId ? null : (
            <span className="mr-auto text-xs text-muted-foreground">
              Pick a customer to return or discard items.
            </span>
          )}
          <Button type="button" variant="outline" onClick={addLine} disabled={submitting} className="text-xs">
            Add line
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-xs"
            onClick={() => returnLines.addReturn(nextSeq())}
            disabled={submitting || !customerId}
          >
            Return
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-xs"
            onClick={() => returnLines.addDiscard(nextSeq())}
            disabled={submitting || !customerId}
          >
            Discard
          </Button>
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
          {returnLines.resolved.creditTotal > 0
            ? (() => {
                const counter = calculateCounterSaleSummary(calcPreview.total_amount, [
                  { line_total: returnLines.resolved.creditTotal },
                ]);
                return (
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-1">
                    <span>
                      Returns credit:{" "}
                      <strong className="text-foreground">−{money(counter.returns_credit_amount)}</strong>
                    </span>
                    <span>
                      Net due: <strong className="text-foreground">{money(counter.net_amount_due)}</strong>
                    </span>
                    {counter.cash_refund_amount > 0 ? (
                      <span>
                        Cash refund:{" "}
                        <strong className="text-foreground">{money(counter.cash_refund_amount)}</strong>
                      </span>
                    ) : null}
                  </div>
                );
              })()
            : null}
        </div>
      ) : null}

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {stockGateMessage ? (
        <div className="space-y-2">
          <InlineAlert variant="info">
            <span className="font-medium text-foreground">Stock is lower than the quantities on this invoice.</span>{" "}
            Force-save updates the draft for printing; you cannot post until stock covers all lines.
            <p className="mt-2 text-xs text-muted-foreground">{stockGateMessage}</p>
          </InlineAlert>
          <Button
            type="button"
            variant="outline"
            disabled={submitting || loadingCustomers || loadingProducts}
            onClick={() => void performSave(true)}
          >
            {submitting ? "Saving…" : "Force save draft & print"}
          </Button>
        </div>
      ) : null}

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
