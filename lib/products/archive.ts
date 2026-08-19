/**
 * Product archive state — the single source of truth for "is this product retired?".
 *
 * Archiving hides a product from every forward-looking surface (pickers, catalogs,
 * dashboards, valuation, BI) while keeping the document so historical invoices,
 * returns and ledger rows can still resolve its name. Nothing references a product
 * by anything but `product_id`, so deleting one would leave raw doc IDs scattered
 * through the history — that is why there is no delete.
 *
 * Read this predicate rather than testing `is_active` directly: products created
 * before the flag existed have no `is_active` field and must count as active.
 */

/** Active unless explicitly archived — a missing flag is an old product, not a retired one. */
export function isProductActive(product: { is_active?: boolean }): boolean {
  return product.is_active !== false;
}

export function isProductArchived(product: { is_active?: boolean }): boolean {
  return !isProductActive(product);
}

/** Split rows into active/archived in one pass, for the products page tabs. */
export function partitionProducts<T extends { is_active?: boolean }>(
  rows: readonly T[],
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const row of rows) {
    if (isProductActive(row)) active.push(row);
    else archived.push(row);
  }
  return { active, archived };
}

/**
 * The confirm an admin sees before retiring a product, shared by the products list
 * and the product profile so the warning never drifts between them.
 *
 * Stock on hand is called out with its value because archiving takes it out of the
 * dashboard figures while the units keep physically existing — the honest fix is to
 * discard them first, so the message says so.
 */
export function archiveConfirmMessage(product: {
  name: string;
  stock_quantity?: number;
  cost_price?: number;
}): string {
  const stock = typeof product.stock_quantity === "number" ? product.stock_quantity : 0;
  if (stock <= 0) {
    return `Archive “${product.name}”? It will be hidden from pickers, catalogs and dashboards. Its history is kept, and you can restore it later.`;
  }
  const cost = typeof product.cost_price === "number" ? product.cost_price : 0;
  const value = (stock * cost).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `“${product.name}” still has ${stock.toLocaleString()} unit${stock === 1 ? "" : "s"} in stock (${value} at cost).\n\nArchiving stops counting them in inventory value, units on hand and low-stock alerts — but the stock still physically exists. To keep the books balanced, discard the stock first.\n\nArchive anyway?`;
}

/** Ids of the archived products in `rows` — used to drop their stock lots from valuation. */
export function archivedProductIds(
  rows: readonly { id: string; data: { is_active?: boolean } }[],
): Set<string> {
  const ids = new Set<string>();
  for (const { id, data } of rows) {
    if (isProductArchived(data)) ids.add(id);
  }
  return ids;
}
