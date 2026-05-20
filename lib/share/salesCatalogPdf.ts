import type { ProductDoc } from "@/lib/types/firestore";
import { loadPublicPngAsDataUrl } from "@/lib/pdf/loadPublicImage";

export type SalesCatalogPdfRow = ProductDoc & { id: string };

/** Optional table columns (product name is always included). */
export type CatalogPdfOptionalColumn = "purchase" | "sale" | "quantity";

export const CATALOG_PDF_COLUMN_LABELS: Record<CatalogPdfOptionalColumn, string> = {
  purchase: "Purchase price",
  sale: "Sale price",
  quantity: "Quantity left",
};

export const CATALOG_PDF_COLUMN_ORDER: CatalogPdfOptionalColumn[] = ["purchase", "sale", "quantity"];

export type DownloadCatalogPdfOptions = {
  columns: CatalogPdfOptionalColumn[];
  title?: string;
};

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatStockOrOutOfStock(value: number): string {
  return value <= 0 ? "Out of stock" : value.toLocaleString();
}

function formatPriceOrOutOfStock(value: number): string {
  return value <= 0 ? "Out of stock" : formatMoney(value);
}

function cellValue(product: SalesCatalogPdfRow, column: CatalogPdfOptionalColumn): string {
  switch (column) {
    case "purchase":
      return formatPriceOrOutOfStock(product.cost_price);
    case "sale":
      return formatPriceOrOutOfStock(product.sale_price);
    case "quantity":
      return formatStockOrOutOfStock(product.stock_quantity);
  }
}

function buildColumnStyles(
  columns: CatalogPdfOptionalColumn[],
  pageInnerWidth: number,
): Record<number, { cellWidth: number; halign?: "right" }> {
  const colCount = 1 + columns.length;
  const styles: Record<number, { cellWidth: number; halign?: "right" }> = {};
  if (colCount === 1) {
    styles[0] = { cellWidth: pageInnerWidth };
    return styles;
  }
  const numericCount = columns.length;
  const numericTotal = numericCount <= 1 ? 50 : numericCount === 2 ? 58 : 88;
  const productWidth = pageInnerWidth - numericTotal;
  styles[0] = { cellWidth: Math.max(40, productWidth) };
  for (let i = 1; i < colCount; i++) {
    styles[i] = { cellWidth: numericTotal / numericCount, halign: "right" };
  }
  return styles;
}

export async function downloadCatalogPdf(
  rows: SalesCatalogPdfRow[],
  options: DownloadCatalogPdfOptions,
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("downloadCatalogPdf is only available in the browser.");
  }

  const columns = CATALOG_PDF_COLUMN_ORDER.filter((c) => options.columns.includes(c));
  if (columns.length === 0) {
    throw new Error("Select at least one column besides product name.");
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
  const colSpan = 1 + columns.length;
  let y = margin;

  const title = options.title?.trim() || "Product rate list";
  const headLabels = ["Product", ...columns.map((c) => CATALOG_PDF_COLUMN_LABELS[c])];

  const logoDataUrl = await loadPublicPngAsDataUrl("/wholesale_logo.png", { maxWidthPx: 720 });
  const logoWidth = 58;
  const logoProps = doc.getImageProperties(logoDataUrl);
  const logoHeight = (logoWidth * logoProps.height) / logoProps.width;
  doc.addImage(logoDataUrl, "PNG", margin, y, logoWidth, logoHeight);
  y += logoHeight + 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, margin, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const introLines = [
    "Please find below the latest product list, grouped by category.",
    `Generated on: ${new Date().toLocaleString()}`,
  ];
  for (const line of introLines) {
    const split = doc.splitTextToSize(line, pageInnerWidth);
    doc.text(split, margin, y);
    y += split.length * 5;
  }
  y += 2;

  const grouped = new Map<string, SalesCatalogPdfRow[]>();
  for (const row of rows) {
    const category = row.category?.trim() || "Uncategorized";
    const existing = grouped.get(category);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(category, [row]);
    }
  }

  const sortedCategories = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  const tableRows: Array<Array<string | { content: string; colSpan: number; styles?: Record<string, unknown> }>> =
    [];
  for (const category of sortedCategories) {
    tableRows.push([
      {
        content: "",
        colSpan,
        styles: { lineWidth: 0, minCellHeight: 2.8, fillColor: [255, 255, 255] },
      },
    ]);
    tableRows.push([
      {
        content: category,
        colSpan,
        styles: {
          fontStyle: "bold",
          fontSize: 11.5,
          halign: "center",
          lineWidth: 0,
          minCellHeight: 8,
          fillColor: [236, 240, 255],
          textColor: [31, 41, 55],
        },
      },
    ]);
    tableRows.push([
      {
        content: "",
        colSpan,
        styles: { lineWidth: 0, minCellHeight: 2.8, fillColor: [255, 255, 255] },
      },
    ]);
    const products = grouped.get(category)!.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const product of products) {
      tableRows.push([product.name, ...columns.map((col) => cellValue(product, col))]);
    }
  }

  autoTable(doc, {
    startY: y,
    head: [headLabels],
    body: tableRows,
    styles: { fontSize: columns.length >= 3 ? 9.5 : 10, cellPadding: 1.8 },
    headStyles: { fillColor: [67, 56, 202], textColor: 255 },
    columnStyles: buildColumnStyles(columns, pageInnerWidth),
    margin: { left: margin, right: margin, bottom: 26 },
    didDrawPage() {
      const footerY = doc.internal.pageSize.getHeight() - 14;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text(
        "Thank you for your continued support. For bulk orders and updates, contact our office.",
        margin,
        footerY,
      );
    },
  });

  const safeStamp = new Date().toISOString().slice(0, 10);
  doc.save(`product_rate_list_${safeStamp}.pdf`);
}
