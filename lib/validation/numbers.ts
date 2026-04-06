/** Shared numeric parsers for forms. */

export type ParseOk<T> = { ok: true; value: T };
export type ParseFail = { ok: false; message?: string };
export type ParseResult<T> = ParseOk<T> | ParseFail;

export function parseNonNegativeDecimal(raw: string): ParseResult<number> {
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n) || n < 0) {
    return { ok: false, message: "Must be zero or greater." };
  }
  return { ok: true, value: n };
}

export function parseNonNegativeIntStrict(raw: string): ParseResult<number> {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || String(n) !== raw.trim()) {
    return { ok: false, message: "Must be a whole number zero or greater." };
  }
  return { ok: true, value: n };
}

export function parsePositiveIntStrict(raw: string): ParseResult<number> {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0 || String(n) !== raw.trim()) {
    return { ok: false, message: "Must be a positive whole number." };
  }
  return { ok: true, value: n };
}

export function parsePositiveAmount(raw: string): ParseResult<number> {
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n) || n <= 0) {
    return { ok: false, message: "Must be greater than zero." };
  }
  return { ok: true, value: n };
}

/**
 * For sales / stock-out: quantity must not exceed available stock.
 */
export function validateQuantityAgainstStock(
  quantity: number,
  stock: number,
): ParseResult<number> {
  if (quantity > stock) {
    return {
      ok: false,
      message: `Not enough stock (available: ${stock.toLocaleString()}).`,
    };
  }
  return { ok: true, value: quantity };
}
