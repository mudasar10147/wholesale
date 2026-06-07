"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { InventoryDiscardDoc, InventoryDiscardItemDoc, ProductDoc } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";

type DiscardRow = InventoryDiscardDoc & { id: string };

type ItemRow = InventoryDiscardItemDoc & { id: string };

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(ts: Timestamp | undefined) {
  try {
    return ts?.toDate().toLocaleString() ?? "—";
  } catch {
    return "—";
  }
}

export function InventoryDiscardList() {
  const [rows, setRows] = useState<DiscardRow[]>([]);
  const [products, setProducts] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<ItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  useEffect(() => {
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.inventoryDiscards),
      orderBy("created_at", "desc"),
      limit(50),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setLoading(false);
        const next: DiscardRow[] = [];
        snap.forEach((docSnap) => {
          next.push({ id: docSnap.id, ...(docSnap.data() as InventoryDiscardDoc) });
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
    const unsub = onSnapshot(collection(db, COLLECTIONS.products), (snap) => {
      const map = new Map<string, string>();
      snap.forEach((docSnap) => {
        const d = docSnap.data() as ProductDoc;
        map.set(docSnap.id, d.name);
      });
      setProducts(map);
    });
    return () => unsub();
  }, []);

  const productName = useMemo(
    () => (productId: string) => products.get(productId) ?? productId,
    [products],
  );

  async function toggleExpand(discardId: string) {
    if (expandedId === discardId) {
      setExpandedId(null);
      setExpandedItems([]);
      return;
    }
    setExpandedId(discardId);
    setItemsLoading(true);
    setExpandedItems([]);
    try {
      const db = getDb();
      const snap = await getDocs(
        query(
          collection(db, COLLECTIONS.inventoryDiscardItems),
          where("discard_id", "==", discardId),
        ),
      );
      const items: ItemRow[] = [];
      snap.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...(docSnap.data() as InventoryDiscardItemDoc) });
      });
      items.sort((a, b) => productName(a.product_id).localeCompare(productName(b.product_id)));
      setExpandedItems(items);
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setItemsLoading(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading discards…</p>;
  }

  if (error) {
    return <InlineAlert variant="error">{error}</InlineAlert>;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No stock discards recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Discard #</th>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Reason</th>
            <th className="px-4 py-3 font-medium text-right">Qty</th>
            <th className="px-4 py-3 font-medium text-right">COGS write-off</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isExpanded = expandedId === row.id;
            return (
              <Fragment key={row.id}>
                <tr className="border-b border-border">
                  <td className="px-4 py-3 font-mono text-foreground">{row.discard_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(row.created_at)}</td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">
                    {row.reason?.trim() || "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.total_quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(row.total_cogs_amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => toggleExpand(row.id)}
                    >
                      {isExpanded ? "Hide" : `${row.item_ids.length} item(s)`}
                    </Button>
                  </td>
                </tr>
                {isExpanded ? (
                  <tr className="border-b border-border bg-muted/10">
                    <td colSpan={6} className="px-4 py-3">
                      {itemsLoading ? (
                        <p className="text-xs text-muted-foreground">Loading lines…</p>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {expandedItems.map((item) => (
                            <li key={item.id} className="flex justify-between gap-4">
                              <span>{productName(item.product_id)}</span>
                              <span className="tabular-nums text-muted-foreground">
                                {item.quantity} ×{" "}
                                {formatMoney(item.cogs_amount / item.quantity)} ={" "}
                                {formatMoney(item.cogs_amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {row.notes?.trim() ? (
                        <p className="mt-2 text-xs text-muted-foreground">Notes: {row.notes}</p>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
