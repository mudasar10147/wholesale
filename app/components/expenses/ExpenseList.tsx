"use client";

import { useEffect, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { isExpenseEditable, updateExpense } from "@/lib/firestore/expenses";
import type { ExpenseDoc } from "@/lib/types/firestore";
import { parsePositiveAmount } from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { cn } from "@/lib/utils";

type Row = ExpenseDoc & { id: string };

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(ts: Timestamp) {
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

export function ExpenseList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAmount, setEditAmount] = useState("");

  useEffect(() => {
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.expenses),
      orderBy("date", "desc"),
      limit(100),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setLoading(false);
        const next: Row[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as ExpenseDoc;
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

  function startEdit(row: Row) {
    setEditingId(row.id);
    setEditTitle(row.title);
    setEditAmount(String(row.amount));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditAmount("");
    setError(null);
  }

  async function saveEdit(id: string) {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setError("Title is required.");
      return;
    }
    const parsed = parsePositiveAmount(editAmount);
    if (!parsed.ok) {
      setError(parsed.message ?? "Enter a valid amount greater than zero.");
      return;
    }

    setBusyId(id);
    setError(null);
    try {
      await updateExpense(getDb(), id, { title: trimmed, amount: parsed.value });
      setEditingId(null);
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading expenses…
      </p>
    );
  }

  if (error && rows.length === 0) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No expenses yet. Add one using the form above.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-4 py-3 font-semibold text-foreground">Date</th>
              <th className="px-4 py-3 font-semibold text-foreground">Title</th>
              <th className="px-4 py-3 font-semibold text-foreground">Amount</th>
              <th className="px-4 py-3 font-semibold text-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isEditing = editingId === row.id;
              const isBusy = busyId === row.id;
              const canEdit = isExpenseEditable(row.date);

              return (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                  )}
                >
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(row.date)}</td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {isEditing ? (
                      <Input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        autoComplete="off"
                      />
                    ) : (
                      row.title
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {isEditing ? (
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                      />
                    ) : (
                      formatMoney(row.amount)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      isEditing ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            className="px-3 py-1.5 text-xs"
                            disabled={isBusy}
                            onClick={() => void saveEdit(row.id)}
                          >
                            {isBusy ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="px-3 py-1.5 text-xs"
                            disabled={isBusy}
                            onClick={cancelEdit}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          disabled={busyId !== null}
                          onClick={() => startEdit(row)}
                        >
                          Edit
                        </Button>
                      )
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
