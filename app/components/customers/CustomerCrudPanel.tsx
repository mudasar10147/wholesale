"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { archiveCustomer } from "@/lib/firestore/customers";
import { computeCustomerEngagement, type CustomerEngagementSegment } from "@/lib/customers/customerEngagement";
import { useCustomerEngagementSettings } from "@/lib/firestore/customerEngagementSettings";
import { getInvoiceEffectiveTotal } from "@/lib/invoices/invoiceEffective";
import type { CustomerDoc, InvoiceDoc } from "@/lib/types/firestore";
import { CustomerFormModal } from "@/app/components/customers/CustomerFormModal";
import { EngagementSegmentBadge } from "@/app/components/customers/EngagementSegmentBadge";
import { MergeCustomersModal } from "@/app/components/customers/MergeCustomersModal";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

type CustomerRow = CustomerDoc & { id: string };

function formatDate(ts?: Timestamp): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleDateString();
  } catch {
    return "—";
  }
}

function compareCustomerName(a: CustomerRow, b: CustomerRow): number {
  return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
}

function MergeIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M7 3v6a5 5 0 0 0 5 5 5 5 0 0 0 5-5V3" />
      <path d="M12 14v7" />
      <path d="M9 18l3 3 3-3" />
    </svg>
  );
}

export function CustomerCrudPanel() {
  const { settings } = useCustomerEngagementSettings();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [invoiceCountByCustomerId, setInvoiceCountByCustomerId] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [invoices, setInvoices] = useState<Array<InvoiceDoc & { id: string }>>([]);

  useEffect(() => {
    const db = getDb();
    const unsub = onSnapshot(
      collection(db, COLLECTIONS.customers),
      (snap) => {
        setLoading(false);
        setLoadingError(null);
        const next: CustomerRow[] = [];
        snap.forEach((docSnap) => next.push({ id: docSnap.id, ...(docSnap.data() as CustomerDoc) }));
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
    const unsub = onSnapshot(collection(db, COLLECTIONS.invoices), (snap) => {
      const counts = new Map<string, number>();
      const nextInvoices: Array<InvoiceDoc & { id: string }> = [];
      snap.forEach((docSnap) => {
        const inv = docSnap.data() as InvoiceDoc;
        nextInvoices.push({ id: docSnap.id, ...inv });
        if (inv.status === "void") return;
        const id = inv.customer_id;
        if (!id) return;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      });
      setInvoices(nextInvoices);
      setInvoiceCountByCustomerId(counts);
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
            r.email?.toLowerCase().includes(q),
        )
      : rows;
    return [...base].sort(compareCustomerName);
  }, [rows, search]);

  const segmentByCustomerId = useMemo(() => {
    const invoiceInputs = invoices
      .filter((inv) => inv.status === "posted")
      .map((inv) => {
        const orderDate = inv.posted_at?.toDate() ?? inv.created_at?.toDate();
        if (!orderDate) return null;
        return {
          customer_id: inv.customer_id,
          orderDate,
          effectiveTotal: getInvoiceEffectiveTotal(inv),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const engagementRows = computeCustomerEngagement(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        is_active: c.is_active !== false,
      })),
      invoiceInputs,
      { settings },
    );

    return new Map<string, CustomerEngagementSegment>(
      engagementRows.map((r) => [r.customerId, r.displaySegment]),
    );
  }, [rows, invoices, settings]);

  const editingRow = useMemo(() => rows.find((r) => r.id === editingId) ?? null, [rows, editingId]);

  function handleMerged() {
    setFeedback("Customers merged. Invoice history now belongs to the kept customer.");
  }

  async function handleArchive(row: CustomerRow) {
    if (!row.is_active) return;
    if (
      !window.confirm(
        `Archive ${row.name}? They will be hidden from new invoices but their history is kept.`,
      )
    ) {
      return;
    }
    setFeedback(null);
    setArchivingId(row.id);
    try {
      await archiveCustomer(getDb(), row.id);
      setFeedback("Customer archived.");
    } catch (err) {
      setFeedback(getFirestoreUserMessage(err));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Label htmlFor="customer-search" className="text-sm text-foreground">
            Search customers
          </Label>
          <Input
            id="customer-search"
            type="search"
            className="mt-1.5 h-10"
            placeholder="Name, phone, or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={rows.length < 2}
          onClick={() => {
            setFeedback(null);
            setShowMergeModal(true);
          }}
          title={rows.length < 2 ? "Add at least two customers to merge" : "Merge duplicate customers"}
        >
          <MergeIcon className="mr-1.5" />
          Merge customers
        </Button>
      </div>

      {feedback ? <InlineAlert variant="success">{feedback}</InlineAlert> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading customers…
        </p>
      ) : null}
      {loadingError ? <InlineAlert variant="error">{loadingError}</InlineAlert> : null}

      {!loading && !loadingError ? (
        rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No customers yet. Use “Create new customer” to add one.
          </p>
        ) : sortedRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customers match “{search.trim()}”.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-4 py-3 font-semibold text-foreground">Name</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Phone</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Email</th>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span>
                          {row.name}
                          {(invoiceCountByCustomerId.get(row.id) ?? 0) > 0 ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              ({invoiceCountByCustomerId.get(row.id)} inv.)
                            </span>
                          ) : null}
                        </span>
                        {row.is_active && segmentByCustomerId.has(row.id) ? (
                          <EngagementSegmentBadge segment={segmentByCustomerId.get(row.id)!} />
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.phone || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.email || "—"}</td>
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
        <CustomerFormModal
          customerId={editingId}
          initial={{
            name: editingRow.name,
            phone: editingRow.phone,
            email: editingRow.email,
            address: editingRow.address,
          }}
          onDismiss={() => setEditingId(null)}
          onSaved={() => setFeedback("Customer updated.")}
        />
      ) : null}

      {showMergeModal ? (
        <MergeCustomersModal
          customers={rows}
          invoiceCountByCustomerId={invoiceCountByCustomerId}
          onDismiss={() => setShowMergeModal(false)}
          onMerged={handleMerged}
        />
      ) : null}
    </div>
  );
}
