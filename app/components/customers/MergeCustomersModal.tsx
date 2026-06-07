"use client";

import { useEffect, useMemo, useState } from "react";
import { mergeCustomersViaApi } from "@/lib/api/mergeCustomersClient";
import type { CustomerDoc } from "@/lib/types/firestore";
import { assertValidCustomerInput, normalizeCustomerInput } from "@/lib/validation/contracts";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";
import { cn } from "@/lib/utils";

type CustomerRow = CustomerDoc & { id: string };

type MergeCustomersModalProps = {
  customers: [CustomerRow, CustomerRow];
  invoiceCountByCustomerId: Map<string, number>;
  onDismiss: () => void;
  onMerged: () => void;
};

function pickFirstNonEmpty(...values: (string | undefined)[]): string {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return "";
}

function defaultProfileFrom(keep: CustomerRow, merge: CustomerRow) {
  return {
    name: pickFirstNonEmpty(keep.name, merge.name),
    phone: pickFirstNonEmpty(keep.phone, merge.phone),
    email: pickFirstNonEmpty(keep.email, merge.email),
    address: pickFirstNonEmpty(keep.address, merge.address),
  };
}

function customerOptionLabel(
  c: CustomerRow,
  invoiceCountByCustomerId: Map<string, number>,
): string {
  const status = c.is_active ? "Active" : "Archived";
  const inv = invoiceCountByCustomerId.get(c.id) ?? 0;
  return `${c.name} (${status}, ${inv} inv.)`;
}

export function MergeCustomersModal({
  customers,
  invoiceCountByCustomerId,
  onDismiss,
  onMerged,
}: MergeCustomersModalProps) {
  const [keepId, setKeepId] = useState(() => {
    const active = customers.find((c) => c.is_active);
    return active?.id ?? customers[0].id;
  });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mergeId = useMemo(
    () => customers.find((c) => c.id !== keepId)?.id ?? customers[1].id,
    [customers, keepId],
  );

  const keepRow = customers.find((c) => c.id === keepId) ?? customers[0];
  const mergeRow = customers.find((c) => c.id === mergeId) ?? customers[1];

  const keepInvoices = invoiceCountByCustomerId.get(keepId) ?? 0;
  const mergeInvoices = invoiceCountByCustomerId.get(mergeId) ?? 0;
  const eitherArchived = !keepRow.is_active || !mergeRow.is_active;

  useEffect(() => {
    const profile = defaultProfileFrom(keepRow, mergeRow);
    setName(profile.name);
    setPhone(profile.phone);
    setEmail(profile.email);
    setAddress(profile.address);
  }, [keepId, keepRow, mergeRow]);

  function applyFieldFrom(source: "keep" | "merge", field: "name" | "phone" | "email" | "address") {
    const row = source === "keep" ? keepRow : mergeRow;
    const value = row[field] ?? "";
    if (field === "name") setName(value);
    else if (field === "phone") setPhone(value);
    else if (field === "email") setEmail(value);
    else setAddress(value);
  }

  async function handleMerge() {
    setError(null);
    try {
      const profile = normalizeCustomerInput({ name, phone, email, address });
      assertValidCustomerInput(profile);
      setPending(true);
      await mergeCustomersViaApi(keepId, mergeId, profile);
      onMerged();
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-customers-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="merge-customers-title" className="text-lg font-semibold text-foreground">
          Merge customers
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Invoice and return history from the duplicate moves to the customer you keep. The other
          record is deleted. The merged customer will be <strong className="text-foreground">active</strong>.
        </p>

        <div className="mt-5 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="merge-keep-customer">Keep this customer (Firestore record)</Label>
            <Select
              id="merge-keep-customer"
              value={keepId}
              onChange={(e) => setKeepId(e.target.value)}
              disabled={pending}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {customerOptionLabel(c, invoiceCountByCustomerId)}
                </option>
              ))}
            </Select>
          </div>

          <div className="rounded-lg border border-border bg-surface-muted/50 p-4 text-sm">
            <p>
              <span className="text-muted-foreground">Keep:</span>{" "}
              <strong className="text-foreground">{keepRow.name}</strong>
              {!keepRow.is_active ? (
                <span className="ml-1 text-xs text-muted-foreground">(archived)</span>
              ) : null}{" "}
              · {keepInvoices} invoice{keepInvoices === 1 ? "" : "s"}
            </p>
            <p className="mt-2">
              <span className="text-muted-foreground">Delete:</span>{" "}
              <strong className="text-destructive">{mergeRow.name}</strong>
              {!mergeRow.is_active ? (
                <span className="ml-1 text-xs text-muted-foreground">(archived)</span>
              ) : null}{" "}
              · {mergeInvoices} invoice{mergeInvoices === 1 ? "" : "s"}
            </p>
            {eitherArchived ? (
              <p className="mt-2 text-xs text-muted-foreground">
                One record is archived — after merge the surviving customer is reactivated automatically.
              </p>
            ) : null}
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Final customer details</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Edit the merged profile below. Use quick-fill to copy a field from either record.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="merge-final-name">Name</Label>
              <Input
                id="merge-final-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                maxLength={120}
              />
              <div className="flex flex-wrap gap-1">
                <QuickFillButton
                  label={`Use "${keepRow.name}"`}
                  disabled={pending}
                  onClick={() => applyFieldFrom("keep", "name")}
                />
                <QuickFillButton
                  label={`Use "${mergeRow.name}"`}
                  disabled={pending}
                  onClick={() => applyFieldFrom("merge", "name")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="merge-final-phone">Phone</Label>
              <Input
                id="merge-final-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={pending}
                maxLength={25}
              />
              <FieldQuickFill
                keep={keepRow.phone}
                merge={mergeRow.phone}
                pending={pending}
                onKeep={() => applyFieldFrom("keep", "phone")}
                onMerge={() => applyFieldFrom("merge", "phone")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="merge-final-email">Email</Label>
              <Input
                id="merge-final-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                maxLength={120}
              />
              <FieldQuickFill
                keep={keepRow.email}
                merge={mergeRow.email}
                pending={pending}
                onKeep={() => applyFieldFrom("keep", "email")}
                onMerge={() => applyFieldFrom("merge", "email")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="merge-final-address">Address</Label>
              <Input
                id="merge-final-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={pending}
                maxLength={300}
              />
              <FieldQuickFill
                keep={keepRow.address}
                merge={mergeRow.address}
                pending={pending}
                onKeep={() => applyFieldFrom("keep", "address")}
                onMerge={() => applyFieldFrom("merge", "address")}
              />
            </div>
          </div>
        </div>

        {error ? (
          <InlineAlert variant="error" className="mt-4 text-sm">
            {error}
          </InlineAlert>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            className={cn(pending && "opacity-70")}
            onClick={() => void handleMerge()}
          >
            {pending ? "Merging…" : "Merge and delete duplicate"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QuickFillButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function FieldQuickFill({
  keep,
  merge,
  pending,
  onKeep,
  onMerge,
}: {
  keep?: string;
  merge?: string;
  pending: boolean;
  onKeep: () => void;
  onMerge: () => void;
}) {
  const hasKeep = Boolean(keep?.trim());
  const hasMerge = Boolean(merge?.trim());
  if (!hasKeep && !hasMerge) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {hasKeep ? (
        <QuickFillButton label={`Keep: ${keep!.trim()}`} disabled={pending} onClick={onKeep} />
      ) : null}
      {hasMerge ? (
        <QuickFillButton label={`Other: ${merge!.trim()}`} disabled={pending} onClick={onMerge} />
      ) : null}
    </div>
  );
}
