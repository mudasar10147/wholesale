/**
 * Client-side helpers for draft invoices: compare line quantities to current product stock.
 * Posting still enforces stock server-side in `postInvoice`.
 */

export function aggregateInvoiceQtyByProduct(
  lines: Array<{ product_id: string; quantity: number }>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of lines) {
    const id = line.product_id.trim();
    if (!id) continue;
    const q = typeof line.quantity === "number" && Number.isInteger(line.quantity) ? line.quantity : 0;
    if (q <= 0) continue;
    m.set(id, (m.get(id) ?? 0) + q);
  }
  return m;
}

/** Human-readable lines like `Beans: need 10, available 3`. */
export function listStockShortfallsForDraft(
  lines: Array<{ product_id: string; quantity: number }>,
  productStockById: Map<string, number>,
  productNameById: Map<string, string>,
): string[] {
  const needed = aggregateInvoiceQtyByProduct(lines);
  const out: string[] = [];
  for (const [productId, qty] of needed) {
    const available = productStockById.has(productId)
      ? (productStockById.get(productId) ?? 0)
      : 0;
    if (qty > available) {
      const name = productNameById.get(productId) ?? productId;
      out.push(`${name}: need ${qty}, available ${available}`);
    }
  }
  return out;
}
