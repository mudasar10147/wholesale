"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { archiveCustomer, createCustomer, updateCustomer } from "@/lib/firestore/customers";
import type { CustomerDoc } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { cn } from "@/lib/utils";

type CustomerRow = CustomerDoc & { id: string };

const ALERT_ID = "customer-crud-alert";

function formatDate(ts?: Timestamp): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "—";
  }
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhoneLike(value: string): boolean {
  return /^[+\d][\d\s()-]*$/.test(value);
}

function validateCustomerForm(input: {
  name: string;
  phone: string;
  email: string;
  address: string;
}): string | null {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  const address = input.address.trim();

  if (!name) return "Customer name is required.";
  if (name.length < 2) return "Customer name must be at least 2 characters.";
  if (name.length > 120) return "Customer name must be 120 characters or fewer.";
  if (phone && (phone.length > 25 || !isPhoneLike(phone))) {
    return "Enter a valid phone number.";
  }
  if (email && (email.length > 120 || !isEmailLike(email))) {
    return "Enter a valid email address.";
  }
  if (address.length > 300) return "Address must be 300 characters or fewer.";

  return null;
}

export function CustomerCrudPanel() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "update" | "archive" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    const db = getDb();
    const q = query(collection(db, COLLECTIONS.customers), orderBy("created_at", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLoading(false);
        setLoadingError(null);
        const next: CustomerRow[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as CustomerDoc;
          next.push({ id: docSnap.id, ...data });
        });
        setRows(next);
      },
      (err) => {
        setLoading(false);
        setLoadingError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, []);

  const isEditing = editingId !== null;
  const activeCount = useMemo(() => rows.filter((r) => r.is_active).length, [rows]);
  const archivedCount = rows.length - activeCount;

  function resetForm() {
    setEditingId(null);
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
  }

  function loadCustomerIntoForm(row: CustomerRow) {
    setEditingId(row.id);
    setName(row.name ?? "");
    setPhone(row.phone ?? "");
    setEmail(row.email ?? "");
    setAddress(row.address ?? "");
    setFormError(null);
    setFormSuccess(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const message = validateCustomerForm({ name, phone, email, address });
    if (message) {
      setFormError(message);
      return;
    }

    try {
      if (editingId) {
        setBusy("update");
        await updateCustomer(getDb(), editingId, { name, phone, email, address });
        setFormSuccess("Customer updated.");
      } else {
        setBusy("create");
        await createCustomer(getDb(), { name, phone, email, address });
        setFormSuccess("Customer created.");
      }
      resetForm();
    } catch (err) {
      setFormError(getFirestoreUserMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleArchive(row: CustomerRow) {
    if (!row.is_active) return;
    setFormError(null);
    setFormSuccess(null);
    setArchivingId(row.id);
    setBusy("archive");
    try {
      await archiveCustomer(getDb(), row.id);
      if (editingId === row.id) {
        resetForm();
      }
      setFormSuccess("Customer archived.");
    } catch (err) {
      setFormError(getFirestoreUserMessage(err));
    } finally {
      setArchivingId(null);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="customer-name">Customer name</Label>
            <Input
              id="customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Noor Electronics"
              maxLength={120}
              required
              aria-invalid={!!formError}
              aria-describedby={formError ? ALERT_ID : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-phone">Phone (optional)</Label>
            <Input
              id="customer-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+8801…"
              maxLength={25}
              aria-invalid={!!formError}
              aria-describedby={formError ? ALERT_ID : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-email">Email (optional)</Label>
            <Input
              id="customer-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              maxLength={120}
              aria-invalid={!!formError}
              aria-describedby={formError ? ALERT_ID : undefined}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="customer-address">Address (optional)</Label>
            <Input
              id="customer-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="City, area, shop details"
              maxLength={300}
              aria-invalid={!!formError}
              aria-describedby={formError ? ALERT_ID : undefined}
            />
          </div>
        </div>

        {formError ? (
          <InlineAlert id={ALERT_ID} variant="error">
            {formError}
          </InlineAlert>
        ) : null}
        {formSuccess ? <InlineAlert variant="success">{formSuccess}</InlineAlert> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy !== null}>
            {busy === "update" ? "Updating…" : busy === "create" ? "Saving…" : isEditing ? "Update customer" : "Create customer"}
          </Button>
          {isEditing ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={resetForm}
            >
              Cancel edit
            </Button>
          ) : null}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          Active: <strong className="text-foreground">{activeCount}</strong>
        </span>
        <span>
          Archived: <strong className="text-foreground">{archivedCount}</strong>
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading customers…
        </p>
      ) : null}
      {loadingError ? <InlineAlert variant="error">{loadingError}</InlineAlert> : null}

      {!loading && !loadingError ? (
        rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customers yet. Create one using the form above.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
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
                {rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      i % 2 === 1 ? "bg-surface-muted/50" : "bg-surface",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
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
                          className="px-3 py-1.5 text-xs"
                          onClick={() => loadCustomerIntoForm(row)}
                          disabled={busy !== null}
                        >
                          Edit
                        </Button>
                        {row.is_active ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="px-3 py-1.5 text-xs text-destructive"
                            onClick={() => void handleArchive(row)}
                            disabled={busy !== null}
                          >
                            {busy === "archive" && archivingId === row.id ? "Archiving…" : "Archive"}
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
