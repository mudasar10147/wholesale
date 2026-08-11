/**
 * Receivables intelligence — what customers owe, how old it is, and what
 * collecting faster would release.
 *
 * Outstanding balances reuse the app's existing invoice balance rules
 * (`lib/invoices/invoiceEffective`), so a return or a partial payment is treated
 * exactly as it is on the Sales page.
 *
 * TradeBridge records no payment dates and no agreed credit terms — only a
 * running `paid_amount`. Ageing is therefore measured from the day the invoice
 * was posted, and the collection period is an estimate derived from the balance
 * against credit sales, not from observed payment dates. Both are labelled.
 */
import type { CustomerDoc, InvoiceDoc } from "@/lib/types/firestore";
import { getInvoiceAmountDue, getInvoiceEffectiveTotal } from "@/lib/invoices/invoiceEffective";
import { timestampToDate, type WithId } from "@/lib/bi/dataset";
import { MS_PER_DAY, startOfLocalDay } from "@/lib/bi/periods";
import { roundMoney2 } from "@/lib/bi/finance";

/** No credit-terms field exists; invoices are treated as due within this many days. */
export const ASSUMED_CREDIT_TERM_DAYS = 7;

export type AgingBucketId = "not_due" | "d1_7" | "d8_15" | "d16_30" | "d30_plus";

export type AgingBucket = {
  id: AgingBucketId;
  label: string;
  amount: number;
  invoiceCount: number;
  sharePct: number | null;
};

export type OutstandingInvoice = {
  invoiceId: string;
  orderId: string;
  customerId: string;
  customerName: string;
  amountDue: number;
  invoiceTotal: number;
  postedAt: Date | null;
  ageDays: number | null;
  daysOverdue: number;
  bucket: AgingBucketId;
};

export type CustomerExposure = {
  customerId: string;
  customerName: string;
  outstanding: number;
  invoiceCount: number;
  oldestAgeDays: number | null;
  overdueAmount: number;
  /** Share of all outstanding receivables, 0–100. */
  sharePct: number | null;
  /** Flags supported by recorded data only — no scoring model. */
  flags: string[];
};

export type ReceivablesReport = {
  totalOutstanding: number;
  invoiceCount: number;
  buckets: AgingBucket[];
  overdueTotal: number;
  overdueSharePct: number | null;
  invoices: OutstandingInvoice[];
  topCustomers: CustomerExposure[];
  /** Estimated days to collect: outstanding ÷ credit sales per day. */
  collectionPeriodDays: number | null;
  creditSalesInPeriod: number;
  creditSalesSharePct: number | null;
  /** Concentration: share of receivables held by the single largest customer. */
  largestCustomerSharePct: number | null;
  dataNote: string;
};

const BUCKET_LABELS: Record<AgingBucketId, string> = {
  not_due: `Within terms (≤ ${ASSUMED_CREDIT_TERM_DAYS} days)`,
  d1_7: "1–7 days overdue",
  d8_15: "8–15 days overdue",
  d16_30: "16–30 days overdue",
  d30_plus: "30+ days overdue",
};

export function bucketForOverdueDays(daysOverdue: number): AgingBucketId {
  if (daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 7) return "d1_7";
  if (daysOverdue <= 15) return "d8_15";
  if (daysOverdue <= 30) return "d16_30";
  return "d30_plus";
}

function ageInDays(postedAt: Date | null, now: Date): number | null {
  if (!postedAt) return null;
  const ms = startOfLocalDay(now).getTime() - startOfLocalDay(postedAt).getTime();
  return Math.max(0, Math.floor(ms / MS_PER_DAY));
}

export type ReceivablesInput = {
  invoices: readonly WithId<InvoiceDoc>[];
  customers: readonly WithId<CustomerDoc>[];
  now: Date;
  /** Invoice-linked (credit) sales in the analysis period. */
  creditSalesInPeriod: number;
  /** All sales in the analysis period, for the credit-share figure. */
  totalSalesInPeriod: number;
  periodDays: number;
};

export function buildReceivablesReport(input: ReceivablesInput): ReceivablesReport {
  const nameById = new Map<string, string>();
  for (const customer of input.customers) {
    const name = typeof customer.data.name === "string" ? customer.data.name.trim() : "";
    nameById.set(customer.id, name || "Unnamed customer");
  }

  const outstanding: OutstandingInvoice[] = [];
  for (const row of input.invoices) {
    const invoice = row.data;
    if (invoice.status !== "posted") continue;
    const amountDue = getInvoiceAmountDue(invoice);
    if (amountDue <= 0.01) continue;

    const postedAt = timestampToDate(invoice.posted_at) ?? timestampToDate(invoice.created_at);
    const age = ageInDays(postedAt, input.now);
    const daysOverdue = age === null ? 0 : Math.max(0, age - ASSUMED_CREDIT_TERM_DAYS);

    outstanding.push({
      invoiceId: row.id,
      orderId: invoice.order_id ?? row.id,
      customerId: invoice.customer_id ?? "",
      customerName: nameById.get(invoice.customer_id ?? "") ?? "Unknown customer",
      amountDue,
      invoiceTotal: getInvoiceEffectiveTotal(invoice),
      postedAt,
      ageDays: age,
      daysOverdue,
      bucket: bucketForOverdueDays(daysOverdue),
    });
  }

  outstanding.sort((a, b) => b.amountDue - a.amountDue);

  const totalOutstanding = roundMoney2(outstanding.reduce((sum, i) => sum + i.amountDue, 0));

  const bucketOrder: AgingBucketId[] = ["not_due", "d1_7", "d8_15", "d16_30", "d30_plus"];
  const buckets: AgingBucket[] = bucketOrder.map((id) => {
    const rows = outstanding.filter((i) => i.bucket === id);
    const amount = roundMoney2(rows.reduce((sum, i) => sum + i.amountDue, 0));
    return {
      id,
      label: BUCKET_LABELS[id],
      amount,
      invoiceCount: rows.length,
      sharePct: totalOutstanding > 0 ? (amount / totalOutstanding) * 100 : null,
    };
  });

  const overdueTotal = roundMoney2(
    buckets.filter((b) => b.id !== "not_due").reduce((sum, b) => sum + b.amount, 0),
  );

  const byCustomer = new Map<string, CustomerExposure>();
  for (const invoice of outstanding) {
    const key = invoice.customerId || "__unknown__";
    let row = byCustomer.get(key);
    if (!row) {
      row = {
        customerId: key,
        customerName: invoice.customerName,
        outstanding: 0,
        invoiceCount: 0,
        oldestAgeDays: null,
        overdueAmount: 0,
        sharePct: null,
        flags: [],
      };
      byCustomer.set(key, row);
    }
    row.outstanding = roundMoney2(row.outstanding + invoice.amountDue);
    row.invoiceCount += 1;
    if (invoice.ageDays !== null) {
      row.oldestAgeDays = Math.max(row.oldestAgeDays ?? 0, invoice.ageDays);
    }
    if (invoice.daysOverdue > 0) {
      row.overdueAmount = roundMoney2(row.overdueAmount + invoice.amountDue);
    }
  }

  const topCustomers = [...byCustomer.values()]
    .map((row) => {
      const sharePct = totalOutstanding > 0 ? (row.outstanding / totalOutstanding) * 100 : null;
      const flags: string[] = [];
      if (row.overdueAmount > 0.01) {
        flags.push(`${formatShortMoney(row.overdueAmount)} past the ${ASSUMED_CREDIT_TERM_DAYS}-day mark`);
      }
      if ((row.oldestAgeDays ?? 0) > 30) {
        flags.push(`oldest invoice is ${row.oldestAgeDays} days old`);
      }
      if (sharePct !== null && sharePct >= 30) {
        flags.push(`${sharePct.toFixed(0)}% of all money owed to you`);
      }
      if (row.invoiceCount >= 4) {
        flags.push(`${row.invoiceCount} unpaid invoices open at once`);
      }
      return { ...row, sharePct, flags };
    })
    .sort((a, b) => b.outstanding - a.outstanding);

  const creditSalesPerDay =
    input.periodDays > 0 && input.creditSalesInPeriod > 0
      ? input.creditSalesInPeriod / input.periodDays
      : null;
  const collectionPeriodDays =
    creditSalesPerDay !== null && creditSalesPerDay > 0 ? totalOutstanding / creditSalesPerDay : null;

  return {
    totalOutstanding,
    invoiceCount: outstanding.length,
    buckets,
    overdueTotal,
    overdueSharePct: totalOutstanding > 0 ? (overdueTotal / totalOutstanding) * 100 : null,
    invoices: outstanding,
    topCustomers,
    collectionPeriodDays,
    creditSalesInPeriod: roundMoney2(input.creditSalesInPeriod),
    creditSalesSharePct:
      input.totalSalesInPeriod > 0
        ? (input.creditSalesInPeriod / input.totalSalesInPeriod) * 100
        : null,
    largestCustomerSharePct: topCustomers[0]?.sharePct ?? null,
    dataNote: `TradeBridge records how much of an invoice is paid but not the date it was paid, and it holds no agreed credit terms. Ageing is counted from the day each invoice was posted, with ${ASSUMED_CREDIT_TERM_DAYS} days treated as within terms. The collection period is estimated from the balance against credit sales.`,
  };
}

function formatShortMoney(value: number): string {
  return `Rs. ${Math.round(value).toLocaleString()}`;
}

export type CollectionImprovement = {
  currentDays: number | null;
  targetDays: number;
  daysSaved: number | null;
  capitalReleased: number | null;
  sentence: string;
};

/**
 * What collecting `daysFaster` sooner would free up: each day of collection time
 * ties up one day of credit sales.
 */
export function simulateCollectionImprovement(params: {
  collectionPeriodDays: number | null;
  creditSalesInPeriod: number;
  periodDays: number;
  daysFaster: number;
}): CollectionImprovement {
  const { collectionPeriodDays, creditSalesInPeriod, periodDays, daysFaster } = params;
  const perDay = periodDays > 0 ? creditSalesInPeriod / periodDays : 0;

  if (collectionPeriodDays === null || perDay <= 0) {
    return {
      currentDays: collectionPeriodDays,
      targetDays: Math.max(0, (collectionPeriodDays ?? 0) - daysFaster),
      daysSaved: null,
      capitalReleased: null,
      sentence:
        "Collecting faster can only be valued once there are credit sales and an outstanding balance to measure against.",
    };
  }

  const target = Math.max(0, collectionPeriodDays - Math.max(0, daysFaster));
  const saved = collectionPeriodDays - target;
  const released = roundMoney2(saved * perDay);

  return {
    currentDays: collectionPeriodDays,
    targetDays: target,
    daysSaved: saved,
    capitalReleased: released,
    sentence: `If customers paid on average in ${target.toFixed(1)} days instead of ${collectionPeriodDays.toFixed(1)}, roughly ${formatShortMoney(released)} of working capital could be released. This is an estimate from current credit-sales pace, not a guaranteed amount.`,
  };
}
