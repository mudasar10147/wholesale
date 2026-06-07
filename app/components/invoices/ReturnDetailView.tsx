"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { logFirestoreError } from "@/lib/firebase/firestoreDebug";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deleteReturnDraft, postReturn } from "@/lib/firestore/invoiceReturns";
import type { CustomerDoc, InvoiceReturnDoc, InvoiceReturnItemDoc } from "@/lib/types/firestore";
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
import { EditReturnForm } from "@/app/components/invoices/EditReturnForm";
import { ReturnStatusBadge } from "@/app/components/invoices/ReturnList";

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

function itemRestockQty(data: InvoiceReturnItemDoc): number {
  if (typeof data.quantity_restock === "number") return data.quantity_restock;
  return data.quantity_returned;
}

function itemDiscardQty(data: InvoiceReturnItemDoc): number {
  if (typeof data.quantity_discard === "number") return data.quantity_discard;
  return 0;
}

type Props = { returnId: string };

export function ReturnDetailView({ returnId }: Props) {
  const { isAdmin } = useAuth();
  const [ret, setRet] = useState<ReturnRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; data: InvoiceReturnItemDoc }>>([]);
  const [customerName, setCustomerName] = useState("");
  const [productMap, setProductMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBanner, setEditBanner] = useState<string | null>(null);

  const trimmedId = useMemo(() => returnId.trim(), [returnId]);

  useEffect(() => {
    if (!trimmedId) {
      setLoading(false);
      setMissing(true);
      return;
    }
    const ref = doc(getDb(), COLLECTIONS.invoiceReturns, trimmedId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setRet(null);
          setMissing(true);
          return;
        }
        setMissing(false);
        setRet({ id: snap.id, ...(snap.data() as InvoiceReturnDoc) });
      },
      (err) => {
        setLoading(false);
        setLoadError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, [trimmedId]);

  useEffect(() => {
    if (!ret?.customer_id) {
      setCustomerName("");
      return;
    }
    let cancelled = false;
    (async () => {
      const snap = await getDoc(doc(getDb(), COLLECTIONS.customers, ret.customer_id));
      if (cancelled) return;
      if (!snap.exists()) {
        setCustomerName(ret.customer_id);
        return;
      }
      const d = snap.data() as CustomerDoc;
      setCustomerName(d.name?.trim() || ret.customer_id);
    })();
    return () => {
      cancelled = true;
    };
  }, [ret?.customer_id]);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.products), (snap) => {
      const map = new Map<string, string>();
      snap.forEach((d) => {
        map.set(d.id, (d.data().name as string)?.trim() || d.id);
      });
      setProductMap(map);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const itemIds = ret?.item_ids?.length ? ret.item_ids.filter(Boolean) : [];
    if (itemIds.length === 0) {
      setItems([]);
      return;
    }

    const allowedIds = new Set(itemIds);
    setItems((prev) => prev.filter((row) => allowedIds.has(row.id)));

    const db = getDb();
    const unsubs = itemIds.map((itemId) =>
      onSnapshot(doc(db, COLLECTIONS.invoiceReturnItems, itemId), (snap) => {
        setItems((prev) => {
          const without = prev.filter((row) => row.id !== itemId);
          if (!snap.exists()) return without;
          const next = [...without, { id: itemId, data: snap.data() as InvoiceReturnItemDoc }];
          next.sort((a, b) => a.id.localeCompare(b.id));
          return next;
        });
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [ret?.item_ids]);

  const initialQtyByItem = useMemo(() => {
    const map: Record<string, string> = {};
    for (const { data } of items) {
      map[data.original_invoice_item_id] = String(data.quantity_returned);
    }
    return map;
  }, [items]);

  const initialRestockByItem = useMemo(() => {
    const map: Record<string, string> = {};
    for (const { data } of items) {
      map[data.original_invoice_item_id] = String(itemRestockQty(data));
    }
    return map;
  }, [items]);

  const initialDiscardByItem = useMemo(() => {
    const map: Record<string, string> = {};
    for (const { data } of items) {
      map[data.original_invoice_item_id] = String(itemDiscardQty(data));
    }
    return map;
  }, [items]);

  const totalDiscardQty = useMemo(
    () => items.reduce((sum, { data }) => sum + itemDiscardQty(data), 0),
    [items],
  );

  async function runAction(label: string, fn: () => Promise<void>) {
    setActionError(null);
    setWorking(label);
    try {
      await fn();
    } catch (err) {
      logFirestoreError(`return action: ${label}`, err);
      setActionError(getFirestoreUserMessage(err));
    } finally {
      setWorking(null);
    }
  }

  if (!trimmedId) {
    return <InlineAlert variant="error">Invalid return ID.</InlineAlert>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading return…</p>;
  }

  if (loadError) {
    return <InlineAlert variant="error">{loadError}</InlineAlert>;
  }

  if (missing || !ret) {
    return (
      <div className="space-y-3">
        <InlineAlert variant="error">Return not found.</InlineAlert>
        <Link href="/sales" className="text-sm text-primary underline">
          Back to Sales
        </Link>
      </div>
    );
  }

  const isDraft = ret.status === "draft";
  const isPosted = ret.status === "posted";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/sales/${ret.original_invoice_id}`}
          className="inline-flex items-center justify-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs hover:bg-surface-hover"
        >
          ← Invoice {ret.order_id}
        </Link>
        <Link
          href="/sales"
          className="inline-flex items-center justify-center rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs hover:bg-surface-hover"
        >
          Sales
        </Link>
        {isDraft && isAdmin ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-xs"
              disabled={working !== null || editing}
              onClick={() => {
                setEditBanner(null);
                setEditing(true);
              }}
            >
              Edit draft
            </Button>
            <Button
              type="button"
              className="px-3 py-1.5 text-xs"
              disabled={working !== null || editing}
              onClick={() => void runAction("post", () => postReturn(getDb(), ret.id))}
            >
              {working === "post" ? "Posting…" : "Post return"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-xs text-destructive"
              disabled={working !== null || editing}
              onClick={() => {
                if (!window.confirm(`Delete draft return ${ret.return_number}?`)) return;
                void runAction("delete", async () => {
                  await deleteReturnDraft(getDb(), ret.id);
                  window.location.href = `/sales/${ret.original_invoice_id}`;
                });
              }}
            >
              {working === "delete" ? "Deleting…" : "Delete draft"}
            </Button>
          </>
        ) : null}
      </div>

      {actionError ? <InlineAlert variant="error">{actionError}</InlineAlert> : null}
      {editBanner ? <InlineAlert variant="success">{editBanner}</InlineAlert> : null}

      {isDraft && !editing ? (
        <InlineAlert variant="info">
          This return is a <strong className="text-foreground">draft</strong>. Use{" "}
          <strong className="text-foreground">Edit draft</strong> to change quantities, restock vs discard split,
          or settlement, then post to update the invoice
          {totalDiscardQty > 0 ? " and restock resellable units only" : " and restock inventory"}.
        </InlineAlert>
      ) : null}

      {editing && isDraft ? (
        <EditReturnForm
          key={`edit-${ret.id}-${(ret.item_ids ?? []).join(",")}`}
          returnId={ret.id}
          returnNumber={ret.return_number}
          invoiceId={ret.original_invoice_id}
          orderId={ret.order_id}
          initialSettlementType={ret.settlement_type}
          initialReturnReason={ret.return_reason ?? ""}
          initialNotes={ret.notes ?? ""}
          initialQtyByItem={initialQtyByItem}
          initialRestockByItem={initialRestockByItem}
          initialDiscardByItem={initialDiscardByItem}
          onSaved={() => {
            setEditing(false);
            setEditBanner("Return draft updated.");
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      {!editing ? (
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-lg">{ret.return_number}</CardTitle>
          <CardDescription>
            Created {formatDate(ret.created_at)}
            {ret.posted_at ? ` · Posted ${formatDate(ret.posted_at)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ReturnStatusBadge status={ret.status} />
            <span className="text-sm text-muted-foreground">
              Customer: <strong className="text-foreground">{customerName || ret.customer_id}</strong>
            </span>
            <span className="text-sm text-muted-foreground">
              Original invoice:{" "}
              <Link
                href={`/sales/${ret.original_invoice_id}`}
                className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary"
              >
                {ret.order_id}
              </Link>
            </span>
            <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-medium text-foreground">
              {ret.settlement_type === "cash_refund" ? "Cash refund" : "Reduce balance"}
            </span>
            {typeof ret.write_off_cogs_amount === "number" && ret.write_off_cogs_amount > 0 ? (
              <span className="rounded-full bg-accent-muted px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                Discard write-off {formatMoney(ret.write_off_cogs_amount)}
              </span>
            ) : null}
          </div>

          {ret.return_reason ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Reason:</span> {ret.return_reason}
            </p>
          ) : null}
          {ret.notes ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Notes:</span> {ret.notes}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Return</th>
                  <th className="px-3 py-2 font-semibold">Restock</th>
                  <th className="px-3 py-2 font-semibold">Discard</th>
                  <th className="px-3 py-2 font-semibold">Unit</th>
                  <th className="px-3 py-2 font-semibold">Disc</th>
                  <th className="px-3 py-2 font-semibold">Delivery</th>
                  <th className="px-3 py-2 font-semibold">Total</th>
                  {isPosted ? (
                    <>
                      <th className="px-3 py-2 font-semibold">Restock COGS</th>
                      <th className="px-3 py-2 font-semibold">Write-off</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {items.map(({ id, data }) => (
                  <tr key={id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2">{productMap.get(data.product_id) ?? data.product_id}</td>
                    <td className="px-3 py-2 tabular-nums">{data.quantity_returned}</td>
                    <td className="px-3 py-2 tabular-nums">{itemRestockQty(data)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {itemDiscardQty(data) > 0 ? (
                        <span className="inline-flex rounded-full bg-accent-muted px-2 py-0.5 text-xs font-semibold text-accent-foreground">
                          {itemDiscardQty(data)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(data.unit_price)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(data.line_discount)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(data.line_delivery_charge)}</td>
                    <td className="px-3 py-2 tabular-nums font-medium">{formatMoney(data.line_total)}</td>
                    {isPosted ? (
                      <>
                        <td className="px-3 py-2 tabular-nums">{formatMoney(data.cogs_amount)}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {(data.write_off_cogs_amount ?? 0) > 0
                            ? formatMoney(data.write_off_cogs_amount ?? 0)
                            : "—"}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5">
              <dt className="text-muted-foreground">Return credit</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {formatMoney(ret.total_amount)}
              </dd>
            </div>
            {isPosted ? (
              <div className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5">
                <dt className="text-muted-foreground">Refund / settlement</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {formatMoney(ret.refund_amount)}
                </dd>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-surface-muted/20 px-3 py-2.5">
                <dt className="text-muted-foreground">Refund / settlement</dt>
                <dd className="mt-0.5 text-sm text-muted-foreground">Applied when posted</dd>
              </div>
            )}
            <div className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5">
              <dt className="text-muted-foreground">Settlement type</dt>
              <dd className="mt-0.5 font-medium text-foreground">
                {ret.settlement_type === "cash_refund" ? "Cash refund" : "Reduce balance owed"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      ) : null}
    </div>
  );
}
