import { sortReorderRowsByCategory, type ReorderListRow } from "@/lib/inventory/reorderList";
import { loadPublicPngAsDataUrl } from "@/lib/pdf/loadPublicImage";

export type DownloadReorderListPdfOptions = {
  threshold: number;
  title?: string;
};

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatStock(value: number): string {
  return value <= 0 ? "0" : value.toLocaleString();
}

export async function downloadReorderListPdf(
  rows: ReorderListRow[],
  options: DownloadReorderListPdfOptions,
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("downloadReorderListPdf is only available in the browser.");
  }
  if (rows.length === 0) {
    throw new Error("Add at least one product to the shopping list.");
  }

  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const pageInnerWidth = pageWidth - 2 * margin;
  let y = margin;

  const title = options.title?.trim() || "Hall Road shopping list";
  const headLabels = [
    "Product",
    "Purchase price",
    "Stock",
    "New purchase price",
    "Qty purchased",
  ];

  const logoDataUrl = await loadPublicPngAsDataUrl("/wholesale_logo.png", { maxWidthPx: 720 });
  const logoWidth = 52;
  const logoProps = doc.getImageProperties(logoDataUrl);
  const logoHeight = (logoWidth * logoProps.height) / logoProps.width;
  doc.addImage(logoDataUrl, "PNG", margin, y, logoWidth, logoHeight);
  y += logoHeight + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const introLines = [
    `Products at or below ${options.threshold} units in stock.`,
    `Generated on: ${new Date().toLocaleString()}`,
    "Fill in new purchase price and quantity purchased while shopping.",
  ];
  for (const line of introLines) {
    const split = doc.splitTextToSize(line, pageInnerWidth);
    doc.text(split, margin, y);
    y += split.length * 4.2;
  }
  y += 2;

  const body = sortReorderRowsByCategory(rows).map((row) => [
    row.name,
    formatMoney(row.purchasePrice),
    formatStock(row.stockQuantity),
    "",
    "",
  ]);

  const productWidth = pageInnerWidth * 0.34;
  const numericWidth = (pageInnerWidth - productWidth) / 4;

  autoTable(doc, {
    startY: y,
    head: [headLabels],
    body,
    styles: { fontSize: 9, cellPadding: 2.2, minCellHeight: 10, valign: "middle" },
    headStyles: { fillColor: [67, 56, 202], textColor: 255, fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: productWidth },
      1: { cellWidth: numericWidth, halign: "right" },
      2: { cellWidth: numericWidth, halign: "right" },
      3: { cellWidth: numericWidth, halign: "center", fillColor: [252, 252, 253] },
      4: { cellWidth: numericWidth, halign: "center", fillColor: [252, 252, 253] },
    },
    margin: { left: margin, right: margin, bottom: 18 },
    didDrawPage() {
      const footerY = doc.internal.pageSize.getHeight() - 10;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text("Wholesale — reorder list for Hall Road purchasing.", margin, footerY);
    },
  });

  const safeStamp = new Date().toISOString().slice(0, 10);
  doc.save(`hall_road_shopping_list_${safeStamp}.pdf`);
}
