"use client";

import { useEffect, useMemo, useState } from "react";
import type { Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  deleteCashEntry,
  fetchAllCashEntries,
  updateCashEntry,
  type CashEntryRow,
} from "@/lib/firestore/cashEntries";
import type { CashEntryType } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { cn } from "@/lib/utils";

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function toDateInputValue(ts: Timestamp): string {
  const d = ts.toDate();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInput(value: string): Date | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

type CashEntryLedgerTableProps = {
  onChanged: () => Promise<void> | void;
};

export function CashEntryLedgerTable({ onChanged }: CashEntryLedgerTableProps) {
  const [rows, setRows] = useState<CashEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState<CashEntryType>("add");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");

  async function loadRows() {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchAllCashEntries(getDb()));
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  const totals = useMemo(() => {
    let addTotal = 0;
    let removeTotal = 0;
    for (const row of rows) {
      if (row.entry_type === "add") addTotal += row.amount;
      if (row.entry_type === "remove") removeTotal += row.amount;
    }
    return { addTotal, removeTotal };
  }, [rows]);

  function startEdit(row: CashEntryRow) {
    setEditingId(row.id);
    setEditType(row.entry_type);
    setEditAmount(String(row.amount));
    setEditDate(toDateInputValue(row.date));
    setEditNote(row.note ?? "");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditAmount("");
    setEditDate("");
    setEditNote("");
    setError(null);
  }

  async function saveEdit(id: string) {
    const amount = Number.parseFloat(editAmount.trim().replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    const parsedDate = parseDateInput(editDate);
    if (!parsedDate) {
      setError("Date must be valid (YYYY-MM-DD).");
      return;
    }

    setBusyId(id);
    setError(null);
    try {
      await updateCashEntry(getDb(), id, {
        entryType: editType,
        amount,
        date: parsedDate,
        note: editNote,
      });
      setEditingId(null);
      await Promise.all([loadRows(), onChanged()]);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await deleteCashEntry(getDb(), id);
      await Promise.all([loadRows(), onChanged()]);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading cash ledger...</p>;
  }

  return (
    <div className="space-y-4">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          Added: <strong className="text-foreground">{formatMoney(totals.addTotal)}</strong>
        </span>
        <span>
          Removed: <strong className="text-foreground">{formatMoney(totals.removeTotal)}</strong>
        </span>
        <span>
          Net: <strong className="text-foreground">{formatMoney(totals.addTotal - totals.removeTotal)}</strong>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No manual cash entries yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[840px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-3 font-semibold text-foreground">Date</th>
                <th className="px-4 py-3 font-semibold text-foreground">Type</th>
                <th className="px-4 py-3 font-semibold text-foreground">Amount</th>
                <th className="px-4 py-3 font-semibold text-foreground">Note</th>
                <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isEditing = editingId === row.id;
                const isBusy = busyId === row.id;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                    )}
                  >
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                      ) : (
                        row.date.toDate().toLocaleDateString()
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
                          value={editType}
                          onChange={(e) => setEditType(e.target.value as CashEntryType)}
                        >
                          <option value="add">Add cash</option>
                          <option value="remove">Remove cash</option>
                        </select>
                      ) : row.entry_type === "add" ? (
                        "Add cash"
                      ) : (
                        "Remove cash"
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 tabular-nums",
                        row.entry_type === "add" ? "text-foreground" : "text-destructive",
                      )}
                    >
                      {isEditing ? (
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                        />
                      ) : (
                        <>
                          {row.entry_type === "add" ? "+" : "-"}
                          {formatMoney(row.amount)}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <Input
                          type="text"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          maxLength={500}
                        />
                      ) : (
                        row.note ?? "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <Button type="button" disabled={isBusy} onClick={() => void saveEdit(row.id)}>
                            {isBusy ? "Saving..." : "Save"}
                          </Button>
                          <Button type="button" variant="outline" disabled={isBusy} onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" disabled={isBusy} onClick={() => startEdit(row)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => void handleDelete(row.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
