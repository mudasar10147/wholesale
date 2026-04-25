"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { logFirestoreError } from "@/lib/firebase/firestoreDebug";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deleteDraftInvoice, markInvoicePaid, postInvoice, voidInvoice } from "@/lib/firestore/invoices";
import type { InvoiceDoc } from "@/lib/types/firestore";
import { useAuth } from "@/app/components/auth/AuthProvider";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [workingAction, setWorkingAction] = useState<"post" | "void" | "delete" | "mark-paid" | null>(null);

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

  async function handleMarkPaid(row: Row) {
    setActionError(null);
    setWorkingId(row.id);
    setWorkingAction("mark-paid");
    try {
      await markInvoicePaid(getDb(), row.id);
    } catch (err) {
      logFirestoreError("InvoiceDraftList handleMarkPaid", err);
      setActionError(getFirestoreUserMessage(err));
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
        <table className="w-full min-w-[920px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-4 py-3 font-semibold text-foreground">Order ID</th>
              <th className="px-4 py-3 font-semibold text-foreground">Status</th>
              <th className="px-4 py-3 font-semibold text-foreground">Items</th>
              <th className="px-4 py-3 font-semibold text-foreground">Subtotal</th>
              <th className="px-4 py-3 font-semibold text-foreground">Delivery</th>
              <th className="px-4 py-3 font-semibold text-foreground">Discount</th>
              <th className="px-4 py-3 font-semibold text-foreground">Total</th>
              <th className="px-4 py-3 font-semibold text-foreground">Created</th>
              <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
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
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground">{row.item_ids?.length ?? 0}</td>
                <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.subtotal_amount)}</td>
                <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.delivery_charge)}</td>
                <td className="px-4 py-3 tabular-nums text-foreground">{formatMoney(row.discount_amount)}</td>
                <td className="px-4 py-3 tabular-nums font-medium text-foreground">
                  {formatMoney(row.total_amount)}
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
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleMarkPaid(row)}
                        disabled={
                          workingId !== null ||
                          row.payment_status === "paid" ||
                          Math.max(
                            0,
                            (row.posted_total_amount ?? row.total_amount ?? 0) -
                              Math.min(
                                Math.max(0, row.paid_amount ?? 0),
                                Math.max(0, row.posted_total_amount ?? row.total_amount ?? 0),
                              ),
                          ) <= 0
                        }
                        className="px-3 py-1.5 text-xs"
                      >
                        {workingId === row.id && workingAction === "mark-paid"
                          ? "Saving…"
                          : row.payment_status === "paid" ||
                              Math.max(
                                0,
                                (row.posted_total_amount ?? row.total_amount ?? 0) -
                                  Math.min(
                                    Math.max(0, row.paid_amount ?? 0),
                                    Math.max(0, row.posted_total_amount ?? row.total_amount ?? 0),
                                  ),
                              ) <= 0
                            ? "Paid"
                            : "Mark paid"}
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
                        disabled={workingId !== null}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
