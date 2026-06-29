"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { archiveTrader } from "@/lib/firestore/traders";
import type { StockLotDoc, TraderDoc } from "@/lib/types/firestore";
import { TraderForm } from "@/app/components/traders/TraderForm";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { cn } from "@/lib/utils";

type TraderRow = TraderDoc & { id: string };

function formatDate(ts?: Timestamp): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleDateString();
  } catch {
    return "—";
  }
}

function compareName(a: TraderRow, b: TraderRow): number {
  return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
}

export function TraderCrudPanel() {
  const [rows, setRows] = useState<TraderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [receiptCountByTraderId, setReceiptCountByTraderId] = useState<Map<string, number>>(
    () => new Map(),
  );

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      collection(db, COLLECTIONS.traders),
      (snap) => {
        setLoading(false);
        setLoadingError(null);
        const next: TraderRow[] = [];
        snap.forEach((docSnap) => next.push({ id: docSnap.id, ...(docSnap.data() as TraderDoc) }));
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setLoadingError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(collection(db, COLLECTIONS.stockLots), (snap) => {
      const counts = new Map<string, number>();
      snap.forEach((docSnap) => {
        const lot = docSnap.data() as StockLotDoc;
        if (lot.source !== "stock_in" || !lot.trader_id) return;
        counts.set(lot.trader_id, (counts.get(lot.trader_id) ?? 0) + 1);
      });
      setReceiptCountByTraderId(counts);
    });
    return () => unsub();
  }, []);

  const sortedRows = useMemo(() => [...rows].sort(compareName), [rows]);
  const activeCount = useMemo(() => rows.filter((r) => r.is_active).length, [rows]);
  const archivedCount = rows.length - activeCount;
  const editingRow = useMemo(
    () => rows.find((r) => r.id === editingId) ?? null,
    [rows, editingId],
  );

  async function handleArchive(row: TraderRow) {
    if (!row.is_active) return;
    setFeedback(null);
    setArchivingId(row.id);
    try {
      await archiveTrader(getDb(), row.id);
      if (editingId === row.id) setEditingId(null);
      setFeedback("Trader archived.");
    } catch (err) {
      setFeedback(getFirestoreUserMessage(err));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <TraderForm
        key={editingId ?? "new"}
        traderId={editingId ?? undefined}
        initial={
          editingRow
            ? {
                name: editingRow.name,
                phone: editingRow.phone,
                address: editingRow.address,
                contact_person: editingRow.contact_person,
                city: editingRow.city,
                notes: editingRow.notes,
              }
            : undefined
        }
        onSaved={() => setEditingId(null)}
        onCancel={editingId ? () => setEditingId(null) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          Active: <strong className="text-foreground">{activeCount}</strong>
        </span>
        <span>
          Archived: <strong className="text-foreground">{archivedCount}</strong>
        </span>
      </div>

      {feedback ? <InlineAlert variant="success">{feedback}</InlineAlert> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading traders…
        </p>
      ) : null}
      {loadingError ? <InlineAlert variant="error">{loadingError}</InlineAlert> : null}

      {!loading && !loadingError ? (
        rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No traders yet. Create one using the form above.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-4 py-3 font-semibold text-foreground">Name</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Contact</th>
                  <th className="px-4 py-3 font-semibold text-foreground">City</th>
                  <th className="px-4 py-3 font-semibold text-foreground text-right">Receipts</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Status</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Created</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      <Link
                        href={`/traders/${row.id}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.contact_person || row.phone || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.city || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {(receiptCountByTraderId.get(row.id) ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          row.is_active
                            ? "bg-success-muted text-success"
                            : "bg-surface-hover text-muted-foreground",
                        )}
                      >
                        {row.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => {
                            setFeedback(null);
                            setEditingId(row.id);
                          }}
                        >
                          Edit
                        </Button>
                        {row.is_active ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="px-3 py-1.5 text-xs text-destructive"
                            onClick={() => void handleArchive(row)}
                            disabled={archivingId === row.id}
                          >
                            {archivingId === row.id ? "Archiving…" : "Archive"}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}
