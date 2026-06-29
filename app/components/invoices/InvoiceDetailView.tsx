"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, onSnapshot, query, where, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { logFirestoreError } from "@/lib/firebase/firestoreDebug";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deleteDraftInvoice, postInvoice, recordInvoicePayment, voidInvoice } from "@/lib/firestore/invoices";
import { formatInvoiceVoidBlockedMessage } from "@/lib/firestore/invoiceReturns";
import { calculateInvoiceSummary } from "@/lib/invoices/calculations";
import { listStockShortfallsForDraft } from "@/lib/invoices/draftStockGate";
import { downloadInvoicePdf } from "@/lib/invoices/invoicePdf";
import { buildInvoicePlainText, downloadTextFile } from "@/lib/invoices/invoiceText";
import {
  getInvoiceAmountDue,
  getInvoiceEffectiveTotal,
  getInvoiceLineReturnBreakdown,
  getInvoicePaidAmount,
  getInvoicePostedTotal,
  getInvoiceReturnedAmount,
} from "@/lib/invoices/invoiceEffective";
import { buildPosReceiptInputFromCalc, printPosReceipt } from "@/lib/invoices/posReceiptPdf";
import { normalizeOrderId } from "@/lib/validation/contracts";
import type { CustomerDoc, InvoiceDoc, InvoiceItemDoc, InvoiceReturnDoc, InvoiceReturnItemDoc, ProductDoc } from "@/lib/types/firestore";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { Button, ButtonLink } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";
import { EditDraftInvoiceForm } from "@/app/components/invoices/EditDraftInvoiceForm";
import { RecordInvoicePaymentModal } from "@/app/components/invoices/RecordInvoicePaymentModal";
import { countDraftReturns, InvoiceReturnLinks } from "@/app/components/invoices/ReturnList";
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
  const [productStockById, setProductStockById] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBanner, setEditBanner] = useState<string | null>(null);
  const [receiptPrintNotice, setReceiptPrintNotice] = useState<string | null>(null);
  const [pdfWorking, setPdfWorking] = useState(false);
  const [linkedReturns, setLinkedReturns] = useState<Array<{ id: string; data: InvoiceReturnDoc }>>([]);
  const [returnLineItems, setReturnLineItems] = useState<Array<{ id: string; data: InvoiceReturnItemDoc }>>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

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
    if (!invoiceId || invoice?.status !== "posted") {
      setLinkedReturns([]);
      return;
    }
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.invoiceReturns),
      where("original_invoice_id", "==", invoiceId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Array<{ id: string; data: InvoiceReturnDoc }> = [];
        snap.forEach((docSnap) => {
          next.push({ id: docSnap.id, data: docSnap.data() as InvoiceReturnDoc });
        });
        next.sort((a, b) => {
          const at = a.data.created_at?.toMillis?.() ?? 0;
          const bt = b.data.created_at?.toMillis?.() ?? 0;
          return bt - at;
        });
        setLinkedReturns(next);
      },
      (err) => {
        setLoadError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, [invoice?.status, invoiceId]);

  useEffect(() => {
    if (!invoiceId || invoice?.status !== "posted") {
      setReturnLineItems([]);
      return;
    }
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.invoiceReturnItems),
      where("original_invoice_id", "==", invoiceId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Array<{ id: string; data: InvoiceReturnItemDoc }> = [];
        snap.forEach((docSnap) => {
          next.push({ id: docSnap.id, data: docSnap.data() as InvoiceReturnItemDoc });
        });
        setReturnLineItems(next);
      },
      (err) => {
        setLoadError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, [invoice?.status, invoiceId]);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.products), (snap) => {
      const names = new Map<string, string>();
      const stocks = new Map<string, number>();
      snap.forEach((d) => {
        const data = d.data() as ProductDoc;
        names.set(d.id, data.name);
        stocks.set(d.id, typeof data.stock_quantity === "number" ? data.stock_quantity : 0);
      });
      setProductMap(names);
      setProductStockById(stocks);
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

  const draftStockShortfallMessages = useMemo(() => {
    if (!invoice || invoice.status !== "draft" || items.length === 0) return [];
    return listStockShortfallsForDraft(
      items.map(({ data }) => ({
        product_id: data.product_id,
        quantity: data.quantity,
      })),
      productStockById,
      productMap,
    );
  }, [invoice, items, productStockById, productMap]);
  const draftHasStockShortfall = draftStockShortfallMessages.length > 0;

  const postedReturnIds = useMemo(
    () => new Set(linkedReturns.filter((row) => row.data.status === "posted").map((row) => row.id)),
    [linkedReturns],
  );

  const returnedQtyByItemId = useMemo(() => {
    const map = new Map<string, number>();
    if (postedReturnIds.size === 0) return map;
    for (const { data } of returnLineItems) {
      if (!postedReturnIds.has(data.return_id)) continue;
      const itemId = data.original_invoice_item_id;
      map.set(itemId, (map.get(itemId) ?? 0) + data.quantity_returned);
    }
    return map;
  }, [postedReturnIds, returnLineItems]);

  const invoiceLineRows = useMemo(
    () =>
      items.map(({ id, data }) => {
        const returnedQty = returnedQtyByItemId.get(id) ?? 0;
        const breakdown = getInvoiceLineReturnBreakdown(data.quantity, data.line_total, returnedQty);
        return { id, data, breakdown };
      }),
    [items, returnedQtyByItemId],
  );

  const netLinesSubtotal = useMemo(
    () => invoiceLineRows.reduce((sum, row) => sum + row.breakdown.effectiveLineTotal, 0),
    [invoiceLineRows],
  );

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

  async function handlePrintPosReceipt() {
    if (!invoice || items.length === 0) return;
    setActionError(null);
    setReceiptPrintNotice(null);
    const linePayload = items.map(({ data }) => ({
      product_id: data.product_id,
      quantity: data.quantity,
      unit_price: data.unit_price,
      line_discount: data.line_discount,
    }));
    try {
      const calc = calculateInvoiceSummary({
        lines: linePayload,
        delivery_charge: invoice.delivery_charge ?? 0,
        discount_amount: invoice.discount_amount ?? 0,
      });
      await printPosReceipt(
        buildPosReceiptInputFromCalc({
          order_id: invoice.order_id,
          status: invoice.status,
          customer_name: customerDetails.name || invoice.customer_id,
          customer_phone: customerDetails.phone?.trim() || undefined,
          customer_address: customerDetails.address?.trim() || undefined,
          customer_email: customerDetails.email?.trim() || undefined,
          notes: invoice.notes?.trim() || undefined,
          created_at_label: formatDate(invoice.created_at),
          calc,
          productNames: productMap,
        }),
      );
    } catch (printErr) {
      console.error(printErr);
      setReceiptPrintNotice(
        `POS receipt did not open: ${printErr instanceof Error ? printErr.message : "unknown error"}.`,
      );
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
  const postedTotal = getInvoicePostedTotal(invoice);
  const returnedAmount = getInvoiceReturnedAmount(invoice);
  const effectiveTotal = getInvoiceEffectiveTotal(invoice);
  const paidAmount = getInvoicePaidAmount(invoice);
  const unpaidAmount = getInvoiceAmountDue(invoice);
  const isFullyPaid = invoice.payment_status === "paid" || unpaidAmount <= 0.01;
  const hasReturnableLines = isPosted && effectiveTotal > 0.01;
  const draftReturnCount = countDraftReturns(linkedReturns);
  const voidBlockedMessage = formatInvoiceVoidBlockedMessage({
    postedCount: linkedReturns.filter((row) => row.data.status === "posted").length,
    draftCount: draftReturnCount,
  });
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
            width={804}
            height={200}
            className="h-10 w-auto object-contain sm:h-11"
            style={{ width: "auto" }}
            priority
          />
          <ButtonLink href="/sales" variant="outline" size="sm" className="w-fit">
            ← Sales
          </ButtonLink>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Document actions */}
          <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
            Copy
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
            Download .txt
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pdfWorking}
            onClick={() => void handleDownloadPdf()}
          >
            {pdfWorking ? "PDF…" : "Download PDF"}
          </Button>
          {(isDraft || isPosted) && items.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={working !== null}
              onClick={() => void handlePrintPosReceipt()}
            >
              Print receipt
            </Button>
          ) : null}

          {/* Lifecycle actions */}
          {isDraft ? (
            <>
              <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditBanner(null);
                  setReceiptPrintNotice(null);
                  setEditing((e) => !e);
                }}
              >
                {editing ? "Close editor" : "Edit draft"}
              </Button>
            </>
          ) : null}
          {isPosted && isAdmin && hasReturnableLines ? (
            <>
              <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
              <ButtonLink href={`/sales/${invoice.id}/return/new`} variant="outline" size="sm">
                Create return
              </ButtonLink>
            </>
          ) : null}
          {isDraft && isAdmin ? (
            <Button
              type="button"
              size="sm"
              disabled={working !== null || editing || draftHasStockShortfall}
              title={
                draftHasStockShortfall
                  ? "Resolve stock shortfalls before posting (quantities must not exceed available stock)."
                  : undefined
              }
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
              size="sm"
              disabled={working !== null || editing || isFullyPaid}
              onClick={() => setShowPaymentModal(true)}
            >
              {isFullyPaid ? "Paid" : unpaidAmount > 0.01 ? `Record payment (${formatMoney(unpaidAmount)} due)` : "Record payment"}
            </Button>
          ) : null}
          {(isDraft || isPosted) && isAdmin ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={working !== null || editing || !!voidBlockedMessage}
              title={voidBlockedMessage || undefined}
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
              variant="destructive"
              size="sm"
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

      {draftReturnCount > 0 ? (
        <InlineAlert variant="info">
          <span className="font-medium text-foreground">
            {draftReturnCount === 1 ? "1 return draft" : `${draftReturnCount} return drafts`} saved for this
            invoice.
          </span>{" "}
          Continue from the <strong className="text-foreground">Returns</strong> table below to post or delete.
        </InlineAlert>
      ) : null}

      {actionError ? <InlineAlert variant="error">{actionError}</InlineAlert> : null}
      {editBanner ? <InlineAlert variant="success">{editBanner}</InlineAlert> : null}
      {voidBlockedMessage && isPosted ? (
        <InlineAlert variant="info">{voidBlockedMessage}</InlineAlert>
      ) : null}
      {receiptPrintNotice ? (
        <InlineAlert variant="info">{receiptPrintNotice}</InlineAlert>
      ) : null}
      {isDraft && draftHasStockShortfall ? (
        <InlineAlert variant="info">
          <span className="font-medium text-foreground">Stock does not cover this draft.</span> You can print and edit
          the draft, but posting is disabled until quantities are within available stock. Record payment is only available
          after posting with sufficient stock.
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {draftStockShortfallMessages.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </InlineAlert>
      ) : null}

      {editing && isDraft ? (
        <EditDraftInvoiceForm
          key={`${invoice.updated_at?.toMillis?.() ?? 0}-${items.length}`}
          invoiceId={invoice.id}
          orderId={invoice.order_id}
          invoiceCreatedAtLabel={formatDate(invoice.created_at)}
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
          onReceiptPrintResult={(result) => {
            if (result.ok) {
              setReceiptPrintNotice(null);
            } else {
              setReceiptPrintNotice(`POS receipt did not open: ${result.message}`);
            }
          }}
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
              {isFullyPaid ? "paid" : invoice.payment_status === "partial" ? "partial" : "unpaid"}
            </span>
            {returnedAmount > 0 ? (
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium">
                Returned {formatMoney(returnedAmount)}
              </span>
            ) : null}
          </div>
          {invoice.notes ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Notes:</span> {invoice.notes}
            </p>
          ) : null}

          {returnedAmount > 0 ? (
            <div className="rounded-lg border border-accent/30 bg-accent-muted/60 px-3 py-2.5 text-sm text-accent-foreground">
              <span className="font-medium">Returns applied.</span>{" "}
              <span className="text-accent-foreground/90">
                Sold quantities are the original invoice. Returned and net columns show posted return
                credits ({formatMoney(returnedAmount)} total).
              </span>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold tabular-nums">Sold</th>
                  {returnedAmount > 0 ? (
                    <>
                      <th className="px-3 py-2 font-semibold tabular-nums">Returned</th>
                      <th className="px-3 py-2 font-semibold tabular-nums">Net</th>
                    </>
                  ) : (
                    <th className="px-3 py-2 font-semibold tabular-nums">Qty</th>
                  )}
                  <th className="px-3 py-2 font-semibold tabular-nums">Unit</th>
                  <th className="px-3 py-2 font-semibold tabular-nums">Disc</th>
                  <th className="px-3 py-2 font-semibold tabular-nums">Deliv.</th>
                  <th className="px-3 py-2 font-semibold tabular-nums">
                    {returnedAmount > 0 ? "Net total" : "Line total"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoiceLineRows.map(({ id, data, breakdown }) => {
                  const hasLineReturn = breakdown.returnedQty > 0;
                  return (
                    <tr
                      key={id}
                      className={cn(
                        "border-b border-border last:border-b-0",
                        hasLineReturn && "bg-accent-muted/25",
                      )}
                    >
                      <td className="px-3 py-2 text-foreground">
                        {productMap.get(data.product_id) ?? data.product_id}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{breakdown.soldQty}</td>
                      {returnedAmount > 0 ? (
                        <>
                          <td className="px-3 py-2 tabular-nums">
                            {hasLineReturn ? (
                              <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-accent-muted px-2 py-0.5 text-xs font-semibold text-accent-foreground">
                                {breakdown.returnedQty}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 tabular-nums font-medium text-foreground">
                            {breakdown.netQty}
                          </td>
                        </>
                      ) : (
                        <td className="px-3 py-2 tabular-nums">{breakdown.soldQty}</td>
                      )}
                      <td className="px-3 py-2 tabular-nums">{formatMoney(data.unit_price)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(data.line_discount)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(data.line_delivery_charge)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {hasLineReturn ? (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-foreground">
                              {formatMoney(breakdown.effectiveLineTotal)}
                            </div>
                            <div className="text-xs text-muted-foreground line-through">
                              {formatMoney(breakdown.soldLineTotal)}
                            </div>
                          </div>
                        ) : (
                          <span className="font-medium">{formatMoney(breakdown.soldLineTotal)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {returnedAmount > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-border bg-surface-muted">
                    <td
                      colSpan={7}
                      className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      Net after returns
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-base font-semibold text-foreground">
                      {formatMoney(netLinesSubtotal)}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          <div className="rounded-lg border border-border bg-surface-muted/40 p-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Posted subtotal</dt>
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
                <dt className="text-muted-foreground">Posted total</dt>
                <dd className="font-medium text-foreground">{formatMoney(postedTotal)}</dd>
              </div>
            </dl>

            {returnedAmount > 0 ? (
              <dl className="mt-3 grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Returned credit</dt>
                  <dd className="font-semibold tabular-nums text-accent-foreground">
                    −{formatMoney(returnedAmount)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-lg font-semibold text-foreground">Effective total</dt>
                  <dd className="text-lg font-bold tabular-nums text-foreground">
                    {formatMoney(effectiveTotal)}
                  </dd>
                </div>
              </dl>
            ) : null}

            <dl className="mt-3 grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Paid amount</dt>
                <dd className="font-medium text-success">{formatMoney(paidAmount)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Amount due</dt>
                <dd className="text-lg font-bold tabular-nums text-destructive">{formatMoney(unpaidAmount)}</dd>
              </div>
              {isDraft ? (
                <div>
                  <dt className="text-muted-foreground">Draft total</dt>
                  <dd className="text-lg font-semibold text-foreground">{formatMoney(invoice.total_amount)}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          {linkedReturns.length > 0 ? <InvoiceReturnLinks returns={linkedReturns} /> : null}

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

      {showPaymentModal && isPosted ? (
        <RecordInvoicePaymentModal
          orderId={invoice.order_id}
          effectiveTotal={effectiveTotal}
          paidAmount={paidAmount}
          amountDue={unpaidAmount}
          pending={working === "record-payment"}
          onDismiss={() => setShowPaymentModal(false)}
          onSubmit={async (amount) => {
            setActionError(null);
            setWorking("record-payment");
            try {
              await recordInvoicePayment(getDb(), invoice.id, amount);
              setShowPaymentModal(false);
            } catch (err) {
              logFirestoreError("invoice record payment", err);
              throw err;
            } finally {
              setWorking(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
