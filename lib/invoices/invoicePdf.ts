import type { InvoiceTextLine } from "@/lib/invoices/invoiceText";

export type InvoicePdfInput = {
  order_id: string;
  status: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  customer_email?: string;
  notes?: string;
  /** Pre-formatted created timestamp for the PDF header. */
  created_at_label: string;
  subtotal_amount: number;
  discount_amount: number;
  delivery_charge: number;
  total_amount: number;
  lines: InvoiceTextLine[];
};

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
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/**
 * Generates an invoice PDF in the browser and triggers download.
 * Must only be called from client components (uses dynamic import + DOM).
 */
export async function downloadInvoicePdf(input: InvoicePdfInput): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("downloadInvoicePdf is only available in the browser.");
  }

  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  const logoDataUrl = await loadPublicPngAsDataUrl("/wholesale_logo.png");
  const logoW = 55;
  const imgProps = doc.getImageProperties(logoDataUrl);
  const logoH = (logoW * imgProps.height) / imgProps.width;
  doc.addImage(logoDataUrl, "PNG", margin, y, logoW, logoH);
  y += logoH + 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`Invoice ${input.order_id}`, margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const meta = [
    `Status: ${input.status}`,
    `Customer: ${input.customer_name}`,
    `Phone: ${input.customer_phone?.trim() || "-"}`,
    `Address: ${input.customer_address?.trim() || "-"}`,
    `Email: ${input.customer_email?.trim() || "-"}`,
    `Created: ${input.created_at_label}`,
  ];
  meta.forEach((line) => {
    const split = doc.splitTextToSize(line, pageW - 2 * margin);
    doc.text(split, margin, y);
    y += split.length * 5;
  });

  if (input.notes?.trim()) {
    y += 1;
    doc.setFont("helvetica", "italic");
    const split = doc.splitTextToSize(`Notes: ${input.notes.trim()}`, pageW - 2 * margin);
    doc.text(split, margin, y);
    y += split.length * 5 + 4;
    doc.setFont("helvetica", "normal");
  } else {
    y += 4;
  }

  autoTable(doc, {
    startY: y,
    head: [["Product", "Qty", "Unit", "Disc", "Deliv.", "Line total"]],
    body: input.lines.map((l) => [
      l.product_name.length > 48 ? `${l.product_name.slice(0, 45)}…` : l.product_name,
      String(l.quantity),
      l.unit_price.toFixed(2),
      l.line_discount.toFixed(2),
      l.line_delivery_charge.toFixed(2),
      l.line_total.toFixed(2),
    ]),
    styles: { fontSize: 9, cellPadding: 1.5 },
    headStyles: { fillColor: [67, 56, 202], textColor: 255 },
    margin: { left: margin, right: margin },
  });

  const lastAuto = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  const tableBottom = lastAuto?.finalY ?? y;
  let totalsY = tableBottom + 10;

  doc.setFontSize(10);
  doc.text(`Subtotal: ${input.subtotal_amount.toFixed(2)}`, pageW - margin, totalsY, {
    align: "right",
  });
  totalsY += 6;
  doc.text(`Invoice discount: ${input.discount_amount.toFixed(2)}`, pageW - margin, totalsY, {
    align: "right",
  });
  totalsY += 6;
  doc.text(`Delivery: ${input.delivery_charge.toFixed(2)}`, pageW - margin, totalsY, {
    align: "right",
  });
  totalsY += 7;
  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${input.total_amount.toFixed(2)}`, pageW - margin, totalsY, {
    align: "right",
  });

  const safe = input.order_id.replace(/[^\w.-]+/g, "_");
  doc.save(`${safe}.pdf`);
}
