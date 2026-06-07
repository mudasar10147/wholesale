"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CustomerDoc, InvoiceReturnDoc, InvoiceReturnStatus } from "@/lib/types/firestore";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { cn } from "@/lib/utils";

type ReturnRow = InvoiceReturnDoc & { id: string };

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

function settlementLabel(type: InvoiceReturnDoc["settlement_type"]): string {
  return type === "cash_refund" ? "Cash refund" : "Reduce balance";
}

export function ReturnStatusBadge({ status }: { status: InvoiceReturnStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        status === "posted"
          ? "bg-success-muted text-success"
          : status === "draft"
            ? "bg-surface-hover text-foreground"
            : "bg-destructive-muted text-destructive",
      )}
    >
      {status}
    </span>
  );
}

const actionLinkClass =
  "inline-flex items-center justify-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-surface-hover";

type Props = {
  /** When set, only returns for this invoice are shown. */
  originalInvoiceId?: string;
  /** When true, show only draft returns. */
  draftsOnly?: boolean;
};

export function ReturnList({ originalInvoiceId, draftsOnly = false }: Props) {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [customerNameById, setCustomerNameById] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.customers), (snap) => {
      const next = new Map<string, string>();
      snap.forEach((docSnap) => {
        const d = docSnap.data() as CustomerDoc;
        next.set(docSnap.id, d.name?.trim() || docSnap.id);
      });
      setCustomerNameById(next);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const db = getDb();
    const base = originalInvoiceId
      ? query(
          collection(db, COLLECTIONS.invoiceReturns),
          where("original_invoice_id", "==", originalInvoiceId.trim().toUpperCase()),
        )
      : query(collection(db, COLLECTIONS.invoiceReturns), orderBy("created_at", "desc"));

    const unsub = onSnapshot(
      base,
      (snap) => {
        setLoading(false);
        setError(null);
        const next: ReturnRow[] = [];
        snap.forEach((docSnap) => {
          next.push({ id: docSnap.id, ...(docSnap.data() as InvoiceReturnDoc) });
        });
        next.sort((a, b) => {
          const at = a.created_at?.toMillis?.() ?? 0;
          const bt = b.created_at?.toMillis?.() ?? 0;
          return bt - at;
        });
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, [originalInvoiceId]);

  const visibleRows = useMemo(() => {
    if (draftsOnly) return rows.filter((r) => r.status === "draft");
    return rows;
  }, [draftsOnly, rows]);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading returns…
      </p>
    );
  }

  if (error) {
    return <InlineAlert variant="error">{error}</InlineAlert>;
  }

  if (visibleRows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {draftsOnly ? "No draft returns." : "No returns yet."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[880px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-4 py-3 font-semibold text-foreground">Return #</th>
            <th className="px-4 py-3 font-semibold text-foreground">Status</th>
            <th className="px-4 py-3 font-semibold text-foreground">Invoice</th>
            <th className="px-4 py-3 font-semibold text-foreground">Customer</th>
            <th className="px-4 py-3 font-semibold text-foreground">Settlement</th>
            <th className="px-4 py-3 font-semibold text-foreground">Credit</th>
            <th className="px-4 py-3 font-semibold text-foreground">Created</th>
            <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, i) => (
            <tr
              key={row.id}
              className={cn(
                "border-b border-border last:border-b-0",
                i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
              )}
            >
              <td className="px-4 py-3 font-mono text-foreground">{row.return_number}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <ReturnStatusBadge status={row.status} />
                  {typeof row.write_off_cogs_amount === "number" && row.write_off_cogs_amount > 0 ? (
                    <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                      Discard
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-foreground">{row.order_id}</td>
              <td className="px-4 py-3 text-foreground">
                {customerNameById.get(row.customer_id) ?? row.customer_id}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{settlementLabel(row.settlement_type)}</td>
              <td className="px-4 py-3 tabular-nums font-medium text-foreground">
                {formatMoney(row.total_amount)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                {formatDate(row.created_at)}
              </td>
              <td className="px-4 py-3">
                <Link href={`/sales/returns/${encodeURIComponent(row.id)}`} className={actionLinkClass}>
                  {row.status === "draft" ? "Edit draft" : "View"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Returns linked to an invoice — compact table for invoice detail. */
export function InvoiceReturnLinks({
  returns,
}: {
  returns: Array<{ id: string; data: InvoiceReturnDoc }>;
}) {
  if (returns.length === 0) return null;

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Returns</h3>
        <p className="text-xs text-muted-foreground">
          {returns.length === 1 ? "1 return" : `${returns.length} returns`} linked to this invoice
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-3 py-2 font-semibold text-foreground">Return #</th>
              <th className="px-3 py-2 font-semibold text-foreground">Status</th>
              <th className="px-3 py-2 font-semibold text-foreground">Settlement</th>
              <th className="px-3 py-2 font-semibold text-foreground">Credit</th>
              <th className="px-3 py-2 font-semibold text-foreground">Created</th>
              <th className="px-3 py-2 font-semibold text-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {returns.map(({ id, data }, i) => (
              <tr
                key={id}
                className={cn(
                  "border-b border-border last:border-b-0",
                  i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                )}
              >
                <td className="px-3 py-2.5 font-mono text-foreground">{data.return_number}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ReturnStatusBadge status={data.status} />
                    {typeof data.write_off_cogs_amount === "number" && data.write_off_cogs_amount > 0 ? (
                      <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                        Discard
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{settlementLabel(data.settlement_type)}</td>
                <td className="px-3 py-2.5 tabular-nums font-medium text-foreground">
                  {formatMoney(data.total_amount)}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                  {formatDate(data.created_at)}
                  {data.posted_at ? (
                    <span className="mt-0.5 block text-xs">Posted {formatDate(data.posted_at)}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/sales/returns/${encodeURIComponent(id)}`} className={actionLinkClass}>
                    {data.status === "draft" ? "Edit draft" : "View return"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function countDraftReturns(returns: Array<{ data: InvoiceReturnDoc }>): number {
  return returns.filter((r) => r.data.status === "draft").length;
}
