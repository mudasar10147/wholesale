export type InvoiceTextLine = {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_discount: number;
  line_delivery_charge: number;
  line_total: number;
};

export function buildInvoicePlainText(params: {
  order_id: string;
  status: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  customer_email?: string;
  notes?: string;
  subtotal_amount: number;
  discount_amount: number;
  delivery_charge: number;
  total_amount: number;
  lines: InvoiceTextLine[];
}): string {
  const lines = params.lines
    .map(
      (l, i) =>
        `${i + 1}. ${l.product_name}\n   Qty ${l.quantity} × ${l.unit_price.toFixed(2)}  disc ${l.line_discount.toFixed(2)}  delivery ${l.line_delivery_charge.toFixed(2)}  = ${l.line_total.toFixed(2)}`,
    )
    .join("\n");

  const parts = [
    `Invoice ${params.order_id}`,
    `Status: ${params.status}`,
    `Customer: ${params.customer_name}`,
    `Phone: ${params.customer_phone?.trim() || "-"}`,
    `Address: ${params.customer_address?.trim() || "-"}`,
    `Email: ${params.customer_email?.trim() || "-"}`,
    "",
    lines,
    "",
    `Subtotal: ${params.subtotal_amount.toFixed(2)}`,
    `Invoice discount: ${params.discount_amount.toFixed(2)}`,
    `Delivery: ${params.delivery_charge.toFixed(2)}`,
    `Total: ${params.total_amount.toFixed(2)}`,
  ];
  if (params.notes?.trim()) {
    parts.push("", `Notes: ${params.notes.trim()}`);
  }
  return parts.join("\n");
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
