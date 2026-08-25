import type { CellInput, RowInput } from "jspdf-autotable";
import type {
  DeliveryBalanceCustomerGroup,
  DeliveryBalanceRow,
  DeliveryReturnLine,
} from "@/lib/invoices/deliveryBalanceList";
import { countGroupInvoices, sumGroupsBalanceDue } from "@/lib/invoices/deliveryBalanceList";
import { loadPublicPngAsDataUrl } from "@/lib/pdf/loadPublicImage";

const BAND_FILL: [number, number, number] = [224, 231, 255];
const BAND_TEXT: [number, number, number] = [30, 27, 75];
const HEAD_FILL: [number, number, number] = [67, 56, 202];
const GOODS_TEXT: [number, number, number] = [124, 45, 18];

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: Date | null): string {
  if (!value) return "-";
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Long product names would wrap the row onto a second line. */
const MAX_GOODS_NAME = 16;

function shortProductName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > MAX_GOODS_NAME ? `${trimmed.slice(0, MAX_GOODS_NAME - 1)}.` : trimmed;
}

/**
 * Goods that came back, compressed to fit one line: `Ghee 5L x2 (1R/1D)`.
 * R = restocked, D = damaged, CN = credit note settled on another invoice.
 */
function describeReturnLine(line: DeliveryReturnLine): string {
  const split =
    line.quantityRestock > 0 && line.quantityDiscard > 0
      ? `${line.quantityRestock}R/${line.quantityDiscard}D`
      : line.quantityDiscard > 0
        ? "D"
        : "R";
  const suffix = line.reducesBalance ? "" : " CN";
  return `${shortProductName(line.productName)} x${line.quantityReturned} (${split}${suffix})`;
}

/**
 * Only the first product is named. Spelling out every returned line is what pushed an
 * invoice onto three rows; the credit total in the Returns column is the number the
 * salesman settles on, and the invoice itself carries the full breakdown.
 */
function returnedGoodsText(lines: readonly DeliveryReturnLine[]): string {
  if (lines.length === 0) return "";
  const [first, ...rest] = lines;
  const head = describeReturnLine(first);
  return rest.length > 0 ? `${head} +${rest.length}` : head;
}

/** Shop identity and closing balance on a single row, printed once per shop. */
function customerBandRow(group: DeliveryBalanceCustomerGroup): RowInput {
  const details = [group.customerName.toUpperCase(), group.customerPhone, group.customerAddress]
    .map((value) => value.trim())
    .filter((value) => value && value !== "-")
    .join("  ·  ");

  return [
    {
      content: details,
      colSpan: 7,
      styles: {
        fillColor: BAND_FILL,
        textColor: BAND_TEXT,
        fontStyle: "bold",
        fontSize: 7.5,
        minCellHeight: 7,
      },
    },
    {
      content: formatMoney(group.totalDue),
      styles: {
        fillColor: BAND_FILL,
        textColor: BAND_TEXT,
        fontStyle: "bold",
        fontSize: 8,
        halign: "right",
      },
    },
    { content: "", styles: { fillColor: BAND_FILL } },
  ];
}

function invoiceRow(row: DeliveryBalanceRow): RowInput {
  return [
    row.orderId,
    formatDate(row.createdAt),
    row.statusLabel,
    formatMoney(row.invoiceTotal),
    row.returnedAmount > 0.01 ? `-${formatMoney(row.returnedAmount)}` : "",
    {
      content: returnedGoodsText(row.returnLines),
      styles: { textColor: GOODS_TEXT, fontSize: 6.2, fontStyle: "italic" },
    },
    row.paidAmount > 0.01 ? formatMoney(row.paidAmount) : "",
    formatMoney(row.balanceDue),
    "",
  ];
}

export const DELIVERY_LIST_HEAD = [
  ["Order", "Date", "Status", "Total", "Returns", "Goods returned", "Paid", "Due", "Note"],
];

/**
 * One row per shop (name, phone, address, closing balance) followed by one row per unpaid
 * invoice. Deliberately flat: a salesman reads this on a doorstep, so vertical space costs
 * more than completeness.
 */
export function buildDeliveryListTableBody(
  groups: readonly DeliveryBalanceCustomerGroup[],
): RowInput[] {
  const body: RowInput[] = [];
  for (const group of groups) {
    body.push(customerBandRow(group));
    for (const row of group.rows) body.push(invoiceRow(row));
  }

  body.push([
    {
      content: "GRAND TOTAL DUE (all shops)",
      colSpan: 7,
      styles: {
        fontStyle: "bold",
        fontSize: 8,
        halign: "right",
        fillColor: HEAD_FILL,
        textColor: 255,
      },
    },
    {
      content: formatMoney(sumGroupsBalanceDue(groups)),
      styles: {
        fontStyle: "bold",
        fontSize: 8.5,
        halign: "right",
        fillColor: HEAD_FILL,
        textColor: 255,
      },
    },
    { content: "", styles: { fillColor: HEAD_FILL } } as CellInput,
  ]);

  return body;
}

export async function downloadDeliveryBalanceListPdf(
  groups: DeliveryBalanceCustomerGroup[],
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("downloadDeliveryBalanceListPdf is only available in the browser.");
  }
  if (groups.length === 0) {
    throw new Error("No invoices with a remaining balance to download.");
  }

  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const pageInnerWidth = pageWidth - 2 * margin;
  let y = margin;

  const logoDataUrl = await loadPublicPngAsDataUrl("/wholesale_logo.png", { maxWidthPx: 720 });
  const logoWidth = 36;
  const logoProps = doc.getImageProperties(logoDataUrl);
  const logoHeight = (logoWidth * logoProps.height) / logoProps.width;
  doc.addImage(logoDataUrl, "PNG", margin, y, logoWidth, logoHeight);
  y += logoHeight + 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Delivery / recovery list", margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const invoiceCount = countGroupInvoices(groups);
  const totalDue = sumGroupsBalanceDue(groups);
  doc.text(
    `${groups.length} shop${groups.length === 1 ? "" : "s"} · ` +
      `${invoiceCount} pending invoice${invoiceCount === 1 ? "" : "s"} · ` +
      `Total due ${formatMoney(totalDue)} PKR · ${new Date().toLocaleString()}`,
    margin,
    y,
  );
  y += 3;

  autoTable(doc, {
    startY: y,
    theme: "grid",
    tableWidth: pageInnerWidth,
    head: DELIVERY_LIST_HEAD,
    body: buildDeliveryListTableBody(groups),
    rowPageBreak: "avoid",
    styles: {
      font: "helvetica",
      fontSize: 7,
      cellPadding: 1.2,
      minCellHeight: 6,
      valign: "middle",
      overflow: "linebreak",
      lineColor: [203, 213, 225],
      lineWidth: 0.1,
    },
    headStyles: { fillColor: HEAD_FILL, textColor: 255, fontSize: 7, minCellHeight: 6 },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 13 },
      2: { cellWidth: 14 },
      3: { cellWidth: 19, halign: "right" },
      4: { cellWidth: 16, halign: "right" },
      5: { cellWidth: 40 },
      6: { cellWidth: 17, halign: "right" },
      7: { cellWidth: 19, halign: "right", fontStyle: "bold" },
      8: { cellWidth: 26 },
    },
    margin: { left: margin, right: margin, bottom: 12 },
    didDrawPage(data) {
      const footerY = doc.internal.pageSize.getHeight() - 7;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6.5);
      doc.text(
        "R = restocked, D = damaged, CN = credit note settled on another invoice. " +
          "Shop row shows that shop's total due; Due = Total - Returns - Paid.",
        margin,
        footerY,
      );
      doc.text(`Page ${data.pageNumber}`, pageWidth - margin, footerY, { align: "right" });
    },
  });

  const safeStamp = new Date().toISOString().slice(0, 10);
  doc.save(`delivery_balance_list_${safeStamp}.pdf`);
}
