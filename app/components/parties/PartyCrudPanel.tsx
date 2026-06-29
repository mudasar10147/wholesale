"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { archiveParty } from "@/lib/firestore/parties";
import type { CashEntryDoc, PartyDoc } from "@/lib/types/firestore";
import { AddPartyModal } from "@/app/components/parties/AddPartyModal";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

type PartyRow = PartyDoc & { id: string };

function formatDate(ts?: Timestamp): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleDateString();
  } catch {
    return "—";
  }
}

function compareName(a: PartyRow, b: PartyRow): number {
  return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
}

export function PartyCrudPanel() {
  const [rows, setRows] = useState<PartyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [entryCountByPartyId, setEntryCountByPartyId] = useState<Map<string, number>>(
    () => new Map(),
  );

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      collection(db, COLLECTIONS.parties),
      (snap) => {
        setLoading(false);
        setLoadingError(null);
        const next: PartyRow[] = [];
        snap.forEach((docSnap) => next.push({ id: docSnap.id, ...(docSnap.data() as PartyDoc) }));
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
    const unsub = onSnapshot(collection(db, COLLECTIONS.cashEntries), (snap) => {
      const counts = new Map<string, number>();
      snap.forEach((docSnap) => {
        const entry = docSnap.data() as CashEntryDoc;
        if (!entry.party_id) return;
        counts.set(entry.party_id, (counts.get(entry.party_id) ?? 0) + 1);
      });
      setEntryCountByPartyId(counts);
    });
    return () => unsub();
  }, []);

  const sortedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? rows.filter(
          (r) =>
            r.name?.toLowerCase().includes(q) ||
            r.phone?.toLowerCase().includes(q) ||
            r.contact_person?.toLowerCase().includes(q) ||
            r.city?.toLowerCase().includes(q),
        )
      : rows;
    return [...base].sort(compareName);
  }, [rows, search]);

  const editingRow = useMemo(() => rows.find((r) => r.id === editingId) ?? null, [rows, editingId]);

  async function handleArchive(row: PartyRow) {
    if (!row.is_active) return;
    if (!window.confirm(`Archive ${row.name}? They will be hidden from the party picker.`)) {
      return;
    }
    setFeedback(null);
    setArchivingId(row.id);
    try {
      await archiveParty(getDb(), row.id);
      setFeedback("Party archived.");
    } catch (err) {
      setFeedback(getFirestoreUserMessage(err));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="w-full sm:max-w-xs">
        <Label htmlFor="party-search" className="text-sm text-foreground">
          Search parties
        </Label>
        <Input
          id="party-search"
          type="search"
          className="mt-1.5 h-10"
          placeholder="Name, phone, contact, or city"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>

      {feedback ? <InlineAlert variant="success">{feedback}</InlineAlert> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading parties…
        </p>
      ) : null}
      {loadingError ? <InlineAlert variant="error">{loadingError}</InlineAlert> : null}

      {!loading && !loadingError ? (
        rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No parties yet. Use “Create party” to add the people or companies your cash comes from.
          </p>
        ) : sortedRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parties match “{search.trim()}”.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-4 py-3 font-semibold text-foreground">Name</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Contact</th>
                  <th className="px-4 py-3 font-semibold text-foreground">City</th>
                  <th className="px-4 py-3 font-semibold text-foreground text-right">Entries</th>
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
                    <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.contact_person || row.phone || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.city || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {(entryCountByPartyId.get(row.id) ?? 0).toLocaleString()}
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
                          size="sm"
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
                            variant="destructive"
                            size="sm"
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

      {editingId && editingRow ? (
        <AddPartyModal
          partyId={editingId}
          initial={{
            name: editingRow.name,
            phone: editingRow.phone,
            address: editingRow.address,
            contact_person: editingRow.contact_person,
            city: editingRow.city,
            notes: editingRow.notes,
          }}
          onDismiss={() => setEditingId(null)}
          onCreated={() => setFeedback("Party updated.")}
        />
      ) : null}
    </div>
  );
}
