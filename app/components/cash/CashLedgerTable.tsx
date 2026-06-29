"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deleteCashEntry, updateCashEntry, type CashEntryRow } from "@/lib/firestore/cashEntries";
import type { CashEntryDoc, CashEntryType, LoanEntryKind } from "@/lib/types/firestore";
import { PartySelectInput } from "@/app/components/parties/PartySelectInput";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";
import { cn } from "@/lib/utils";

const LOAN_KIND_LABELS: Record<LoanEntryKind, string> = {
  borrowed: "Borrowed",
  repaid: "Repaid",
  lent: "Lent",
  collected: "Collected",
};

const LOAN_KINDS: LoanEntryKind[] = ["borrowed", "repaid", "lent", "collected"];

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

type LedgerScope = "cash" | "loan";

type CashLedgerTableProps = {
  /** "cash" excludes loan entries; "loan" shows only loan entries. */
  scope?: LedgerScope;
};

export function CashLedgerTable({ scope = "cash" }: CashLedgerTableProps) {
  const isLoan = scope === "loan";

  const [rows, setRows] = useState<CashEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // For cash scope this matches entry_type ("add"/"remove"); for loan scope it matches loan_kind.
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [partyFilter, setPartyFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState<CashEntryType>("add");
  const [editLoanKind, setEditLoanKind] = useState<LoanEntryKind | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editPartyId, setEditPartyId] = useState("");
  const [editPartyName, setEditPartyName] = useState("");
  const [editNote, setEditNote] = useState("");

  useEffect(() => {
    const q = query(collection(getDb(), COLLECTIONS.cashEntries), orderBy("date", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoading(false);
        setError(null);
        const next: CashEntryRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as CashEntryDoc) }));
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  // Loan and general cash entries are kept in separate views.
  const scopedRows = useMemo(
    () => rows.filter((r) => (isLoan ? !!r.loan_kind : !r.loan_kind)),
    [rows, isLoan],
  );

  const partyOptions = useMemo(() => {
    const names = new Set<string>();
    let hasNone = false;
    for (const r of scopedRows) {
      if (r.party_name?.trim()) names.add(r.party_name.trim());
      else hasNone = true;
    }
    return { names: [...names].sort((a, b) => a.localeCompare(b)), hasNone };
  }, [scopedRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedRows.filter((r) => {
      if (kindFilter !== "all") {
        if (isLoan) {
          if (r.loan_kind !== kindFilter) return false;
        } else if (r.entry_type !== kindFilter) {
          return false;
        }
      }
      if (partyFilter === "__none__") {
        if (r.party_name?.trim()) return false;
      } else if (partyFilter !== "all") {
        if ((r.party_name?.trim() ?? "") !== partyFilter) return false;
      }
      if (q) {
        const hay = `${r.note ?? ""} ${r.party_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scopedRows, isLoan, kindFilter, partyFilter, search]);

  const totals = useMemo(() => {
    let addTotal = 0;
    let removeTotal = 0;
    for (const row of filtered) {
      if (row.entry_type === "add") addTotal += row.amount;
      if (row.entry_type === "remove") removeTotal += row.amount;
    }
    return { addTotal, removeTotal };
  }, [filtered]);

  function startEdit(row: CashEntryRow) {
    setEditingId(row.id);
    setEditType(row.entry_type);
    setEditLoanKind(row.loan_kind ?? null);
    setEditAmount(String(row.amount));
    setEditDate(toDateInputValue(row.date));
    setEditPartyId(row.party_id ?? "");
    setEditPartyName(row.party_name ?? "");
    setEditNote(row.note ?? "");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
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
    if (editLoanKind && !editPartyId) {
      setError("A loan entry must keep a party.");
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
        partyId: editPartyId || undefined,
        partyName: editPartyName || undefined,
        loanKind: editLoanKind ?? undefined,
      });
      setEditingId(null);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    const label = isLoan ? "loan entry" : "cash entry";
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    setBusyId(id);
    setError(null);
    try {
      await deleteCashEntry(getDb(), id);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">
        Loading {isLoan ? "loan entries" : "cash ledger"}…
      </p>
    );
  }

  const typeFilterButtons: { value: string; label: string }[] = isLoan
    ? [
        { value: "all", label: "All" },
        ...LOAN_KINDS.map((k) => ({ value: k, label: LOAN_KIND_LABELS[k] })),
      ]
    : [
        { value: "all", label: "All" },
        { value: "add", label: "Cash in" },
        { value: "remove", label: "Cash out" },
      ];

  return (
    <div className="space-y-4">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{isLoan ? "Action" : "Type"}</Label>
            <div className="flex flex-wrap gap-1">
              {typeFilterButtons.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setKindFilter(t.value)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm",
                    kindFilter === t.value
                      ? "border-foreground bg-surface-hover text-foreground"
                      : "border-border text-muted-foreground hover:bg-surface-hover",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cash-party-filter" className="text-xs text-muted-foreground">
              Party
            </Label>
            <Select
              id="cash-party-filter"
              value={partyFilter}
              onChange={(e) => setPartyFilter(e.target.value)}
              className="h-9"
            >
              <option value="all">All parties</option>
              {partyOptions.hasNone ? <option value="__none__">No party</option> : null}
              {partyOptions.names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cash-search" className="text-xs text-muted-foreground">
              Search
            </Label>
            <Input
              id="cash-search"
              type="search"
              className="h-9"
              placeholder="Note or party"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>
            In: <strong className="text-success">{formatMoney(totals.addTotal)}</strong>
          </span>
          <span>
            Out: <strong className="text-destructive">{formatMoney(totals.removeTotal)}</strong>
          </span>
          <span>
            Net:{" "}
            <strong className="text-foreground">
              {formatMoney(totals.addTotal - totals.removeTotal)}
            </strong>
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {scopedRows.length === 0
            ? isLoan
              ? "No loan entries yet."
              : "No cash entries yet."
            : "No entries match the current filters."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[920px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-3 font-semibold text-foreground">Date</th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  {isLoan ? "Action" : "Type"}
                </th>
                <th className="px-4 py-3 font-semibold text-foreground text-right">Amount</th>
                <th className="px-4 py-3 font-semibold text-foreground">Party</th>
                <th className="px-4 py-3 font-semibold text-foreground">Note</th>
                <th className="px-4 py-3 font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const isEditing = editingId === row.id;
                const isBusy = busyId === row.id;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border last:border-b-0 align-top",
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
                        editLoanKind ? (
                          <Select
                            value={editLoanKind}
                            onChange={(e) => setEditLoanKind(e.target.value as LoanEntryKind)}
                          >
                            {LOAN_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {LOAN_KIND_LABELS[k]}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as CashEntryType)}
                          >
                            <option value="add">Cash in</option>
                            <option value="remove">Cash out</option>
                          </Select>
                        )
                      ) : isLoan && row.loan_kind ? (
                        <span className="w-fit rounded-full bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent-foreground">
                          {LOAN_KIND_LABELS[row.loan_kind]}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "w-fit rounded-full px-2 py-0.5 text-xs font-medium",
                            row.entry_type === "add"
                              ? "bg-success-muted text-success"
                              : "bg-destructive-muted text-destructive",
                          )}
                        >
                          {row.entry_type === "add" ? "Cash in" : "Cash out"}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums",
                        row.entry_type === "add" ? "text-success" : "text-destructive",
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
                          {row.entry_type === "add" ? "+" : "−"}
                          {formatMoney(row.amount)}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <PartySelectInput
                          id={`edit-party-${row.id}`}
                          value={editPartyId}
                          onChange={(id, name) => {
                            setEditPartyId(id);
                            setEditPartyName(name);
                          }}
                        />
                      ) : (
                        row.party_name?.trim() || "—"
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
                        row.note ?? "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <Button type="button" size="sm" disabled={isBusy} onClick={() => void saveEdit(row.id)}>
                            {isBusy ? "Saving…" : "Save"}
                          </Button>
                          <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => startEdit(row)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
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
