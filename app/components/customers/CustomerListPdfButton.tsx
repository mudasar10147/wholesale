"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { useCustomers } from "@/lib/firestore/referenceData";
import { useCustomerEngagementSettings } from "@/lib/firestore/customerEngagementSettings";
import {
  getInvoiceAmountDue,
  getInvoiceEffectiveTotal,
  getInvoicePaidAmount,
} from "@/lib/invoices/invoiceEffective";
import {
  buildCustomerPdfRows,
  downloadCustomerListPdf,
  type CustomerPdfInvoice,
} from "@/lib/customers/customerListPdf";
import type { InvoiceDoc } from "@/lib/types/firestore";
import {
  CustomerListPdfModal,
  type CustomerPdfChoices,
} from "@/app/components/customers/CustomerListPdfModal";
import { Button } from "@/app/components/ui/Button";

type InvoiceRow = InvoiceDoc & { id: string };

function toDate(value: { toDate?: () => Date } | null | undefined): Date | null {
  try {
    return value?.toDate?.() ?? null;
  } catch {
    return null;
  }
}

export function CustomerListPdfButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);

  const { rows: customerRows } = useCustomers();
  const { settings } = useCustomerEngagementSettings();

  /**
   * Invoices are only subscribed once the dialog is opened. This page already pays for
   * several listeners; loading every invoice just in case someone might print a PDF
   * would be a large read cost for a button most visits never press.
   */
  useEffect(() => {
    if (!open) return;
    const unsub = onSnapshot(
      query(collection(getDb(), COLLECTIONS.invoices), orderBy("created_at", "desc")),
      (snap) => {
        const next: InvoiceRow[] = [];
        snap.forEach((d) => next.push({ id: d.id, ...(d.data() as InvoiceDoc) }));
        setInvoices(next);
        setInvoicesLoaded(true);
        setError(null);
      },
      (err) => {
        setInvoicesLoaded(true);
        setError(getFirestoreUserMessage(err));
      },
    );
    return () => unsub();
  }, [open]);

  const customers = useMemo(
    () =>
      customerRows.map(({ id, data }) => ({
        id,
        name: data.name,
        phone: data.phone,
        email: data.email,
        address: data.address,
        isActive: data.is_active,
        createdAt: toDate(data.created_at),
      })),
    [customerRows],
  );

  const pdfInvoices = useMemo<CustomerPdfInvoice[]>(() => {
    const out: CustomerPdfInvoice[] = [];
    for (const inv of invoices) {
      // Void invoices are not money that moved, and must not inflate anyone's totals.
      if (inv.status === "void") continue;
      const customerId = inv.customer_id?.trim();
      if (!customerId) continue;
      out.push({
        customerId,
        orderDate: toDate(inv.created_at) ?? new Date(0),
        effectiveTotal: getInvoiceEffectiveTotal(inv),
        paid: getInvoicePaidAmount(inv),
        unpaid: getInvoiceAmountDue(inv),
        discount: inv.posted_discount_amount ?? inv.discount_amount ?? 0,
        delivery: inv.posted_delivery_charge ?? inv.delivery_charge ?? 0,
      });
    }
    return out;
  }, [invoices]);

  const countFor = useCallback(
    (opts: { includeArchived: boolean; onlyUnpaid: boolean }) =>
      buildCustomerPdfRows(customers, pdfInvoices, { ...opts, settings }).length,
    [customers, pdfInvoices, settings],
  );

  const handleConfirm = useCallback(
    async (choices: CustomerPdfChoices) => {
      setPending(true);
      setError(null);
      try {
        const rows = buildCustomerPdfRows(customers, pdfInvoices, {
          settings,
          includeArchived: choices.includeArchived,
          onlyUnpaid: choices.onlyUnpaid,
        });
        const filters = [
          choices.onlyUnpaid ? "with an outstanding balance" : null,
          choices.includeArchived ? "including archived" : "active customers only",
        ].filter(Boolean);
        await downloadCustomerListPdf(rows, {
          columns: choices.columns,
          title: choices.onlyUnpaid ? "Customer balances" : "Customer list",
          subtitle: filters.join(" · "),
        });
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create the PDF.");
      } finally {
        setPending(false);
      }
    },
    [customers, pdfInvoices, settings],
  );

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Download PDF
      </Button>
      {open ? (
        <CustomerListPdfModal
          onClose={() => setOpen(false)}
          onConfirm={(choices) => void handleConfirm(choices)}
          pending={pending || !invoicesLoaded}
          error={error}
          {...(invoicesLoaded ? { matchCount: countFor } : {})}
        />
      ) : null}
    </>
  );
}
