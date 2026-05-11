import type { InvoiceCalculatedSummary } from "@/lib/invoices/calculations";
import type { InvoiceTextLine } from "@/lib/invoices/invoiceText";
import {
  getPosBusinessAddress,
  getPosBusinessEmail,
  getPosBusinessName,
  getPosBusinessPhone,
  getPosPolicyParagraphs,
  getPosTaxId,
  getPosThankYouLine,
} from "@/lib/invoices/posReceiptBranding";
import { loadPublicPngAsDataUrl } from "@/lib/pdf/loadPublicImage";

export type PosReceiptInput = {
  order_id: string;
  /** Shown on receipt (e.g. draft, posted) */
  status: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  customer_email?: string;
  notes?: string;
  /** When the invoice was first created (label text) */
  created_at_label: string;
  subtotal_amount: number;
  discount_amount: number;
  delivery_charge: number;
  total_amount: number;
  lines: InvoiceTextLine[];
};

export function buildPosReceiptInputFromCalc(params: {
  order_id: string;
  status: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  customer_email?: string;
  notes?: string;
  created_at_label: string;
  calc: InvoiceCalculatedSummary;
  productNames: Map<string, string>;
}): PosReceiptInput {
  const lines: InvoiceTextLine[] = params.calc.lines.map((l) => ({
    product_name: params.productNames.get(l.product_id) ?? l.product_id,
    quantity: l.quantity,
    unit_price: l.unit_price,
    line_discount: l.line_discount,
    line_delivery_charge: l.line_delivery_charge,
    line_total: l.line_total,
  }));

  return {
    order_id: params.order_id,
    status: params.status,
    customer_name: params.customer_name,
    customer_phone: params.customer_phone,
    customer_address: params.customer_address,
    customer_email: params.customer_email,
    notes: params.notes,
    created_at_label: params.created_at_label,
    subtotal_amount: params.calc.subtotal_amount,
    discount_amount: params.calc.discount_amount,
    delivery_charge: params.calc.delivery_charge,
    total_amount: params.calc.total_amount,
    lines,
  };
}

const PAGE_W_MM = 80;
const MARGIN = 4;
const CONTENT_W = PAGE_W_MM - 2 * MARGIN;

/** Compact amounts for narrow columns (avoids wide locale strings breaking layout). */
function moneyCompact(n: number): string {
  return n.toFixed(2);
}

function shortProductName(name: string, maxChars: number): string {
  return name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
}

/**
 * Summary row: amount anchored at the right margin, label split to fit the remaining width.
 * Avoids jsPDF right-align + maxWidth quirks that can draw past the page edge.
 */
function drawReceiptTotalRow(
  doc: import("jspdf").default,
  label: string,
  valueStr: string,
  yMm: number,
  opts: { bold?: boolean; fontSize?: number; lineHeightMm?: number },
): number {
  const fontSize = opts.fontSize ?? 8;
  const lineHeightMm = opts.lineHeightMm ?? 4.2;
  doc.setFontSize(fontSize);
  doc.setFont("helvetica", opts.bold ? "bold" : "normal");

  const rightEdge = PAGE_W_MM - MARGIN;
  const valueW = doc.getTextWidth(valueStr);
  const gapMm = 2;
  const labelMaxW = Math.max(14, CONTENT_W - valueW - gapMm);

  doc.text(valueStr, rightEdge, yMm, { align: "right" });

  const labelLines = doc.splitTextToSize(label, labelMaxW);
  doc.text(labelLines, MARGIN, yMm);

  const lineCount = Array.isArray(labelLines) ? labelLines.length : 1;
  return yMm + Math.max(lineCount, 1) * lineHeightMm;
}

async function buildPosReceiptPdfBlob(input: PosReceiptInput): Promise<Blob> {
  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default;

  const policyParas = getPosPolicyParagraphs();
  const pageHeightMm = Math.min(
    2500,
    Math.max(320, 220 + input.lines.length * 6.5 + policyParas.length * 18),
  );
  const doc = new jsPDF({ unit: "mm", format: [PAGE_W_MM, pageHeightMm] });
  const cx = PAGE_W_MM / 2;
  let y = MARGIN;

  const logoDataUrl = await loadPublicPngAsDataUrl("/wholesale_logo.png");
  const logoMaxW = 36;
  const imgProps = doc.getImageProperties(logoDataUrl);
  const logoW = logoMaxW;
  const logoH = (logoW * imgProps.height) / imgProps.width;
  doc.addImage(logoDataUrl, "PNG", cx - logoW / 2, y, logoW, logoH);
  y += logoH + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(getPosBusinessName(), cx, y, { align: "center" });
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const bizLines: string[] = [];
  const addr = getPosBusinessAddress();
  const phone = getPosBusinessPhone();
  const email = getPosBusinessEmail();
  const taxId = getPosTaxId();
  if (addr) bizLines.push(addr);
  if (phone) bizLines.push(`Tel: ${phone}`);
  if (email) bizLines.push(email);
  if (taxId) bizLines.push(`Tax ID: ${taxId}`);
  for (const bl of bizLines) {
    const parts = doc.splitTextToSize(bl, CONTENT_W);
    doc.text(parts, cx, y, { align: "center" });
    y += parts.length * 3.6;
  }
  y += 2;

  doc.setDrawColor(40);
  doc.line(MARGIN, y, PAGE_W_MM - MARGIN, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(input.status.toUpperCase(), cx, y, { align: "center" });
  y += 6;

  doc.setFontSize(9);
  doc.text(`Order ${input.order_id}`, cx, y, { align: "center" });
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Invoice date: ${input.created_at_label}`, cx, y, { align: "center" });
  y += 4;
  doc.text(`Printed: ${new Date().toLocaleString()}`, cx, y, { align: "center" });
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Bill to", MARGIN, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const custBits = [
    input.customer_name,
    input.customer_phone?.trim() ? `Phone: ${input.customer_phone.trim()}` : null,
    input.customer_address?.trim() ? `Address: ${input.customer_address.trim()}` : null,
    input.customer_email?.trim() ? `Email: ${input.customer_email.trim()}` : null,
  ].filter(Boolean) as string[];
  for (const bit of custBits) {
    const parts = doc.splitTextToSize(bit, CONTENT_W);
    doc.text(parts, MARGIN, y);
    y += parts.length * 3.6;
  }
  y += 2;

  if (input.notes?.trim()) {
    doc.setFont("helvetica", "italic");
    const noteParts = doc.splitTextToSize(`Notes: ${input.notes.trim()}`, CONTENT_W);
    doc.text(noteParts, MARGIN, y);
    y += noteParts.length * 3.6 + 2;
    doc.setFont("helvetica", "normal");
  }

  const anyLineDisc = input.lines.some((l) => l.line_discount > 0.001);
  const anyLineDeliv = input.lines.some((l) => l.line_delivery_charge > 0.001);
  const wideTable = anyLineDisc || anyLineDeliv;

  const head: string[][] = [
    wideTable ? ["Item", "Qty", "Unit", "Disc", "Del", "Total"] : ["Item", "Qty", "Unit", "Total"],
  ];

  const body = input.lines.map((l) => {
    const name = shortProductName(l.product_name, wideTable ? 36 : 48);
    if (wideTable) {
      return [
        name,
        String(l.quantity),
        moneyCompact(l.unit_price),
        anyLineDisc ? moneyCompact(l.line_discount) : "—",
        anyLineDeliv ? moneyCompact(l.line_delivery_charge) : "—",
        moneyCompact(l.line_total),
      ];
    }
    return [name, String(l.quantity), moneyCompact(l.unit_price), moneyCompact(l.line_total)];
  });

  // Sum of cellWidth must fit inside CONTENT_W; padding adds width — keep columns slightly under.
  autoTable(doc, {
    startY: y,
    head: head,
    body,
    tableWidth: CONTENT_W,
    styles: {
      fontSize: 6.5,
      cellPadding: 0.35,
      overflow: "linebreak",
      lineWidth: 0.1,
    },
    headStyles: { fillColor: [55, 48, 120], textColor: 255, fontStyle: "bold", fontSize: 6.5 },
    columnStyles: wideTable
      ? {
          0: { cellWidth: 21, halign: "left" },
          1: { cellWidth: 7, halign: "right" },
          2: { cellWidth: 10, halign: "right" },
          3: { cellWidth: 8, halign: "right" },
          4: { cellWidth: 8, halign: "right" },
          5: { cellWidth: 10, halign: "right" },
        }
      : {
          0: { cellWidth: 33, halign: "left" },
          1: { cellWidth: 9, halign: "right" },
          2: { cellWidth: 11, halign: "right" },
          3: { cellWidth: 11, halign: "right" },
        },
    margin: { left: MARGIN, right: MARGIN },
  });

  const lastAuto = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let totalsY = (lastAuto?.finalY ?? y) + 8;

  doc.setFont("helvetica", "normal");
  totalsY = drawReceiptTotalRow(doc, "Subtotal", moneyCompact(input.subtotal_amount), totalsY, {
    fontSize: 8,
    lineHeightMm: 4.2,
  });
  totalsY = drawReceiptTotalRow(doc, "Discount", moneyCompact(input.discount_amount), totalsY, {
    fontSize: 8,
    lineHeightMm: 4.2,
  });
  totalsY = drawReceiptTotalRow(doc, "Delivery", moneyCompact(input.delivery_charge), totalsY, {
    fontSize: 8,
    lineHeightMm: 4.2,
  });
  totalsY = drawReceiptTotalRow(doc, "TOTAL", moneyCompact(input.total_amount), totalsY, {
    bold: true,
    fontSize: 9,
    lineHeightMm: 4.8,
  });
  totalsY += 4;

  doc.setDrawColor(40);
  doc.line(MARGIN, totalsY, PAGE_W_MM - MARGIN, totalsY);
  totalsY += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const thanksParts = doc.splitTextToSize(getPosThankYouLine(), CONTENT_W);
  doc.text(thanksParts, cx, totalsY, { align: "center" });
  totalsY += thanksParts.length * 3.8 + 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  for (const para of policyParas) {
    const parts = doc.splitTextToSize(para, CONTENT_W);
    doc.text(parts, MARGIN, totalsY);
    totalsY += parts.length * 3.2 + 2;
  }

  return doc.output("blob");
}

/**
 * Builds an 80mm thermal-style PDF and opens the system print dialog (iframe + blob URL).
 * Client-only. Does not block on print dialog completion.
 */
export async function printPosReceipt(input: PosReceiptInput): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("printPosReceipt is only available in the browser.");
  }

  const blob = await buildPosReceiptPdfBlob(input);
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    URL.revokeObjectURL(url);
    iframe.remove();
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.focus();
    win.print();
    window.setTimeout(cleanup, 2_000);
  };
}
