"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { logFirestoreError } from "@/lib/firebase/firestoreDebug";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { recordCustomerPayment } from "@/lib/firestore/customerPayments";
import { useCustomers } from "@/lib/firestore/referenceData";
import {
  appliedLines,
  describePaymentPlanProblem,
  paymentPlanProblem,
  planCustomerPayment,
  type PaymentAllocationLine,
  type PaymentAllocationPlan,
} from "@/lib/invoices/customerPaymentAllocation";
import type { InvoiceDoc } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { SearchableSelect } from "@/app/components/ui/SearchableSelect";
import { cn } from "@/lib/utils";

type InvoiceRow = InvoiceDoc & { id: string };

type CustomerOption = {
  id: string;
  name: string;
  phone: string;
  address: string;
  isActive: boolean;
  searchText: string;
};

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDay(ts?: { toDate(): Date } | null) {
  try {
    return ts ? ts.toDate().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
  } catch {
    return "—";
  }
}

/** "Pays off 2 invoices and part of the next." — the split in one line. */
function describeSplit(touched: readonly PaymentAllocationLine[]): string {
  const paidOff = touched.filter((line) => line.dueAfter <= 0).length;
  const partial = touched.some((line) => line.dueAfter > 0);
  if (paidOff === 0) return partial ? "Part-pays the oldest invoice." : "";
  const invoices = `${paidOff} invoice${paidOff === 1 ? "" : "s"}`;
  return partial ? `Pays off ${invoices} and part of the next.` : `Pays off ${invoices}.`;
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

type Props = {
  /** Opens with this customer already chosen (e.g. from their ledger row). */
  initialCustomerId?: string;
  onClose: () => void;
};

/**
 * Admin: record one lump-sum payment from a customer. It settles their posted invoices
 * oldest first and carries the rest forward; the split is previewed before anything is
 * written, and an amount larger than what they owe is refused outright.
 */
export function ReceiveCustomerPaymentModal({ initialCustomerId = "", onClose }: Props) {
  const customers = useCustomers();
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [amountInput, setAmountInput] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ customerName: string; plan: PaymentAllocationPlan } | null>(null);

  // Only the chosen customer's invoices, live: the preview must track the balances the
  // write will see, and one customer's invoices cost a handful of reads, not the collection.
  useEffect(() => {
    setInvoices([]);
    setLoadedFor(null);
    setLoadError(null);
    if (!customerId) return;
    const unsub = onSnapshot(
      query(collection(getDb(), COLLECTIONS.invoices), where("customer_id", "==", customerId)),
      (snap) => {
        const next: InvoiceRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InvoiceDoc) }));
        setInvoices(next);
        setLoadedFor(customerId);
      },
      (err) => {
        setLoadedFor(customerId);
        setLoadError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, [customerId]);

  const customerOptions = useMemo<CustomerOption[]>(
    () =>
      customers.rows
        .map(({ id, data }) => {
          const name = data.name?.trim() || id;
          const phone = data.phone?.trim() ?? "";
          const address = data.address?.trim() ?? "";
          return {
            id,
            name,
            phone,
            address,
            isActive: data.is_active !== false,
            searchText: `${name} ${phone} ${address}`.toLowerCase(),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [customers.rows],
  );
  const customerName = customerOptions.find((c) => c.id === customerId)?.name ?? customerId;

  const loadingInvoices = !!customerId && loadedFor !== customerId;
  const parsedAmount = parseAmount(amountInput);
  const plan = useMemo(() => planCustomerPayment(invoices, parsedAmount ?? 0), [invoices, parsedAmount]);
  const problem = paymentPlanProblem(plan);
  const touched = appliedLines(plan);

  const drafts = useMemo(() => invoices.filter((inv) => inv.status === "draft"), [invoices]);
  const draftTotal = drafts.reduce(
    (sum, inv) => sum + Math.max(0, inv.total_amount - (inv.returns_credit_amount ?? 0)),
    0,
  );
  const postedAtById = useMemo(() => new Map(invoices.map((inv) => [inv.id, inv.posted_at])), [invoices]);

  const canSubmit = !pending && !loadingInvoices && !loadError && !!customerId && problem === null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || parsedAmount === null) return;
    setSubmitError(null);
    setPending(true);
    try {
      const saved = await recordCustomerPayment(getDb(), {
        customerId,
        amount: parsedAmount,
        expectedSplit: touched,
      });
      setRecorded({ customerName, plan: saved });
    } catch (err) {
      logFirestoreError("receive customer payment", err);
      setSubmitError(getFirestoreUserMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={pending ? undefined : onClose}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receive-payment-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-6 pb-4 pt-5">
          <h2 id="receive-payment-title" className="text-lg font-semibold text-foreground">
            Receive payment
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One amount from the customer, applied to their oldest posted invoice first. Whatever is left
            moves on to the next one.
          </p>
        </div>

        {recorded ? (
          <RecordedSummary customerName={recorded.customerName} plan={recorded.plan} onDone={onClose} />
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <div className="space-y-2">
                <Label>Customer</Label>
                <SearchableSelect
                  options={customerOptions}
                  value={customerId}
                  onChange={(id) => {
                    setCustomerId(id);
                    setSubmitError(null);
                  }}
                  getDisplayValue={(c) => c.name}
                  renderOption={(c) => (
                    <div className="space-y-0.5">
                      <p className="font-medium text-foreground">
                        {c.name}
                        {c.isActive ? null : <span className="ml-1.5 text-xs text-muted-foreground">(archived)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[c.phone, c.address].filter(Boolean).join(" · ") || "No phone or address"}
                      </p>
                    </div>
                  )}
                  placeholder={customers.loading ? "Loading customers…" : "Search customer by name, phone, address"}
                  emptyText="No customers match your search."
                  disabled={pending}
                  ariaLabel="Customer"
                />
              </div>

              {customers.error ? <InlineAlert variant="error">{customers.error}</InlineAlert> : null}
              {loadError ? <InlineAlert variant="error">{loadError}</InlineAlert> : null}

              {!customerId ? null : loadingInvoices ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Loading invoices…
                </p>
              ) : loadError ? null : (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5 text-sm">
                    <span className="text-muted-foreground">
                      Due on {plan.lines.length} posted invoice{plan.lines.length === 1 ? "" : "s"}
                    </span>
                    <span className="text-lg font-bold tabular-nums text-destructive">{formatMoney(plan.totalDue)}</span>
                  </div>

                  {plan.totalDue > 0 ? (
                    <div className="space-y-2">
                      <Label htmlFor="receive-payment-amount">Amount received</Label>
                      <Input
                        id="receive-payment-amount"
                        type="text"
                        inputMode="decimal"
                        value={amountInput}
                        onChange={(e) => {
                          setAmountInput(e.target.value);
                          setSubmitError(null);
                        }}
                        placeholder="0"
                        disabled={pending}
                        aria-invalid={problem === "exceeds_due"}
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={pending}
                        onClick={() => setAmountInput(String(plan.totalDue))}
                      >
                        Pay full balance ({formatMoney(plan.totalDue)})
                      </Button>
                    </div>
                  ) : (
                    <InlineAlert variant="info">{describePaymentPlanProblem(plan, "nothing_due")}</InlineAlert>
                  )}

                  {problem === "exceeds_due" ? (
                    <InlineAlert variant="warning">{describePaymentPlanProblem(plan, problem)}</InlineAlert>
                  ) : null}
                  {amountInput.trim() && problem === "invalid_amount" ? (
                    <InlineAlert variant="warning">{describePaymentPlanProblem(plan, problem)}</InlineAlert>
                  ) : null}

                  {plan.lines.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-border bg-surface-muted">
                            <th className="px-3 py-2 font-semibold">Invoice</th>
                            <th className="px-3 py-2 font-semibold">Posted</th>
                            <th className="px-3 py-2 text-right font-semibold">Due now</th>
                            <th className="px-3 py-2 text-right font-semibold">This payment</th>
                            <th className="px-3 py-2 text-right font-semibold">Due after</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.lines.map((line) => {
                            const gets = line.applied > 0;
                            return (
                              <tr
                                key={line.invoiceId}
                                className={cn(
                                  "border-b border-border last:border-b-0",
                                  gets ? "bg-success-muted/40" : "text-muted-foreground",
                                )}
                              >
                                <td className="px-3 py-2 font-mono text-[13px]">{line.orderId}</td>
                                <td className="px-3 py-2">{formatDay(postedAtById.get(line.invoiceId))}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(line.dueBefore)}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-medium">
                                  {gets ? formatMoney(line.applied) : "—"}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {gets && line.dueAfter <= 0 ? (
                                    <span className="rounded-full bg-success-muted px-2 py-0.5 text-xs font-medium text-success">
                                      Paid
                                    </span>
                                  ) : (
                                    formatMoney(line.dueAfter)
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {problem === null ? (
                    <p className="text-sm text-muted-foreground">
                      {describeSplit(touched)} Still due afterwards:{" "}
                      <span className="font-semibold tabular-nums text-foreground">{formatMoney(plan.dueAfter)}</span>
                    </p>
                  ) : null}

                  {plan.held.length > 0 ? (
                    <InlineAlert variant="info">
                      Left out:{" "}
                      {plan.held.map((h) => `${h.orderId} (${formatMoney(h.amountDue)} due)`).join(", ")}. Goods handed
                      back on {plan.held.length === 1 ? "this invoice have" : "these invoices have"} not finished posting,
                      so {plan.held.length === 1 ? "its balance is" : "their balances are"} not final yet and a payment
                      recorded now could be lost.
                    </InlineAlert>
                  ) : null}

                  {drafts.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {drafts.length} draft invoice{drafts.length === 1 ? "" : "s"} ({formatMoney(draftTotal)}) not
                      included — a draft has to be posted before it can take a payment.
                    </p>
                  ) : null}
                </>
              )}

              {submitError ? <InlineAlert variant="error">{submitError}</InlineAlert> : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {pending
                  ? "Saving…"
                  : problem === null
                    ? `Record ${formatMoney(plan.amount)} on ${touched.length} invoice${touched.length === 1 ? "" : "s"}`
                    : "Record payment"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function RecordedSummary({
  customerName,
  plan,
  onDone,
}: {
  customerName: string;
  plan: PaymentAllocationPlan;
  onDone: () => void;
}) {
  const lines = appliedLines(plan);
  return (
    <div className="space-y-4 px-6 py-5">
      <InlineAlert variant="success">
        Recorded <strong>{formatMoney(plan.amount)}</strong> from {customerName}.
      </InlineAlert>
      <ul className="space-y-1.5 text-sm">
        {lines.map((line) => (
          <li key={line.invoiceId} className="flex flex-wrap justify-between gap-2">
            <span className="font-mono text-[13px] text-foreground">{line.orderId}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatMoney(line.applied)} applied ·{" "}
              {line.dueAfter <= 0 ? (
                <span className="font-medium text-success">paid in full</span>
              ) : (
                <span className="font-medium text-foreground">{formatMoney(line.dueAfter)} still due</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Still due on posted invoices:{" "}
        <span className="font-semibold tabular-nums text-foreground">{formatMoney(plan.dueAfter)}</span>
      </p>
      <div className="flex justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
