"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, onSnapshot, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { logFirestoreError } from "@/lib/firebase/firestoreDebug";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deleteDraftInvoice, markInvoicePaid, postInvoice, voidInvoice } from "@/lib/firestore/invoices";
import { downloadInvoicePdf } from "@/lib/invoices/invoicePdf";
import { buildInvoicePlainText, downloadTextFile } from "@/lib/invoices/invoiceText";
import { normalizeOrderId } from "@/lib/validation/contracts";
import type { CustomerDoc, InvoiceDoc, InvoiceItemDoc, ProductDoc } from "@/lib/types/firestore";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { EditDraftInvoiceForm } from "@/app/components/invoices/EditDraftInvoiceForm";
import { cn } from "@/lib/utils";

type InvoiceRow = InvoiceDoc & { id: string };
type InvoiceCustomerDetails = {
  name: string;
  phone: string;
  address: string;
  email: string;
};

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(ts?: Timestamp) {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

type Props = { invoiceId: string };

export function InvoiceDetailView({ invoiceId: rawInvoiceId }: Props) {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const invoiceId = useMemo(() => {
    try {
      return normalizeOrderId(rawInvoiceId);
    } catch {
      return "";
    }
  }, [rawInvoiceId]);

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [invoiceMissing, setInvoiceMissing] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; data: InvoiceItemDoc }>>([]);
  const [customerDetails, setCustomerDetails] = useState<InvoiceCustomerDetails>({
    name: "",
    phone: "",
    address: "",
    email: "",
  });
  const [productMap, setProductMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBanner, setEditBanner] = useState<string | null>(null);
  const [pdfWorking, setPdfWorking] = useState(false);

  useEffect(() => {
    if (!invoiceId) {
      setLoading(false);
      setInvoiceMissing(true);
      return;
    }
    const db = getDb();
    const ref = doc(db, COLLECTIONS.invoices, invoiceId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setInvoice(null);
          setInvoiceMissing(true);
          return;
        }
        setInvoiceMissing(false);
        setInvoice({ id: snap.id, ...(snap.data() as InvoiceDoc) });
      },
      (err) => {
        setLoading(false);
        setLoadError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, [invoiceId]);

  useEffect(() => {
    if (!invoice?.customer_id) {
      setCustomerDetails({ name: "", phone: "", address: "", email: "" });
      return;
    }
    let cancelled = false;
    (async () => {
      const snap = await getDoc(doc(getDb(), COLLECTIONS.customers, invoice.customer_id));
      if (cancelled) return;
      if (!snap.exists()) {
        setCustomerDetails({
          name: invoice.customer_id,
          phone: "",
          address: "",
          email: "",
        });
        return;
      }
      const d = snap.data() as CustomerDoc;
      setCustomerDetails({
        name: d.name?.trim() || invoice.customer_id,
        phone: d.phone?.trim() || "",
        address: d.address?.trim() || "",
        email: d.email?.trim() || "",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice?.customer_id]);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.products), (snap) => {
      const m = new Map<string, string>();
      snap.forEach((d) => {
        const data = d.data() as ProductDoc;
        m.set(d.id, data.name);
      });
      setProductMap(m);
    });
    return () => unsub();
  }, []);

  const loadItems = useCallback(async (inv: InvoiceRow) => {
    const ids = Array.isArray(inv.item_ids) ? inv.item_ids.filter(Boolean) : [];
    const db = getDb();
    const rows: Array<{ id: string; data: InvoiceItemDoc }> = [];
    for (const id of ids) {
      const snap = await getDoc(doc(db, COLLECTIONS.invoiceItems, id));
      if (snap.exists()) {
        rows.push({ id: snap.id, data: snap.data() as InvoiceItemDoc });
      }
    }
    setItems(rows);
  }, []);

  useEffect(() => {
    if (!invoice) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      await loadItems(invoice);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice, loadItems]);

  const plainText = useMemo(() => {
    if (!invoice) return "";
    const lines = items.map(({ data }) => ({
      product_name: productMap.get(data.product_id) ?? data.product_id,
      quantity: data.quantity,
      unit_price: data.unit_price,
      line_discount: data.line_discount,
      line_delivery_charge: data.line_delivery_charge,
      line_total: data.line_total,
    }));
    return buildInvoicePlainText({
      order_id: invoice.order_id,
      status: invoice.status,
      customer_name: customerDetails.name || invoice.customer_id,
      customer_phone: customerDetails.phone,
      customer_address: customerDetails.address,
      customer_email: customerDetails.email,
      notes: invoice.notes,
      subtotal_amount: invoice.subtotal_amount,
      discount_amount: invoice.discount_amount,
      delivery_charge: invoice.delivery_charge,
      total_amount: invoice.total_amount,
      lines,
    });
  }, [invoice, items, customerDetails, productMap]);

  async function handleCopy() {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(plainText);
    } catch {
      setActionError("Could not copy to clipboard.");
    }
  }

  function handleDownload() {
    if (!invoice) return;
    const safe = invoice.order_id.replace(/[^\w.-]+/g, "_");
    downloadTextFile(`${safe}.txt`, plainText);
  }

  async function handleDownloadPdf() {
    if (!invoice) return;
    setActionError(null);
    setPdfWorking(true);
    try {
      const lines = items.map(({ data }) => ({
        product_name: productMap.get(data.product_id) ?? data.product_id,
        quantity: data.quantity,
        unit_price: data.unit_price,
        line_discount: data.line_discount,
        line_delivery_charge: data.line_delivery_charge,
        line_total: data.line_total,
      }));
      await downloadInvoicePdf({
        order_id: invoice.order_id,
        status: invoice.status,
        customer_name: customerDetails.name || invoice.customer_id,
        customer_phone: customerDetails.phone,
        customer_address: customerDetails.address,
        customer_email: customerDetails.email,
        notes: invoice.notes,
        created_at_label: formatDate(invoice.created_at),
        subtotal_amount: invoice.subtotal_amount,
        discount_amount: invoice.discount_amount,
        delivery_charge: invoice.delivery_charge,
        total_amount: invoice.total_amount,
        lines,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not generate PDF.");
    } finally {
      setPdfWorking(false);
    }
  }

  async function runAction(label: string, fn: () => Promise<void>) {
    setActionError(null);
    setWorking(label);
    try {
      await fn();
    } catch (err) {
      logFirestoreError(`invoice action: ${label}`, err);
      setActionError(getFirestoreUserMessage(err));
    } finally {
      setWorking(null);
    }
  }

  if (!invoiceId) {
    return <InlineAlert variant="error">Invalid invoice ID in URL.</InlineAlert>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading invoice…</p>;
  }

  if (loadError) {
    return <InlineAlert variant="error">{loadError}</InlineAlert>;
  }

  if (invoiceMissing || !invoice) {
    return (
      <div className="space-y-3">
        <InlineAlert variant="error">Invoice not found.</InlineAlert>
        <Link
          href="/sales"
          className="inline-flex items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2.5 text-sm font-medium text-foreground shadow-xs hover:bg-surface-hover"
        >
          Back to Sales
        </Link>
      </div>
    );
  }

  const isDraft = invoice.status === "draft";
  const isPosted = invoice.status === "posted";
  const invoiceTotal = invoice.posted_total_amount ?? invoice.total_amount ?? 0;
  const paidAmount = Math.min(Math.max(0, invoice.paid_amount ?? 0), Math.max(0, invoiceTotal));
  const unpaidAmount = Math.max(0, invoiceTotal - paidAmount);
  const isFullyPaid = invoice.payment_status === "paid" || unpaidAmount <= 0;
  const initialLinesForEdit = items.map(({ data }) => ({
    product_id: data.product_id,
    quantity: data.quantity,
    unit_price: data.unit_price,
    line_discount: data.line_discount,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <Image
            src="/wholesale_logo.png"
            alt="Wholesale"
            width={160}
            height={48}
            className="h-10 w-auto object-contain sm:h-11"
            priority
          />
          <Link
            href="/sales"
            className="inline-flex w-fit items-center justify-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs hover:bg-surface-hover"
          >
            ← Sales
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="px-3 py-1.5 text-xs"
            onClick={() => void handleCopy()}
          >
            Copy
          </Button>
          <Button
            type="button"
            variant="outline"
            className="px-3 py-1.5 text-xs"
            onClick={handleDownload}
          >
            Download .txt
          </Button>
          <Button
            type="button"
            variant="outline"
            className="px-3 py-1.5 text-xs"
            disabled={pdfWorking}
            onClick={() => void handleDownloadPdf()}
          >
            {pdfWorking ? "PDF…" : "Download PDF"}
          </Button>
          {isDraft ? (
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-xs"
              onClick={() => {
                setEditBanner(null);
                setEditing((e) => !e);
              }}
            >
              {editing ? "Close editor" : "Edit draft"}
            </Button>
          ) : null}
          {isDraft && isAdmin ? (
            <Button
              type="button"
              className="px-3 py-1.5 text-xs"
              disabled={working !== null || editing}
              onClick={() =>
                void runAction("post", () => postInvoice(getDb(), invoice.id))
              }
            >
              {working === "post" ? "Posting…" : "Post invoice"}
            </Button>
          ) : null}
          {isPosted && isAdmin ? (
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-xs"
              disabled={working !== null || editing || isFullyPaid}
              onClick={() =>
                void runAction("mark-paid", () => markInvoicePaid(getDb(), invoice.id))
              }
            >
              {working === "mark-paid" ? "Saving…" : isFullyPaid ? "Paid" : "Mark as paid"}
            </Button>
          ) : null}
          {(isDraft || isPosted) && isAdmin ? (
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-xs text-destructive"
              disabled={working !== null || editing}
              onClick={() =>
                void runAction("void", () => voidInvoice(getDb(), invoice.id))
              }
            >
              {working === "void" ? "Voiding…" : "Void"}
            </Button>
          ) : null}
          {isDraft ? (
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-xs text-destructive"
              disabled={working !== null || editing}
              onClick={() => {
                if (
                  !window.confirm(
                    `Delete draft ${invoice.order_id}? This permanently removes the invoice and its lines.`,
                  )
                ) {
                  return;
                }
                void runAction("delete", async () => {
                  await deleteDraftInvoice(getDb(), invoice.id);
                  router.push("/sales");
                });
              }}
            >
              {working === "delete" ? "Deleting…" : "Delete draft"}
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? <InlineAlert variant="error">{actionError}</InlineAlert> : null}
      {editBanner ? <InlineAlert variant="success">{editBanner}</InlineAlert> : null}

      {editing && isDraft ? (
        <EditDraftInvoiceForm
          key={`${invoice.updated_at?.toMillis?.() ?? 0}-${items.length}`}
          invoiceId={invoice.id}
          orderId={invoice.order_id}
          initialCustomerId={invoice.customer_id}
          initialDiscount={String(invoice.discount_amount)}
          initialDelivery={String(invoice.delivery_charge)}
          initialNotes={invoice.notes ?? ""}
          initialLines={initialLinesForEdit}
          onSaved={() => {
            setEditing(false);
            setEditBanner("Draft updated.");
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-lg">{invoice.order_id}</CardTitle>
          <CardDescription>
            Created {formatDate(invoice.created_at)} · Updated {formatDate(invoice.updated_at)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                invoice.status === "posted"
                  ? "bg-success-muted text-success"
                  : invoice.status === "draft"
                    ? "bg-surface-hover text-foreground"
                    : "bg-destructive-muted text-destructive",
              )}
            >
              {invoice.status}
            </span>
            <span className="text-sm text-muted-foreground">
              Customer: <strong className="text-foreground">{customerDetails.name || invoice.customer_id}</strong>
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                isFullyPaid ? "bg-success-muted text-success" : "bg-surface-hover text-foreground",
              )}
            >
              {isFullyPaid ? "paid" : "unpaid"}
            </span>
          </div>
          {invoice.notes ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Notes:</span> {invoice.notes}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Qty</th>
                  <th className="px-3 py-2 font-semibold">Unit</th>
                  <th className="px-3 py-2 font-semibold">Disc</th>
                  <th className="px-3 py-2 font-semibold">Deliv.</th>
                  <th className="px-3 py-2 font-semibold">Line total</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ id, data }) => (
                  <tr key={id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 text-foreground">
                      {productMap.get(data.product_id) ?? data.product_id}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{data.quantity}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(data.unit_price)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(data.line_discount)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(data.line_delivery_charge)}</td>
                    <td className="px-3 py-2 tabular-nums font-medium">{formatMoney(data.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-medium text-foreground">{formatMoney(invoice.subtotal_amount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="font-medium text-foreground">{formatMoney(invoice.delivery_charge)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Invoice discount</dt>
              <dd className="font-medium text-foreground">{formatMoney(invoice.discount_amount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Paid amount</dt>
              <dd className="font-medium text-success">{formatMoney(paidAmount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Unpaid amount</dt>
              <dd className="font-medium text-destructive">{formatMoney(unpaidAmount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total</dt>
              <dd className="text-lg font-semibold text-foreground">{formatMoney(invoice.total_amount)}</dd>
            </div>
          </dl>

          {invoice.status === "posted" || invoice.status === "void" ? (
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              {invoice.posted_at ? <p>Posted {formatDate(invoice.posted_at)}</p> : null}
              {invoice.voided_at ? <p>Voided {formatDate(invoice.voided_at)}</p> : null}
              {typeof invoice.posted_cogs_amount === "number" ? (
                <p>Posted COGS: {formatMoney(invoice.posted_cogs_amount)}</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="rounded-lg border border-dashed border-border bg-surface-muted/50 p-4 print:hidden">
        <p className="text-xs font-medium text-muted-foreground">Plain text preview</p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
          {plainText}
        </pre>
      </div>
    </div>
  );
}
