/**
 * "Download PDF" for the customer list.
 *
 * Every column is optional except the name, because the sheet gets used for different
 * jobs: a phone list to carry on deliveries, a collections list of who owes what, or a
 * full record for the file. The caller picks; this module only knows how to render.
 *
 * Row building is kept pure and separate from the PDF so the numbers can be tested
 * without a browser — see customerListPdf.test.ts.
 */
import {
  computeCustomerEngagement,
  type CustomerEngagementTier,
} from "@/lib/customers/customerEngagement";
import type { CustomerEngagementTierSettings } from "@/lib/customers/customerEngagementConfig";
import { loadPublicPngAsDataUrl } from "@/lib/pdf/loadPublicImage";

export type CustomerPdfColumn =
  | "phone"
  | "email"
  | "address"
  | "status"
  | "tier"
  | "orders"
  | "lastOrder"
  | "totalPurchased"
  | "paid"
  | "unpaid"
  | "discount"
  | "delivery"
  | "since";

export const CUSTOMER_PDF_COLUMN_LABELS: Record<CustomerPdfColumn, string> = {
  phone: "Phone",
  email: "Email",
  address: "Address",
  status: "Status",
  tier: "Tier",
  orders: "Orders",
  lastOrder: "Last order",
  totalPurchased: "Total purchased",
  paid: "Paid",
  unpaid: "Unpaid",
  discount: "Discounts",
  delivery: "Delivery",
  since: "Customer since",
};

/** Column order on the page, independent of the order they were ticked in. */
export const CUSTOMER_PDF_COLUMN_ORDER: CustomerPdfColumn[] = [
  "phone",
  "email",
  "address",
  "status",
  "tier",
  "orders",
  "lastOrder",
  "totalPurchased",
  "paid",
  "unpaid",
  "discount",
  "delivery",
  "since",
];

/** Right-aligned in the table; the rest read better left-aligned. */
const NUMERIC_COLUMNS: ReadonlySet<CustomerPdfColumn> = new Set([
  "orders",
  "totalPurchased",
  "paid",
  "unpaid",
  "discount",
  "delivery",
]);

export const DEFAULT_CUSTOMER_PDF_COLUMNS: CustomerPdfColumn[] = [
  "phone",
  "address",
  "totalPurchased",
  "unpaid",
];

export type CustomerPdfInput = {
  id: string;
  name: string;
  phone?: string | undefined;
  email?: string | undefined;
  address?: string | undefined;
  isActive: boolean;
  createdAt: Date | null;
};

/** One posted invoice, already reduced to the figures the sheet reports. */
export type CustomerPdfInvoice = {
  customerId: string;
  orderDate: Date;
  effectiveTotal: number;
  paid: number;
  unpaid: number;
  discount: number;
  delivery: number;
};

export type CustomerPdfRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  isActive: boolean;
  createdAt: Date | null;
  tier: CustomerEngagementTier;
  orders: number;
  lastOrder: Date | null;
  totalPurchased: number;
  paid: number;
  unpaid: number;
  discount: number;
  delivery: number;
};

export type BuildCustomerPdfRowsOptions = {
  settings?: CustomerEngagementTierSettings;
  now?: Date;
  /** Archived customers are left out unless asked for. */
  includeArchived?: boolean;
  /** Collections mode: only customers who still owe money. */
  onlyUnpaid?: boolean;
};

const TIER_LABELS: Record<CustomerEngagementTier, string> = {
  premium: "Premium",
  silver: "Silver",
  bronze: "Bronze",
  none: "—",
};

/**
 * Combine customers with their invoice history.
 *
 * Customers with no invoices are still returned (with zeroes) — a customer list that
 * silently dropped everyone who has not ordered yet would be wrong for its main use.
 */
export function buildCustomerPdfRows(
  customers: readonly CustomerPdfInput[],
  invoices: readonly CustomerPdfInvoice[],
  options: BuildCustomerPdfRowsOptions = {},
): CustomerPdfRow[] {
  const totals = new Map<
    string,
    { orders: number; purchased: number; paid: number; unpaid: number; discount: number; delivery: number }
  >();

  for (const inv of invoices) {
    const id = inv.customerId?.trim();
    if (!id) continue;
    const bucket = totals.get(id) ?? {
      orders: 0,
      purchased: 0,
      paid: 0,
      unpaid: 0,
      discount: 0,
      delivery: 0,
    };
    bucket.orders += 1;
    bucket.purchased += inv.effectiveTotal;
    bucket.paid += inv.paid;
    bucket.unpaid += inv.unpaid;
    bucket.discount += inv.discount;
    bucket.delivery += inv.delivery;
    totals.set(id, bucket);
  }

  // Reuse the tier rules the Engagement tab shows, so the PDF cannot disagree with it.
  const engagement = new Map(
    computeCustomerEngagement(
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        ...(c.phone !== undefined ? { phone: c.phone } : {}),
        ...(c.email !== undefined ? { email: c.email } : {}),
        is_active: c.isActive,
      })),
      invoices.map((i) => ({
        customer_id: i.customerId,
        orderDate: i.orderDate,
        effectiveTotal: i.effectiveTotal,
      })),
      {
        ...(options.settings ? { settings: options.settings } : {}),
        ...(options.now ? { now: options.now } : {}),
      },
    ).map((row) => [row.customerId, row]),
  );

  const rows: CustomerPdfRow[] = [];
  for (const customer of customers) {
    if (!options.includeArchived && !customer.isActive) continue;
    const t = totals.get(customer.id);
    const e = engagement.get(customer.id);
    const unpaid = t?.unpaid ?? 0;
    if (options.onlyUnpaid && unpaid <= 0) continue;

    rows.push({
      id: customer.id,
      name: customer.name,
      phone: customer.phone?.trim() ?? "",
      email: customer.email?.trim() ?? "",
      address: customer.address?.trim() ?? "",
      isActive: customer.isActive,
      createdAt: customer.createdAt,
      tier: e?.tier ?? "none",
      orders: t?.orders ?? 0,
      lastOrder: e?.lastOrderDate ?? null,
      totalPurchased: t?.purchased ?? 0,
      paid: t?.paid ?? 0,
      unpaid,
      discount: t?.discount ?? 0,
      delivery: t?.delivery ?? 0,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString();
}

export function customerCellValue(row: CustomerPdfRow, column: CustomerPdfColumn): string {
  switch (column) {
    case "phone":
      return row.phone || "—";
    case "email":
      return row.email || "—";
    case "address":
      return row.address || "—";
    case "status":
      return row.isActive ? "Active" : "Archived";
    case "tier":
      return TIER_LABELS[row.tier];
    case "orders":
      return row.orders.toLocaleString();
    case "lastOrder":
      return formatDate(row.lastOrder);
    case "totalPurchased":
      return money(row.totalPurchased);
    case "paid":
      return money(row.paid);
    case "unpaid":
      return money(row.unpaid);
    case "discount":
      return money(row.discount);
    case "delivery":
      return money(row.delivery);
    case "since":
      return formatDate(row.createdAt);
  }
}

/** Totals row for the money columns — the number the office actually reads off the sheet. */
export function customerTotalsRow(
  rows: readonly CustomerPdfRow[],
  columns: readonly CustomerPdfColumn[],
): string[] {
  const sum = (pick: (r: CustomerPdfRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
  return [
    `Total — ${rows.length} customer${rows.length === 1 ? "" : "s"}`,
    ...columns.map((c) => {
      switch (c) {
        case "orders":
          return sum((r) => r.orders).toLocaleString();
        case "totalPurchased":
          return money(sum((r) => r.totalPurchased));
        case "paid":
          return money(sum((r) => r.paid));
        case "unpaid":
          return money(sum((r) => r.unpaid));
        case "discount":
          return money(sum((r) => r.discount));
        case "delivery":
          return money(sum((r) => r.delivery));
        default:
          return "";
      }
    }),
  ];
}

export type DownloadCustomerListPdfOptions = {
  columns: CustomerPdfColumn[];
  title?: string;
  /** Printed under the title so the reader knows what was filtered out. */
  subtitle?: string;
};

export async function downloadCustomerListPdf(
  rows: readonly CustomerPdfRow[],
  options: DownloadCustomerListPdfOptions,
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("downloadCustomerListPdf is only available in the browser.");
  }

  const columns = CUSTOMER_PDF_COLUMN_ORDER.filter((c) => options.columns.includes(c));
  if (columns.length === 0) {
    throw new Error("Select at least one column besides customer name.");
  }
  if (rows.length === 0) {
    throw new Error("No customers match those options.");
  }

  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default;

  // Wide selections do not fit A4 portrait; rotating beats shrinking the text to 6pt.
  const orientation = columns.length > 4 ? "landscape" : "portrait";
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation });
  const margin = 14;
  const pageInnerWidth = doc.internal.pageSize.getWidth() - 2 * margin;
  let y = margin;

  const logoDataUrl = await loadPublicPngAsDataUrl("/wholesale_logo.png", { maxWidthPx: 720 });
  const logoWidth = 50;
  const logoProps = doc.getImageProperties(logoDataUrl);
  doc.addImage(logoDataUrl, "PNG", margin, y, logoWidth, (logoWidth * logoProps.height) / logoProps.width);
  y += (logoWidth * logoProps.height) / logoProps.width + 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(options.title?.trim() || "Customer list", margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(90);
  for (const line of [options.subtitle?.trim(), `Generated on ${new Date().toLocaleString()}`]) {
    if (!line) continue;
    const split = doc.splitTextToSize(line, pageInnerWidth);
    doc.text(split, margin, y);
    y += split.length * 4.6;
  }
  doc.setTextColor(0);
  y += 2;

  const head = ["Customer", ...columns.map((c) => CUSTOMER_PDF_COLUMN_LABELS[c])];
  const body = rows.map((row) => [row.name, ...columns.map((c) => customerCellValue(row, c))]);

  const columnStyles: Record<number, { halign?: "right"; cellWidth?: number }> = {};
  columns.forEach((c, i) => {
    if (NUMERIC_COLUMNS.has(c)) columnStyles[i + 1] = { halign: "right" };
  });

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    foot: [customerTotalsRow(rows, columns)],
    styles: { fontSize: columns.length >= 7 ? 7.5 : columns.length >= 5 ? 8.5 : 9.5, cellPadding: 1.6 },
    headStyles: { fillColor: [67, 56, 202], textColor: 255 },
    footStyles: { fillColor: [236, 240, 255], textColor: [31, 41, 55], fontStyle: "bold" },
    columnStyles,
    margin: { left: margin, right: margin, bottom: 20 },
    didDrawPage() {
      const page = doc.getCurrentPageInfo().pageNumber;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Page ${page}`, margin, doc.internal.pageSize.getHeight() - 10);
      doc.setTextColor(0);
    },
  });

  doc.save(`customers_${new Date().toISOString().slice(0, 10)}.pdf`);
}
