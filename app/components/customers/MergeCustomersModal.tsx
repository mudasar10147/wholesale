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
import { SearchableSelect, type SearchableOption } from "@/app/components/ui/SearchableSelect";
import { cn } from "@/lib/utils";

type CustomerRow = CustomerDoc & { id: string };

type MergeCustomersModalProps = {
  customers: CustomerRow[];
  invoiceCountByCustomerId: Map<string, number>;
  onDismiss: () => void;
  onMerged: () => void;
};

type CustomerOption = SearchableOption & { row: CustomerRow };

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

function toOption(row: CustomerRow): CustomerOption {
  return {
    id: row.id,
    searchText: `${row.name ?? ""} ${row.phone ?? ""} ${row.email ?? ""}`.toLowerCase(),
    row,
  };
}

export function MergeCustomersModal({
  customers,
  invoiceCountByCustomerId,
  onDismiss,
  onMerged,
}: MergeCustomersModalProps) {
  const [firstId, setFirstId] = useState("");
  const [secondId, setSecondId] = useState("");
  const [keepId, setKeepId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState<"select" | "confirm">("select");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss, pending]);

  const firstRow = useMemo(() => customers.find((c) => c.id === firstId) ?? null, [customers, firstId]);
  const secondRow = useMemo(
    () => customers.find((c) => c.id === secondId) ?? null,
    [customers, secondId],
  );

  const bothSelected = !!firstRow && !!secondRow && firstId !== secondId;

  const firstOptions = useMemo(
    () => customers.filter((c) => c.id !== secondId).map(toOption),
    [customers, secondId],
  );
  const secondOptions = useMemo(
    () => customers.filter((c) => c.id !== firstId).map(toOption),
    [customers, firstId],
  );

  // Default keep + profile whenever the pair changes.
  useEffect(() => {
    if (!firstRow || !secondRow || firstId === secondId) return;
    const defaultKeep = firstRow.is_active
      ? firstRow.id
      : secondRow.is_active
        ? secondRow.id
        : firstRow.id;
    setKeepId(defaultKeep);
  }, [firstRow, secondRow, firstId, secondId]);

  const keepRow = useMemo(
    () => customers.find((c) => c.id === keepId) ?? null,
    [customers, keepId],
  );
  const mergeRow = useMemo(() => {
    if (!firstRow || !secondRow) return null;
    return keepId === firstRow.id ? secondRow : firstRow;
  }, [firstRow, secondRow, keepId]);

  useEffect(() => {
    if (!keepRow || !mergeRow) return;
    const profile = defaultProfileFrom(keepRow, mergeRow);
    setName(profile.name);
    setPhone(profile.phone);
    setEmail(profile.email);
    setAddress(profile.address);
  }, [keepRow, mergeRow]);

  const keepInvoices = keepRow ? invoiceCountByCustomerId.get(keepRow.id) ?? 0 : 0;
  const mergeInvoices = mergeRow ? invoiceCountByCustomerId.get(mergeRow.id) ?? 0 : 0;

  function applyFieldFrom(source: "keep" | "merge", field: "name" | "phone" | "email" | "address") {
    const row = source === "keep" ? keepRow : mergeRow;
    if (!row) return;
    const value = row[field] ?? "";
    if (field === "name") setName(value);
    else if (field === "phone") setPhone(value);
    else if (field === "email") setEmail(value);
    else setAddress(value);
  }

  function handleProceed() {
    setError(null);
    if (!keepRow || !mergeRow) return;
    try {
      const profile = normalizeCustomerInput({ name, phone, email, address });
      assertValidCustomerInput(profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please enter valid customer details.");
      return;
    }
    setPhase("confirm");
  }

  async function handleConfirmMerge() {
    if (!keepRow || !mergeRow) return;
    setError(null);
    try {
      const profile = normalizeCustomerInput({ name, phone, email, address });
      assertValidCustomerInput(profile);
      setPending(true);
      await mergeCustomersViaApi(keepRow.id, mergeRow.id, profile);
      onMerged();
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed.");
      setPhase("select");
    } finally {
      setPending(false);
    }
  }

  function renderOption(option: CustomerOption) {
    const c = option.row;
    const inv = invoiceCountByCustomerId.get(c.id) ?? 0;
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{c.name}</span>
        <span className="text-xs text-muted-foreground">
          {c.is_active ? "Active" : "Archived"} · {inv} inv.
        </span>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={() => {
        if (!pending) onDismiss();
      }}
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
          Search and pick the two customer records that are duplicates. Their invoice and return
          history is combined into the record you keep.
        </p>

        <InlineAlert variant="warning" className="mt-3">
          <span className="font-medium">⚠ This cannot be undone.</span> One customer record is
          permanently deleted once you confirm.
        </InlineAlert>

        {phase === "select" ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="merge-first">First customer</Label>
                <SearchableSelect
                  options={firstOptions}
                  value={firstId}
                  onChange={setFirstId}
                  getDisplayValue={(o) => o.row.name}
                  renderOption={renderOption}
                  placeholder="Search customer…"
                  ariaLabel="First customer"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="merge-second">Second customer</Label>
                <SearchableSelect
                  options={secondOptions}
                  value={secondId}
                  onChange={setSecondId}
                  getDisplayValue={(o) => o.row.name}
                  renderOption={renderOption}
                  placeholder="Search customer…"
                  ariaLabel="Second customer"
                />
              </div>
            </div>

            {bothSelected && keepRow && mergeRow ? (
              <>
                <div className="space-y-1 border-t border-border pt-4">
                  <Label htmlFor="merge-keep-customer">Keep this customer record</Label>
                  <Select
                    id="merge-keep-customer"
                    value={keepId}
                    onChange={(e) => setKeepId(e.target.value)}
                  >
                    {[firstRow, secondRow].map((c) =>
                      c ? (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.is_active ? "Active" : "Archived"},{" "}
                          {invoiceCountByCustomerId.get(c.id) ?? 0} inv.)
                        </option>
                      ) : null,
                    )}
                  </Select>
                </div>

                <div className="rounded-lg border border-border bg-surface-muted/50 p-4 text-sm">
                  <p>
                    <span className="text-muted-foreground">Keep:</span>{" "}
                    <strong className="text-foreground">{keepRow.name}</strong> · {keepInvoices}{" "}
                    invoice{keepInvoices === 1 ? "" : "s"}
                  </p>
                  <p className="mt-2">
                    <span className="text-muted-foreground">Delete:</span>{" "}
                    <strong className="text-destructive">{mergeRow.name}</strong> · {mergeInvoices}{" "}
                    invoice{mergeInvoices === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Final customer details</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Edit the merged profile. Use quick-fill to copy a field from either record.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="merge-final-name">Name</Label>
                    <Input
                      id="merge-final-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                    />
                    <div className="flex flex-wrap gap-1">
                      <QuickFillButton
                        label={`Use "${keepRow.name}"`}
                        onClick={() => applyFieldFrom("keep", "name")}
                      />
                      <QuickFillButton
                        label={`Use "${mergeRow.name}"`}
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
                      maxLength={25}
                    />
                    <FieldQuickFill
                      keep={keepRow.phone}
                      merge={mergeRow.phone}
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
                      maxLength={120}
                    />
                    <FieldQuickFill
                      keep={keepRow.email}
                      merge={mergeRow.email}
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
                      maxLength={300}
                    />
                    <FieldQuickFill
                      keep={keepRow.address}
                      merge={mergeRow.address}
                      onKeep={() => applyFieldFrom("keep", "address")}
                      onMerge={() => applyFieldFrom("merge", "address")}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {error ? (
              <InlineAlert variant="error" className="mt-1">
                {error}
              </InlineAlert>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onDismiss}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={!bothSelected} onClick={handleProceed}>
                Merge
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <InlineAlert variant="error">
              You are about to permanently delete{" "}
              <strong>{mergeRow?.name}</strong>
              {mergeInvoices > 0 ? (
                <>
                  {" "}
                  and move its {mergeInvoices} invoice{mergeInvoices === 1 ? "" : "s"}
                </>
              ) : null}{" "}
              into <strong>{keepRow?.name}</strong>. This cannot be undone.
            </InlineAlert>

            <div className="rounded-lg border border-border bg-surface-muted/50 p-4 text-sm">
              <p>
                <span className="text-muted-foreground">Surviving record:</span>{" "}
                <strong className="text-foreground">{name.trim() || keepRow?.name}</strong>
              </p>
              {phone.trim() ? (
                <p className="mt-1 text-muted-foreground">Phone: {phone.trim()}</p>
              ) : null}
              {email.trim() ? (
                <p className="mt-1 text-muted-foreground">Email: {email.trim()}</p>
              ) : null}
              {address.trim() ? (
                <p className="mt-1 text-muted-foreground">Address: {address.trim()}</p>
              ) : null}
            </div>

            {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setPhase("select")}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                className={cn(pending && "opacity-70")}
                onClick={() => void handleConfirmMerge()}
              >
                {pending ? "Merging…" : "Confirm merge"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickFillButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
    >
      {label}
    </button>
  );
}

function FieldQuickFill({
  keep,
  merge,
  onKeep,
  onMerge,
}: {
  keep?: string;
  merge?: string;
  onKeep: () => void;
  onMerge: () => void;
}) {
  const hasKeep = Boolean(keep?.trim());
  const hasMerge = Boolean(merge?.trim());
  if (!hasKeep && !hasMerge) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {hasKeep ? <QuickFillButton label={`Keep: ${keep!.trim()}`} onClick={onKeep} /> : null}
      {hasMerge ? <QuickFillButton label={`Other: ${merge!.trim()}`} onClick={onMerge} /> : null}
    </div>
  );
}
