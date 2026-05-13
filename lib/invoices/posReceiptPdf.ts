import type { InvoiceCalculatedSummary } from "@/lib/invoices/calculations";
import type { InvoiceTextLine } from "@/lib/invoices/invoiceText";
import {
  getPosBusinessAddress,
  getPosBusinessEmail,
  getPosBusinessName,
  getPosBusinessPhone,
  getPosPolicyParagraphs,
  getPosShopNumber,
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
/** Chrome print uses `height_microns`; 1 mm ≈ 1000 µm. Cap page height so drivers do not feed meters of paper. */
const MAX_RECEIPT_PAGE_HEIGHT_MM = 1200;

/** Dev logs + optional `localStorage.setItem("POS_RECEIPT_DEBUG", "1")` for a prod build on localhost. */
function posReceiptDebugEnabled(): boolean {
  if (typeof window !== "undefined" && window.localStorage?.getItem("POS_RECEIPT_DEBUG") === "1") {
    return true;
  }
  return process.env.NODE_ENV === "development";
}

function logPosReceiptPdf(stage: string, payload: Record<string, unknown>): void {
  if (!posReceiptDebugEnabled()) return;
  console.log("[POS receipt PDF]", stage, payload);
}
const MARGIN_TOP_MM = 4;

/**
 * 80 mm PDF page: ink lives in a narrower band (`CONTENT_W_MM`) so thermal heads
 * that cannot print full width do not clip. **Fixed small left gutter** — all
 * remaining side space goes to the **right** so narrowing the band does not
 * balloon left padding symmetrically.
 * Invariant: CONTENT_X1 - CONTENT_X0 === CONTENT_W_MM; autoTable uses CONTENT_W_MM
 * with margin.left CONTENT_X0 and margin.right PAGE_W_MM - CONTENT_X1.
 */
const CONTENT_W_MM = 70;
/** Minimal clearance from physical left edge of the roll (mm). */
const GUTTER_L_MM = 2;
const GUTTER_R_MM = PAGE_W_MM - CONTENT_W_MM - GUTTER_L_MM;
const CONTENT_X0 = GUTTER_L_MM;
const CONTENT_X1 = PAGE_W_MM - GUTTER_R_MM;
const CONTENT_CX = (CONTENT_X0 + CONTENT_X1) / 2;
/** Inset inside right edge of content box for right-aligned totals amounts */
const TOTALS_AMOUNT_RIGHT_X = CONTENT_X1 - 2;

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Table cells: trim trailing zeros (e.g. 12.00 → 12, 12.50 → 12.5). */
function moneyTableCell(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return String(parseFloat(n.toFixed(2)));
}

function shortProductName(name: string, maxChars: number): string {
  return name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
}

/** Label on the left, amount right-aligned inside the safe print zone */
function drawTotalsLine(
  doc: import("jspdf").default,
  label: string,
  amountStr: string,
  y: number,
  opts: { bold?: boolean; fontSize?: number; lineGap?: number },
): number {
  const fontSize = opts.fontSize ?? 8;
  const lineGap = opts.lineGap ?? 4.2;
  doc.setFont("helvetica", opts.bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  doc.text(label, CONTENT_X0, y);
  doc.text(amountStr, TOTALS_AMOUNT_RIGHT_X, y, { align: "right" });
  return y + lineGap;
}

type AutoTableLast = {
  head?: Array<{ height?: number }>;
  body?: Array<{ height?: number }>;
  foot?: Array<{ height?: number }>;
  finalY?: number;
};

function sumRowHeightsMm(rows: Array<{ height?: number }> | undefined): number {
  return (rows ?? []).reduce((sum, row) => {
    const h = row.height;
    return sum + (typeof h === "number" && Number.isFinite(h) ? h : 0);
  }, 0);
}

/**
 * Table bottom Y from real row heights (matches `finalY` when correct). Do not use raw
 * `finalY` alone on a tall measure page — it can sit near the page bottom and blow up height.
 */
function getTableBottomYMm(
  doc: import("jspdf").default,
  tableStartY: number,
  lineCount: number,
): number {
  const raw = (doc as { lastAutoTable?: unknown }).lastAutoTable;
  if (!raw || typeof raw !== "object") {
    return tableStartY + 12 + Math.max(lineCount, 1) * 7 + 8;
  }
  const t = raw as AutoTableLast;
  const inner = sumRowHeightsMm(t.head) + sumRowHeightsMm(t.body) + sumRowHeightsMm(t.foot);
  if (inner > 0.5) {
    return tableStartY + inner + 2;
  }
  if (typeof t.finalY === "number" && Number.isFinite(t.finalY) && t.finalY > tableStartY + 2) {
    return t.finalY;
  }
  return tableStartY + 12 + Math.max(lineCount, 1) * 7 + 8;
}

type AutoTableFn = (d: import("jspdf").default, options: Record<string, unknown>) => void;

/**
 * Draws the full receipt on `doc`. Returns Y after the last footer line (for page sizing).
 */
async function drawPosReceiptOnDoc(
  doc: import("jspdf").default,
  input: PosReceiptInput,
  policyParas: string[],
  logoDataUrl: string,
  autoTable: AutoTableFn,
): Promise<number> {
  const cx = CONTENT_CX;
  let y = MARGIN_TOP_MM;

  const logoMaxW = Math.min(50, CONTENT_W_MM - 2);
  const imgProps = doc.getImageProperties(logoDataUrl);
  const logoW = logoMaxW;
  const logoH = (logoW * imgProps.height) / imgProps.width;
  doc.addImage(logoDataUrl, "PNG", cx - logoW / 2, y, logoW, logoH);
  y += logoH + 3;

  const shopNo = getPosShopNumber();
  if (shopNo) {
    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Shop No. ${shopNo}`, cx, y, { align: "center" });
    y += 5;
  }

  doc.setTextColor(0);
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
    const parts = doc.splitTextToSize(bl, CONTENT_W_MM);
    doc.text(parts, cx, y, { align: "center" });
    y += parts.length * 3.6;
  }
  y += 2;

  doc.setDrawColor(0);
  doc.line(CONTENT_X0, y, CONTENT_X1, y);
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
  doc.text("Bill to", CONTENT_X0, y);
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
    const parts = doc.splitTextToSize(bit, CONTENT_W_MM);
    doc.text(parts, CONTENT_X0, y);
    y += parts.length * 3.6;
  }
  y += 2;

  if (input.notes?.trim()) {
    doc.setFont("helvetica", "italic");
    const noteParts = doc.splitTextToSize(`Notes: ${input.notes.trim()}`, CONTENT_W_MM);
    doc.text(noteParts, CONTENT_X0, y);
    y += noteParts.length * 3.6 + 2;
    doc.setFont("helvetica", "normal");
  }

  const anyLineDisc = input.lines.some((l) => l.line_discount > 0.001);
  const anyLineDeliv = input.lines.some((l) => l.line_delivery_charge > 0.001);
  const wideTable = anyLineDisc || anyLineDeliv;

  const head: string[][] = [
    wideTable ? ["Item", "Qty", "Unit", "Disc", "Del", "Total"] : ["Item", "Qty", "Unit", "Total"],
  ];

  const tableFontSize = wideTable ? 7 : 8;
  const body = input.lines.map((l) => {
    const name = shortProductName(l.product_name, wideTable ? 36 : 42);
    if (wideTable) {
      return [
        name,
        String(l.quantity),
        moneyTableCell(l.unit_price),
        anyLineDisc ? moneyTableCell(l.line_discount) : "—",
        anyLineDeliv ? moneyTableCell(l.line_delivery_charge) : "—",
        moneyTableCell(l.line_total),
      ];
    }
    return [name, String(l.quantity), moneyTableCell(l.unit_price), moneyTableCell(l.line_total)];
  });

  const tableStartY = y;

  autoTable(doc, {
    startY: tableStartY,
    head: head,
    body,
    theme: "plain",
    tableWidth: CONTENT_W_MM,
    styles: {
      fontSize: tableFontSize,
      font: "helvetica",
      cellPadding: 0.45,
      overflow: "linebreak",
      lineWidth: 0.12,
      lineColor: 0,
      textColor: 0,
      fillColor: 255,
    },
    headStyles: {
      fillColor: 255,
      textColor: 0,
      fontStyle: "bold",
      fontSize: tableFontSize,
      lineWidth: 0.12,
      lineColor: 0,
    },
    bodyStyles: {
      fillColor: 255,
      textColor: 0,
      fontSize: tableFontSize,
      lineColor: 40,
    },
    alternateRowStyles: { fillColor: 255, textColor: 0 },
    /**
     * Column 0 (Item) has no fixed cellWidth so autotable fills the remainder of
     * CONTENT_W_MM after numeric Qty/Unit/(Disc/Del)/Total — avoids width warnings.
     */
    columnStyles: wideTable
      ? {
          0: { halign: "left" },
          1: { cellWidth: 7, halign: "right" },
          2: { cellWidth: 11, halign: "right" },
          3: { cellWidth: 9, halign: "right" },
          4: { cellWidth: 9, halign: "right" },
          5: { cellWidth: 13, halign: "right" },
        }
      : {
          0: { halign: "left" },
          1: { cellWidth: 10, halign: "right" },
          2: { cellWidth: 14, halign: "right" },
          3: { cellWidth: 16, halign: "right" },
        },
    margin: { left: CONTENT_X0, right: PAGE_W_MM - CONTENT_X1 },
  });

  const tableBottomY = getTableBottomYMm(doc, tableStartY, input.lines.length);
  let totalsY = tableBottomY + 8;

  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  totalsY = drawTotalsLine(doc, "Subtotal", money(input.subtotal_amount), totalsY, {
    fontSize: 8,
  });
  totalsY = drawTotalsLine(doc, "Discount", money(input.discount_amount), totalsY, {
    fontSize: 8,
  });
  totalsY = drawTotalsLine(doc, "Delivery", money(input.delivery_charge), totalsY, {
    fontSize: 8,
  });
  totalsY = drawTotalsLine(doc, "TOTAL", money(input.total_amount), totalsY, {
    bold: true,
    fontSize: 9,
    lineGap: 5,
  });
  totalsY += 4;

  doc.setDrawColor(0);
  doc.line(CONTENT_X0, totalsY, CONTENT_X1, totalsY);
  totalsY += 6;

  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const thanksParts = doc.splitTextToSize(getPosThankYouLine(), CONTENT_W_MM);
  doc.text(thanksParts, cx, totalsY, { align: "center" });
  totalsY += thanksParts.length * 3.8 + 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  for (const para of policyParas) {
    const parts = doc.splitTextToSize(para, CONTENT_W_MM);
    doc.text(parts, CONTENT_X0, totalsY);
    totalsY += parts.length * 3.2 + 2;
  }

  return totalsY + 3;
}

async function buildPosReceiptPdfBlob(input: PosReceiptInput): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const policyParas = getPosPolicyParagraphs();
  /** Logo source is very large (e.g. 2800px wide); downscale so the PDF stays small for print/iframe. */
  const logoDataUrl = await loadPublicPngAsDataUrl("/wholesale_logo.png", {
    maxWidthPx: 720,
    grayscale: true,
  });

  /**
   * `doc.internal.pageSize.setHeight()` after drawing breaks many PDF viewers (blank page).
   * Measure on a tall throwaway doc, then render once at the exact height.
   */
  const measurePageHeightMm = Math.min(MAX_RECEIPT_PAGE_HEIGHT_MM + 400, 1600);
  const measureDoc = new jsPDF({
    unit: "mm",
    format: [PAGE_W_MM, measurePageHeightMm],
  });
  const contentBottomRaw = await drawPosReceiptOnDoc(measureDoc, input, policyParas, logoDataUrl, autoTable);

  const lastAt = (measureDoc as { lastAutoTable?: AutoTableLast }).lastAutoTable;
  const rowHeightsSumMm =
    lastAt && typeof lastAt === "object"
      ? sumRowHeightsMm(lastAt.head) + sumRowHeightsMm(lastAt.body) + sumRowHeightsMm(lastAt.foot)
      : null;
  const lastAutoTableFinalY =
    lastAt && typeof lastAt === "object" && typeof lastAt.finalY === "number" ? lastAt.finalY : null;

  const bottomPadMm = 10;
  const safetyMm = 6;
  const lines = Math.max(input.lines.length, 1);
  const policyChars = policyParas.reduce((n, p) => n + p.length, 0);
  /** Soft ceiling from line count — must stay well below MAX or it becomes the print page height (see height_microns). */
  const softEstimateMm =
    180 + lines * 10 + Math.ceil(policyChars / 46) * 3.4 + 120;
  const hardCapMm = Math.min(MAX_RECEIPT_PAGE_HEIGHT_MM - bottomPadMm - safetyMm, softEstimateMm);
  const contentBottom = Number.isFinite(contentBottomRaw)
    ? Math.min(contentBottomRaw, hardCapMm)
    : Math.min(hardCapMm, 400);

  const pageHeightMm = Math.min(
    MAX_RECEIPT_PAGE_HEIGHT_MM,
    Math.max(48, Math.ceil((contentBottom + bottomPadMm + safetyMm) * 10) / 10),
  );

  logPosReceiptPdf("buildPosReceiptPdfBlob", {
    order_id: input.order_id,
    lineCount: input.lines.length,
    policyParagraphs: policyParas.length,
    policyChars,
    measurePageHeightMm,
    contentBox: {
      CONTENT_X0,
      CONTENT_X1,
      CONTENT_W_MM,
      CONTENT_CX,
      GUTTER_L_MM,
      GUTTER_R_MM,
    },
    contentBottomRaw,
    contentBottomRawFinite: Number.isFinite(contentBottomRaw),
    softEstimateMm,
    hardCapMm,
    contentBottom,
    pageWidthMm: PAGE_W_MM,
    pageHeightMm,
    /** If raw >> hardCap, clamp hid inflated measure (compare to Acrobat page height). */
    clampedByHardCap: Number.isFinite(contentBottomRaw) && contentBottomRaw > hardCapMm + 0.5,
    lastAutoTable: {
      rowHeightsSumMm,
      finalY: lastAutoTableFinalY,
      bodyRowCount: lastAt?.body?.length ?? null,
    },
  });

  const doc = new jsPDF({ unit: "mm", format: [PAGE_W_MM, pageHeightMm] });
  await drawPosReceiptOnDoc(doc, input, policyParas, logoDataUrl, autoTable);

  const blob = doc.output("blob");
  logPosReceiptPdf("buildPosReceiptPdfBlob:done", {
    order_id: input.order_id,
    blobBytes: blob.size,
    pageSizeMm: `${PAGE_W_MM}×${pageHeightMm}`,
  });

  return blob;
}

/**
 * Builds an 80mm thermal-style PDF and opens the system print dialog (iframe + blob URL).
 * Client-only. Does not block on print dialog completion.
 */
export async function printPosReceipt(input: PosReceiptInput): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("printPosReceipt is only available in the browser.");
  }

  logPosReceiptPdf("printPosReceipt:start", {
    order_id: input.order_id,
    lineCount: input.lines.length,
    hint: 'Force logs: localStorage.setItem("POS_RECEIPT_DEBUG","1") then reload',
  });

  const blob = await buildPosReceiptPdfBlob(input);
  const url = URL.createObjectURL(blob);

  logPosReceiptPdf("printPosReceipt:iframe", { blobUrlCreated: true, blobBytes: blob.size });

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "0";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.border = "0";
  iframe.style.overflow = "hidden";
  iframe.style.pointerEvents = "none";
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    URL.revokeObjectURL(url);
    iframe.remove();
  };

  iframe.addEventListener(
    "load",
    () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      win.focus();
      window.requestAnimationFrame(() => {
        logPosReceiptPdf("printPosReceipt: invoking win.print()", {
          order_id: input.order_id,
        });
        win.print();
      });
      window.setTimeout(cleanup, 2_000);
    },
    { once: true },
  );
}
