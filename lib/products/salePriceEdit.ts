/**
 * Re-pricing a product on its own — no purchase, no stock movement.
 *
 * A sale price normally changes as a side effect of buying: a stock-in receipt carries the
 * new cost and, optionally, a new list price (see `applyStockInInTransaction`). When a
 * supplier's cost moves but nothing is bought there is no receipt to hang the new price on,
 * and the shop would be stuck selling at the old price until the next delivery. The Sale
 * prices tab exists for exactly that, and this module is its arithmetic.
 *
 * Firestore-free on purpose, like the rest of lib/products, so the browser, the server and
 * `node --experimental-strip-types` can all load it.
 */

import { marginPercent } from "@/lib/pricing/metrics";
import type { ParseResult } from "@/lib/validation/numbers";

/** Money is two decimals everywhere here, so a typed price is rounded before it is compared or saved. */
function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(n: number): number {
  return typeof n === "number" && Number.isFinite(n) ? roundMoney2(n) : 0;
}

/**
 * The price the admin typed, or why it cannot be used.
 *
 * Deliberately `Number` rather than the shared `parseNonNegativeDecimal`: that one is
 * parseFloat-based, so "1200x" and "1 200" quietly become 1200 and 1. A list price typed in a
 * hurry is worth refusing outright rather than guessing at the digits.
 */
export function parseSalePriceInput(raw: string): ParseResult<number> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: "Enter a sale price." };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, message: "Enter a number, e.g. 1350." };
  if (value < 0) return { ok: false, message: "Sale price can’t be negative." };
  return { ok: true, value: roundMoney2(value) };
}

export type SalePriceChange = {
  /** What the product sells for today. */
  current: number;
  /** What it would sell for, rounded to money — this is what gets written. */
  next: number;
  /** False when the typed price rounds to the saved one, which is what keeps Save switched off. */
  changed: boolean;
  /** `next - current`; positive for a rise. */
  delta: number;
  /** The rise or fall in percent. Null when the current price is 0 — there is nothing to compare against. */
  deltaPercent: number | null;
  /** Gross margin at the new price. Null when the new price is 0. */
  marginPercent: number | null;
  /** The new price does not cover today's cost. Allowed — clearing old stock is a real reason — but worth a confirm. */
  belowCost: boolean;
};

/** Everything the row under the input needs to say, from the three numbers it has. */
export function describeSalePriceChange(input: {
  current: number | undefined;
  next: number;
  cost: number | undefined;
}): SalePriceChange {
  const current = money(input.current ?? 0);
  const cost = money(input.cost ?? 0);
  const next = money(input.next);
  const delta = roundMoney2(next - current);
  return {
    current,
    next,
    changed: delta !== 0,
    delta,
    deltaPercent: current > 0 ? (delta / current) * 100 : null,
    marginPercent: marginPercent(next, cost),
    belowCost: next < cost,
  };
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * The confirm shown before saving a price that loses money on every unit.
 *
 * Typing 120 where 1200 was meant is a one-keystroke mistake that would go unnoticed until
 * the invoices came back wrong, so the loss per unit is spelled out rather than hinted at.
 */
export function belowCostConfirmMessage(name: string, change: SalePriceChange, cost: number): string {
  const loss = formatMoney(roundMoney2(money(cost) - change.next));
  return `“${name}” would sell at ${formatMoney(change.next)}, below its ${formatMoney(
    money(cost),
  )} cost — a loss of ${loss} on every unit.\n\nSave this price anyway?`;
}

/** Name-or-category search, matched the way the All products list matches it. */
export function matchesProductSearch(
  row: { name?: string; category?: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (row.name ?? "").toLowerCase().includes(q) || (row.category ?? "").toLowerCase().includes(q)
  );
}

/**
 * A→Z, because this list is worked through by name: the admin arrives knowing which product
 * the supplier re-priced. (The All products tab sorts newest-first instead — there, what
 * changed recently is the interesting thing.)
 */
export function sortProductsByName<T extends { name?: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
  );
}
