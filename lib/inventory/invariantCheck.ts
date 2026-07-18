import type { ProductDoc, StockLotDoc } from "@/lib/types/firestore";

export type ProductLotRow = { id: string; data: StockLotDoc };

export function sumLotQtyRemaining(lots: readonly ProductLotRow[]): number {
  let sum = 0;
  for (const lot of lots) {
    const q = lot.data.qty_remaining;
    if (typeof q === "number" && Number.isInteger(q)) {
      sum += q;
    }
  }
  return sum;
}

export function getProductStockQuantity(product: ProductDoc | undefined): number {
  const q = product?.stock_quantity;
  return typeof q === "number" && Number.isInteger(q) ? q : 0;
}

export type InvariantViolation = {
  product_id: string;
  book_stock: number;
  lots_sum: number;
  delta: number;
};

export function checkStockLotInvariant(
  productId: string,
  product: ProductDoc | undefined,
  lots: readonly ProductLotRow[],
): InvariantViolation | null {
  const book = getProductStockQuantity(product);
  const lotSum = sumLotQtyRemaining(lots);
  if (book !== lotSum) {
    return {
      product_id: productId,
      book_stock: book,
      lots_sum: lotSum,
      delta: lotSum - book,
    };
  }
  return null;
}

/** Throws if book stock does not equal sum of lot qty_remaining for any product. */
export function assertStockLotInvariant(
  productId: string,
  product: ProductDoc | undefined,
  lots: readonly ProductLotRow[],
): void {
  const violation = checkStockLotInvariant(productId, product, lots);
  if (violation) {
    throw new Error(
      `Inventory invariant violated for product ${productId}: book stock ${violation.book_stock} != lot sum ${violation.lots_sum} (delta ${violation.delta}).`,
    );
  }
}
