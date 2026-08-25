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
const RETURN_FILL: [number, number, number] = [255, 247, 237];
const RETURN_TEXT: [number, number, number] = [124, 45, 18];
const SUBTOTAL_FILL: [number, number, number] = [241, 245, 249];
const HEAD_FILL: [number, number, number] = [67, 56, 202];

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: Date | null): string {
  if (!value) return "-";
  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

/** e.g. `Ghee 5L x2 (1 restock, 1 damaged) -4,800`. */
function describeReturnLine(line: DeliveryReturnLine): string {
  const split =
    line.quantityRestock > 0 && line.quantityDiscard > 0
      ? `${line.quantityRestock} restock, ${line.quantityDiscard} damaged`
      : line.quantityDiscard > 0
        ? "damaged"
        : "restock";
  return `${line.productName} x${line.quantityReturned} (${split}) -${formatMoney(line.creditAmount)}`;
}

function buildReturnsText(lines: readonly DeliveryReturnLine[]): string[] {
  const settled = lines.filter((line) => line.reducesBalance);
  const creditNotes = lines.filter((line) => !line.reducesBalance);
  const out: string[] = [];
  if (settled.length > 0) {
    out.push(`Returned: ${settled.map(describeReturnLine).join("; ")}`);
  }
  if (creditNotes.length > 0) {
    out.push(
      `Returned on credit note (settled on another invoice): ${creditNotes.map(describeReturnLine).join("; ")}`,
    );
  }
  return out;
}

function customerBandRow(group: DeliveryBalanceCustomerGroup): RowInput {
  const contact = [group.customerPhone, group.customerAddress]
    .map((value) => value.trim())
    .filter((value) => value && value !== "-")
    .join("   |   ");
  const content = contact
    ? `${group.customerName.toUpperCase()}\n${contact}`
    : group.customerName.toUpperCase();

  return [
    {
      content,
      colSpan: 8,
      styles: {
        fillColor: BAND_FILL,
        textColor: BAND_TEXT,
        fontStyle: "bold",
        fontSize: 8.5,
        cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
        minCellHeight: 9,
      },
    },
  ];
}

/**
 * `noteRowSpan` stretches the blank Note box down over this invoice's detail lines, so the
 * write-in column stays one unbroken box per invoice instead of being cut into slivers.
 */
function invoiceRow(row: DeliveryBalanceRow, noteRowSpan: number): RowInput {
  return [
    row.orderId,
    formatDate(row.createdAt),
    row.statusLabel,
    formatMoney(row.invoiceTotal),
    row.returnedAmount > 0.01 ? `-${formatMoney(row.returnedAmount)}` : "-",
    row.paidAmount > 0.01 ? formatMoney(row.paidAmount) : "-",
    formatMoney(row.balanceDue),
    { content: "", rowSpan: Math.max(1, noteRowSpan), styles: { valign: "top" } },
  ];
}

function detailRow(text: string, fill: [number, number, number], color: [number, number, number]): RowInput {
  return [
    {
      content: text,
      colSpan: 7,
      styles: {
        fillColor: fill,
        textColor: color,
        fontStyle: "italic",
        fontSize: 6.8,
        cellPadding: { top: 1, right: 2, bottom: 1, left: 6 },
        minCellHeight: 5,
      },
    },
  ];
}

function subtotalRow(group: DeliveryBalanceCustomerGroup): RowInput {
  const label =
    `${group.customerName} - ${group.invoiceCount} invoice${group.invoiceCount === 1 ? "" : "s"} pending` +
    `   |   Billed ${formatMoney(group.totalInvoiced)}` +
    (group.totalReturned > 0.01 ? `   |   Returns -${formatMoney(group.totalReturned)}` : "") +
    (group.totalPaid > 0.01 ? `   |   Paid ${formatMoney(group.totalPaid)}` : "") +
    "   |   BALANCE DUE";

  return [
    {
      content: label,
      colSpan: 6,
      styles: {
        fillColor: SUBTOTAL_FILL,
        fontStyle: "bold",
        fontSize: 7.5,
        halign: "right",
      },
    },
    {
      content: formatMoney(group.totalDue),
      styles: {
        fillColor: SUBTOTAL_FILL,
        fontStyle: "bold",
        fontSize: 8.5,
        halign: "right",
      },
    },
    { content: "", styles: { fillColor: SUBTOTAL_FILL } },
  ];
}

function spacerRow(): RowInput {
  return [
    {
      content: "",
      colSpan: 8,
      styles: { minCellHeight: 3, cellPadding: 0, fillColor: false, lineWidth: 0 },
    } as CellInput,
  ];
}

export const DELIVERY_LIST_HEAD = [
  ["Order", "Date", "Status", "Total", "Returns", "Paid", "Due", "Note"],
];

/**
 * One block per shop: a customer band (printed once), that shop's pending invoices one per
 * line, an indented detail line under any invoice with returned goods or a note, and the
 * shop's closing balance. Exported so the layout can be exercised without a browser.
 */
export function buildDeliveryListTableBody(
  groups: readonly DeliveryBalanceCustomerGroup[],
): RowInput[] {
  const body: RowInput[] = [];
  groups.forEach((group, index) => {
    if (index > 0) body.push(spacerRow());
    body.push(customerBandRow(group));
    for (const row of group.rows) {
      const returnTexts = buildReturnsText(row.returnLines);
      const noteText = row.notes ? `Invoice note: ${row.notes}` : null;
      body.push(invoiceRow(row, 1 + returnTexts.length + (noteText ? 1 : 0)));
      for (const text of returnTexts) {
        body.push(detailRow(text, RETURN_FILL, RETURN_TEXT));
      }
      if (noteText) {
        body.push(detailRow(noteText, SUBTOTAL_FILL, [51, 65, 85]));
      }
    }
    body.push(subtotalRow(group));
  });

  body.push(spacerRow());
  body.push([
    {
      content: "GRAND TOTAL DUE (all shops)",
      colSpan: 6,
      styles: {
        fontStyle: "bold",
        fontSize: 8.5,
        halign: "right",
        fillColor: BAND_FILL,
        textColor: BAND_TEXT,
      },
    },
    {
      content: formatMoney(sumGroupsBalanceDue(groups)),
      styles: {
        fontStyle: "bold",
        fontSize: 9.5,
        halign: "right",
        fillColor: BAND_FILL,
        textColor: BAND_TEXT,
      },
    },
    { content: "", styles: { fillColor: BAND_FILL } },
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
  const logoWidth = 44;
  const logoProps = doc.getImageProperties(logoDataUrl);
  const logoHeight = (logoWidth * logoProps.height) / logoProps.width;
  doc.addImage(logoDataUrl, "PNG", margin, y, logoWidth, logoHeight);
  y += logoHeight + 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Delivery / recovery list", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const invoiceCount = countGroupInvoices(groups);
  const totalDue = sumGroupsBalanceDue(groups);
  doc.text(
    `${groups.length} shop${groups.length === 1 ? "" : "s"} · ` +
      `${invoiceCount} pending invoice${invoiceCount === 1 ? "" : "s"} · ` +
      `Total due ${formatMoney(totalDue)} PKR · ${new Date().toLocaleString()}`,
    margin,
    y,
  );
  y += 4;

  const body = buildDeliveryListTableBody(groups);

  autoTable(doc, {
    startY: y,
    theme: "grid",
    tableWidth: pageInnerWidth,
    head: DELIVERY_LIST_HEAD,
    body,
    rowPageBreak: "avoid",
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 1.6,
      minCellHeight: 8,
      valign: "middle",
      overflow: "linebreak",
      lineColor: [203, 213, 225],
      lineWidth: 0.1,
    },
    headStyles: { fillColor: HEAD_FILL, textColor: 255, fontSize: 7.5, minCellHeight: 7 },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 19 },
      2: { cellWidth: 20 },
      3: { cellWidth: 22, halign: "right" },
      4: { cellWidth: 20, halign: "right" },
      5: { cellWidth: 21, halign: "right" },
      6: { cellWidth: 22, halign: "right", fontStyle: "bold" },
      7: { cellWidth: 34 },
    },
    margin: { left: margin, right: margin, bottom: 14 },
    didDrawPage(data) {
      const footerY = doc.internal.pageSize.getHeight() - 8;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.text(
        "Wholesale - delivery / recovery list. Total = billed before returns; Due = total - returns - paid.",
        margin,
        footerY,
      );
      doc.text(`Page ${data.pageNumber}`, pageWidth - margin, footerY, { align: "right" });
    },
  });

  const safeStamp = new Date().toISOString().slice(0, 10);
  doc.save(`delivery_balance_list_${safeStamp}.pdf`);
}
