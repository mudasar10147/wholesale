import type { DeliveryBalanceRow } from "@/lib/invoices/deliveryBalanceList";
import { sumDeliveryBalanceDue } from "@/lib/invoices/deliveryBalanceList";
import { loadPublicPngAsDataUrl } from "@/lib/pdf/loadPublicImage";

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function downloadDeliveryBalanceListPdf(
  rows: DeliveryBalanceRow[],
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("downloadDeliveryBalanceListPdf is only available in the browser.");
  }
  if (rows.length === 0) {
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
  doc.text("Delivery balance list", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const totalDue = sumDeliveryBalanceDue(rows);
  doc.text(
    `${rows.length} invoice${rows.length === 1 ? "" : "s"} · Due ${formatMoney(totalDue)} PKR · ${new Date().toLocaleString()}`,
    margin,
    y,
  );
  y += 4;

  const body = rows.map((row) => [
    row.customerName,
    String(row.itemCount),
    formatMoney(row.invoiceTotal),
    row.paidAmount > 0.01 ? formatMoney(row.paidAmount) : "—",
    formatMoney(row.balanceDue),
    formatDate(row.createdAt),
    row.notes.trim() || "—",
  ]);

  autoTable(doc, {
    startY: y,
    tableWidth: pageInnerWidth,
    head: [["Customer", "Items", "Total", "Paid", "Due", "Created", "Notes"]],
    body,
    styles: {
      fontSize: 7.5,
      cellPadding: 1.6,
      minCellHeight: 7,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: { fillColor: [67, 56, 202], textColor: 255, fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: 12, halign: "right" },
      2: { cellWidth: 22, halign: "right" },
      3: { cellWidth: 20, halign: "right" },
      4: { cellWidth: 20, halign: "right", fontStyle: "bold" },
      5: { cellWidth: 24 },
      6: { cellWidth: pageInnerWidth - 136 },
    },
    margin: { left: margin, right: margin, bottom: 14 },
    didDrawPage() {
      const footerY = doc.internal.pageSize.getHeight() - 8;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.text("Wholesale — delivery balance list.", margin, footerY);
    },
  });

  const safeStamp = new Date().toISOString().slice(0, 10);
  doc.save(`delivery_balance_list_${safeStamp}.pdf`);
}
