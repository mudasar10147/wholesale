"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import {
  countInvoicesByTab,
  INVOICE_LIST_TABS,
  matchesInvoiceTab,
  type InvoiceListTab,
} from "@/lib/invoices/invoiceListTabs";
import type { CustomerDoc, InvoiceDoc, InvoiceReturnDoc } from "@/lib/types/firestore";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { RecordInvoicePaymentModal } from "@/app/components/invoices/RecordInvoicePaymentModal";
import { Button, ButtonLink, buttonClasses } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

type Row = InvoiceDoc & { id: string };

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(ts?: Timestamp) {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

type StatusBadge = { label: string; className: string };

/**
 * Single status label combining lifecycle and payment state:
 * Draft · Posted (posted+unpaid) · Partial paid · Paid · Void.
 */
function getStatusBadge(row: Row, isFullyPaid: boolean, effectiveTotal: number): StatusBadge {
  if (row.status === "draft") {
    return { label: "Draft", className: "bg-surface-hover text-foreground" };
  }
  if (row.status === "void") {
    return { label: "Void", className: "bg-destructive-muted text-destructive" };
  }
  // posted
  if (isFullyPaid && effectiveTotal > 0.01) {
    return { label: "Paid", className: "bg-success-muted text-success" };
  }
  if (row.payment_status === "partial") {
    return { label: "Partial paid", className: "bg-accent-muted text-accent-foreground" };
  }
  return { label: "Posted", className: "bg-primary/10 text-primary" };
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

type ActionItem = {
  key: string;
  label: string;
  onClick?: () => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
  title?: string;
};

/** Three-dots overflow menu. Renders into a body portal so the table's overflow does not clip it. */
function RowActionsMenu({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  if (items.length === 0) return null;

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={buttonClasses({ variant: "outline", size: "sm", className: "px-2" })}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <KebabIcon />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-50 min-w-[170px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
              style={{ top: pos.top, right: pos.right }}
            >
              {items.map((item) =>
                item.href ? (
                  <Link
                    key={item.key}
                    role="menuitem"
                    href={item.href}
                    className="block px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-surface-hover"
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <button
                    key={item.key}
                    role="menuitem"
                    type="button"
                    disabled={item.disabled}
                    title={item.title}
                    className={cn(
                      "block w-full px-3 py-2 text-left text-xs font-medium hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50",
                      item.destructive ? "text-destructive" : "text-foreground",
                    )}
                    onClick={() => {
                      setOpen(false);
                      item.onClick?.();
                    }}
                  >
                    {item.label}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
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
  const [customerSearch, setCustomerSearch] = useState("");
  const [activeTab, setActiveTab] = useState<InvoiceListTab>("all");

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

  const tabCounts = useMemo(() => countInvoicesByTab(rows), [rows]);

  const filteredRows = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesInvoiceTab(row, activeTab)) return false;
      if (!q) return true;
      return customerLabel(row.customer_id).toLowerCase().includes(q);
    });
  }, [rows, customerSearch, customerNameById, activeTab]);

  const activeTabLabel = INVOICE_LIST_TABS.find((t) => t.id === activeTab)?.label ?? activeTab;

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

  const customerSearchId = "invoice-customer-search";

  return (
    <div className="space-y-3">
      {actionError ? <InlineAlert variant="error">{actionError}</InlineAlert> : null}

      <div
        className="flex flex-wrap gap-2 border-b border-border pb-3"
        role="tablist"
        aria-label="Invoice status"
      >
        {INVOICE_LIST_TABS.map((tab) => {
          const count = tabCounts[tab.id];
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                  selected ? "bg-primary/15 text-primary" : "bg-surface-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="max-w-md">
        <Label htmlFor={customerSearchId} className="text-sm text-foreground">
          Search by customer
        </Label>
        <Input
          id={customerSearchId}
          type="search"
          className="mt-1.5 h-10"
          placeholder="Customer name"
          value={customerSearch}
          onChange={(e) => setCustomerSearch(e.target.value)}
          autoComplete="off"
          aria-describedby={`${customerSearchId}-hint`}
        />
        <p id={`${customerSearchId}-hint`} className="mt-1 text-[11px] text-muted-foreground">
          {customerSearch.trim() || activeTab !== "all"
            ? `Showing ${filteredRows.length} of ${tabCounts[activeTab]} in ${activeTabLabel}${customerSearch.trim() ? " (filtered)" : ""}`
            : `${rows.length} invoice${rows.length === 1 ? "" : "s"}`}
        </p>
      </div>
      {filteredRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {customerSearch.trim()
            ? `No ${activeTabLabel.toLowerCase()} invoices match “${customerSearch.trim()}”.`
            : `No ${activeTabLabel.toLowerCase()} invoices.`}
        </p>
      ) : (
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
            {filteredRows.map((row, i) => {
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
              const statusBadge = getStatusBadge(row, isFullyPaid, effectiveTotal);
              const busy = workingId !== null;
              const returnHref = `/sales/${encodeURIComponent(row.id)}/return/new`;
              const voidItem: ActionItem = {
                key: "void",
                label: workingId === row.id && workingAction === "void" ? "Voiding…" : "Void",
                destructive: true,
                disabled: busy || !!voidBlockedMessage,
                title: voidBlockedMessage || undefined,
                onClick: () => void handleVoid(row),
              };

              let primaryAction: ReactNode = null;
              const menuItems: ActionItem[] = [];

              if (row.status === "draft") {
                if (isAdmin) {
                  primaryAction = (
                    <Button type="button" size="sm" onClick={() => void handlePost(row)} disabled={busy}>
                      {workingId === row.id && workingAction === "post" ? "Posting…" : "Post invoice"}
                    </Button>
                  );
                  menuItems.push({
                    key: "delete",
                    label: workingId === row.id && workingAction === "delete" ? "Deleting…" : "Delete draft",
                    destructive: true,
                    disabled: busy,
                    onClick: () => void handleDeleteDraft(row),
                  });
                  menuItems.push(voidItem);
                } else {
                  primaryAction = (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleDeleteDraft(row)}
                      disabled={busy}
                    >
                      {workingId === row.id && workingAction === "delete" ? "Deleting…" : "Delete draft"}
                    </Button>
                  );
                }
              } else if (row.status === "posted" && isAdmin) {
                if (!isFullyPaid) {
                  primaryAction = (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setPaymentModalRow(row)}
                      disabled={busy}
                    >
                      {workingId === row.id && workingAction === "record-payment"
                        ? "Saving…"
                        : "Record payment"}
                    </Button>
                  );
                  menuItems.push({ key: "return", label: "Return", href: returnHref });
                  menuItems.push(voidItem);
                } else {
                  primaryAction = (
                    <ButtonLink href={returnHref} variant="primary" size="sm">
                      Return
                    </ButtonLink>
                  );
                  menuItems.push(voidItem);
                }
              }

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
                        statusBadge.className,
                      )}
                    >
                      {statusBadge.label}
                    </span>
                    {hasReturns ? (
                      <span className="rounded-full bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent-foreground">
                        −{formatMoney(returnedAmount)}
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
                  <div className="flex items-center gap-2">
                    <ButtonLink
                      href={`/sales/${encodeURIComponent(row.id)}`}
                      variant="outline"
                      size="sm"
                      className="px-2"
                      aria-label={`View invoice ${row.order_id}`}
                      title="View"
                    >
                      <EyeIcon />
                    </ButtonLink>
                    {primaryAction}
                    <RowActionsMenu items={menuItems} />
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

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
