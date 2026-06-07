"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { logFirestoreError } from "@/lib/firebase/firestoreDebug";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deleteDraftInvoice, postInvoice, recordInvoicePayment, voidInvoice } from "@/lib/firestore/invoices";
import {
  formatInvoiceVoidBlockedMessage,
  type InvoiceReturnBlockers,
} from "@/lib/firestore/invoiceReturns";
import {
  getInvoiceAmountDue,
  getInvoiceEffectiveTotal,
  getInvoicePaidAmount,
  getInvoicePostedTotal,
  getInvoiceReturnedAmount,
} from "@/lib/invoices/invoiceEffective";
import type { CustomerDoc, InvoiceDoc, InvoiceReturnDoc } from "@/lib/types/firestore";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { RecordInvoicePaymentModal } from "@/app/components/invoices/RecordInvoicePaymentModal";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { cn } from "@/lib/utils";

type Row = InvoiceDoc & { id: string };

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

export function InvoiceDraftList() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [customerNameById, setCustomerNameById] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [workingAction, setWorkingAction] = useState<"post" | "void" | "delete" | "record-payment" | null>(null);
  const [paymentModalRow, setPaymentModalRow] = useState<Row | null>(null);
  const [returnBlockersByInvoiceId, setReturnBlockersByInvoiceId] = useState<
    Map<string, InvoiceReturnBlockers>
  >(() => new Map());

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.invoiceReturns), (snap) => {
      const next = new Map<string, InvoiceReturnBlockers>();
      snap.forEach((docSnap) => {
        const data = docSnap.data() as InvoiceReturnDoc;
        const invoiceId = data.original_invoice_id?.trim();
        if (!invoiceId) return;
        const prev = next.get(invoiceId) ?? { postedCount: 0, draftCount: 0 };
        if (data.status === "posted") {
          next.set(invoiceId, { ...prev, postedCount: prev.postedCount + 1 });
        } else if (data.status === "draft") {
          next.set(invoiceId, { ...prev, draftCount: prev.draftCount + 1 });
        }
      });
      setReturnBlockersByInvoiceId(next);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const db = getDb();
    const q = query(collection(db, COLLECTIONS.invoices), orderBy("created_at", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoading(false);
        setError(null);
        const next: Row[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as InvoiceDoc;
          next.push({ id: docSnap.id, ...d });
        });
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.customers), (snap) => {
      const next = new Map<string, string>();
      snap.forEach((docSnap) => {
        const d = docSnap.data() as CustomerDoc;
        const name = d.name?.trim();
        next.set(docSnap.id, name || docSnap.id);
      });
      setCustomerNameById(next);
    });
    return () => unsub();
  }, []);

  function customerLabel(customerId: string | undefined): string {
    if (!customerId) return "—";
    return customerNameById.get(customerId) ?? customerId;
  }

  async function handlePost(row: Row) {
    setActionError(null);
    setWorkingId(row.id);
    setWorkingAction("post");
    try {
      await postInvoice(getDb(), row.id);
    } catch (err) {
      logFirestoreError("InvoiceDraftList handlePost", err);
      setActionError(getFirestoreUserMessage(err));
    } finally {
      setWorkingId(null);
      setWorkingAction(null);
    }
  }

  async function handleVoid(row: Row) {
    setActionError(null);
    setWorkingId(row.id);
    setWorkingAction("void");
    try {
      await voidInvoice(getDb(), row.id);
    } catch (err) {
      logFirestoreError("InvoiceDraftList handleVoid", err);
      setActionError(getFirestoreUserMessage(err));
    } finally {
      setWorkingId(null);
      setWorkingAction(null);
    }
  }

  async function handleRecordPayment(row: Row, amount: number) {
    setActionError(null);
    setWorkingId(row.id);
    setWorkingAction("record-payment");
    try {
      await recordInvoicePayment(getDb(), row.id, amount);
      setPaymentModalRow(null);
    } catch (err) {
      logFirestoreError("InvoiceDraftList handleRecordPayment", err);
      throw err;
    } finally {
      setWorkingId(null);
      setWorkingAction(null);
    }
  }

  async function handleDeleteDraft(row: Row) {
    if (
      !window.confirm(
        `Delete draft ${row.order_id}? This permanently removes the invoice and its lines. This cannot be undone.`,
      )
    ) {
      return;
    }
    setActionError(null);
    setWorkingId(row.id);
    setWorkingAction("delete");
    try {
      await deleteDraftInvoice(getDb(), row.id);
    } catch (err) {
      logFirestoreError("InvoiceDraftList handleDeleteDraft", err);
      setActionError(getFirestoreUserMessage(err));
    } finally {
      setWorkingId(null);
      setWorkingAction(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading invoices…
      </p>
    );
  }

  if (error) {
    return <InlineAlert variant="error">{error}</InlineAlert>;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No invoices yet. Create one above.</p>;
  }

  return (
    <div className="space-y-3">
      {actionError ? <InlineAlert variant="error">{actionError}</InlineAlert> : null}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[800px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-4 py-3 font-semibold text-foreground">Order ID</th>
              <th className="px-4 py-3 font-semibold text-foreground">Status</th>
              <th className="px-4 py-3 font-semibold text-foreground">Customer</th>
              <th className="px-4 py-3 font-semibold text-foreground">Items</th>
              <th className="px-4 py-3 font-semibold text-foreground">Subtotal</th>
              <th className="px-4 py-3 font-semibold text-foreground">Total / due</th>
              <th className="px-4 py-3 font-semibold text-foreground">Created</th>
              <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const postedTotal = getInvoicePostedTotal(row);
              const returnedAmount = getInvoiceReturnedAmount(row);
              const effectiveTotal = getInvoiceEffectiveTotal(row);
              const paidAmount = getInvoicePaidAmount(row);
              const amountDue = getInvoiceAmountDue(row);
              const displayTotal =
                row.status === "posted" ? effectiveTotal : row.total_amount;
              const hasReturns = row.status === "posted" && returnedAmount > 0;
              const showPaymentSummary = row.status === "posted";
              const isFullyPaid = row.payment_status === "paid" || amountDue <= 0.01;
              const voidBlockers = returnBlockersByInvoiceId.get(row.id) ?? {
                postedCount: 0,
                draftCount: 0,
              };
              const voidBlockedMessage = formatInvoiceVoidBlockedMessage(voidBlockers);

              return (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border last:border-b-0",
                  i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                )}
              >
                <td className="px-4 py-3 font-mono text-[13px]">
                  <Link
                    href={`/sales/${encodeURIComponent(row.id)}`}
                    className="text-primary underline-offset-2 hover:text-primary-hover hover:underline"
                  >
                    {row.order_id}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        row.status === "posted"
                          ? "bg-success-muted text-success"
                          : row.status === "draft"
                            ? "bg-surface-hover text-foreground"
                            : "bg-destructive-muted text-destructive",
                      )}
                    >
                      {row.status}
                    </span>
                    {hasReturns ? (
                      <span className="rounded-full bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent-foreground">
                        −{formatMoney(returnedAmount)}
                      </span>
                    ) : null}
                    {showPaymentSummary && !isFullyPaid ? (
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-foreground">
                        {row.payment_status === "partial" ? "partial" : "unpaid"}
                      </span>
                    ) : null}
                    {showPaymentSummary && isFullyPaid && effectiveTotal > 0.01 ? (
                      <span className="rounded-full bg-success-muted px-2 py-0.5 text-xs font-medium text-success">
                        paid
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-foreground">{customerLabel(row.customer_id)}</td>
                <td className="px-4 py-3 tabular-nums text-foreground">{row.item_ids?.length ?? 0}</td>
                <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.subtotal_amount)}</td>
                <td className="px-4 py-3 tabular-nums text-foreground">
                  {showPaymentSummary ? (
                    <div className="space-y-0.5">
                      <div className="font-semibold text-foreground">{formatMoney(displayTotal)}</div>
                      {hasReturns ? (
                        <div className="text-xs text-muted-foreground line-through">{formatMoney(postedTotal)}</div>
                      ) : null}
                      {paidAmount > 0.01 ? (
                        <div className="text-xs font-medium text-success">Paid {formatMoney(paidAmount)}</div>
                      ) : null}
                      {amountDue > 0.01 ? (
                        <div className="text-xs font-medium text-destructive">Due {formatMoney(amountDue)}</div>
                      ) : effectiveTotal > 0.01 ? (
                        <div className="text-xs font-medium text-success">Paid in full</div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="font-medium">{formatMoney(displayTotal)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(row.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/sales/${encodeURIComponent(row.id)}`}
                      className="inline-flex items-center justify-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs hover:bg-surface-hover"
                    >
                      View
                    </Link>
                    {row.status === "posted" && isAdmin ? (
                      <Link
                        href={`/sales/${encodeURIComponent(row.id)}/return/new`}
                        className="inline-flex items-center justify-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs hover:bg-surface-hover"
                      >
                        Return
                      </Link>
                    ) : null}
                    {row.status === "posted" && isAdmin ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setPaymentModalRow(row)}
                        disabled={workingId !== null || isFullyPaid}
                        className="px-3 py-1.5 text-xs"
                      >
                        {workingId === row.id && workingAction === "record-payment"
                          ? "Saving…"
                          : isFullyPaid
                            ? "Paid"
                            : "Record payment"}
                      </Button>
                    ) : null}
                    {row.status === "draft" ? (
                      <>
                        {isAdmin ? (
                          <Button
                            type="button"
                            onClick={() => void handlePost(row)}
                            disabled={workingId !== null}
                            className="px-3 py-1.5 text-xs"
                          >
                            {workingId === row.id && workingAction === "post" ? "Posting…" : "Post invoice"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleDeleteDraft(row)}
                          disabled={workingId !== null}
                          className="px-3 py-1.5 text-xs text-destructive"
                        >
                          {workingId === row.id && workingAction === "delete" ? "Deleting…" : "Delete draft"}
                        </Button>
                      </>
                    ) : null}
                    {(row.status === "draft" || row.status === "posted") && isAdmin ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleVoid(row)}
                        disabled={workingId !== null || !!voidBlockedMessage}
                        title={voidBlockedMessage || undefined}
                        className="px-3 py-1.5 text-xs text-destructive"
                      >
                        {workingId === row.id && workingAction === "void" ? "Voiding…" : "Void"}
                      </Button>
                    ) : null}
                    {row.status === "void" ? (
                      <span className="text-xs text-muted-foreground">No actions</span>
                    ) : null}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {paymentModalRow ? (
        <RecordInvoicePaymentModal
          orderId={paymentModalRow.order_id}
          effectiveTotal={getInvoiceEffectiveTotal(paymentModalRow)}
          paidAmount={getInvoicePaidAmount(paymentModalRow)}
          amountDue={getInvoiceAmountDue(paymentModalRow)}
          pending={workingId === paymentModalRow.id && workingAction === "record-payment"}
          onDismiss={() => setPaymentModalRow(null)}
          onSubmit={(amount) => handleRecordPayment(paymentModalRow, amount)}
        />
      ) : null}
    </div>
  );
}
