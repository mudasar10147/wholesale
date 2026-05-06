import type { ProductDoc } from "@/lib/types/firestore";

export type SalesCatalogPdfRow = ProductDoc & { id: string };

function loadPublicPngAsDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context."));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

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

export async function downloadSalesCatalogPdf(rows: SalesCatalogPdfRow[]): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("downloadSalesCatalogPdf is only available in the browser.");
  }

  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  const logoDataUrl = await loadPublicPngAsDataUrl("/wholesale_logo.png");
  const logoWidth = 58;
  const logoProps = doc.getImageProperties(logoDataUrl);
  const logoHeight = (logoWidth * logoProps.height) / logoProps.width;
  doc.addImage(logoDataUrl, "PNG", margin, y, logoWidth, logoHeight);
  y += logoHeight + 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Professional Rate List", margin, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const generatedAt = new Date().toLocaleString();
  const introLines = [
    "Dear Sales Team,",
    "Please find below the latest product-wise professional rate list, grouped by category.",
    `Generated on: ${generatedAt}`,
  ];
  for (const line of introLines) {
    const split = doc.splitTextToSize(line, pageWidth - 2 * margin);
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
        colSpan: 4,
        styles: { lineWidth: 0, minCellHeight: 2.8, fillColor: [255, 255, 255] },
      },
    ]);
    tableRows.push([
      {
        content: category,
        colSpan: 4,
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
        colSpan: 4,
        styles: { lineWidth: 0, minCellHeight: 2.8, fillColor: [255, 255, 255] },
      },
    ]);
    const products = grouped.get(category)!.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const product of products) {
      tableRows.push([
        product.name,
        formatPriceOrOutOfStock(product.cost_price),
        formatPriceOrOutOfStock(product.sale_price),
        formatStockOrOutOfStock(product.stock_quantity),
      ]);
    }
  }

  autoTable(doc, {
    startY: y,
    head: [["Product", "Purchase price", "Sale price", "Quantity left"]],
    body: tableRows,
    styles: { fontSize: 9.5, cellPadding: 1.8 },
    headStyles: { fillColor: [67, 56, 202], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 88 },
      1: { cellWidth: 30, halign: "right" },
      2: { cellWidth: 30, halign: "right" },
      3: { cellWidth: 28, halign: "right" },
    },
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
  doc.save(`professional_rate_list_${safeStamp}.pdf`);
}

export async function downloadRetailRateListPdf(rows: SalesCatalogPdfRow[]): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("downloadRetailRateListPdf is only available in the browser.");
  }

  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  const logoDataUrl = await loadPublicPngAsDataUrl("/wholesale_logo.png");
  const logoWidth = 58;
  const logoProps = doc.getImageProperties(logoDataUrl);
  const logoHeight = (logoWidth * logoProps.height) / logoProps.width;
  doc.addImage(logoDataUrl, "PNG", margin, y, logoWidth, logoHeight);
  y += logoHeight + 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Retail Public Rate List", margin, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const introLines = [
    "Assalam o Alaikum,",
    "Please find our updated retail rate list below. These prices are for public sharing.",
    `Generated on: ${new Date().toLocaleString()}`,
  ];
  for (const line of introLines) {
    const split = doc.splitTextToSize(line, pageWidth - 2 * margin);
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
        colSpan: 2,
        styles: { lineWidth: 0, minCellHeight: 2.8, fillColor: [255, 255, 255] },
      },
    ]);
    tableRows.push([
      {
        content: category,
        colSpan: 2,
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
        colSpan: 2,
        styles: { lineWidth: 0, minCellHeight: 2.8, fillColor: [255, 255, 255] },
      },
    ]);
    const products = grouped.get(category)!.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const product of products) {
      tableRows.push([product.name, formatPriceOrOutOfStock(product.sale_price)]);
    }
  }

  autoTable(doc, {
    startY: y,
    head: [["Product", "Sale price"]],
    body: tableRows,
    styles: { fontSize: 10, cellPadding: 2 },
    headStyles: { fillColor: [67, 56, 202], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { cellWidth: 50, halign: "right" },
    },
    margin: { left: margin, right: margin, bottom: 26 },
    didDrawPage() {
      const footerY = doc.internal.pageSize.getHeight() - 14;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text("Thank you for choosing us. For bulk deals and orders, please contact our sales team.", margin, footerY);
    },
  });

  const safeStamp = new Date().toISOString().slice(0, 10);
  doc.save(`retail_rate_list_${safeStamp}.pdf`);
}
