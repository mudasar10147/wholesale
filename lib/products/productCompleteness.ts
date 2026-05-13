import type { Timestamp } from "firebase/firestore";
import type { ProductDoc } from "@/lib/types/firestore";

export type ProductRow = ProductDoc & { id: string };

export type ProductCompletenessResult = {
  complete: boolean;
  /** Human-readable gaps; empty when `complete` is true. */
  missing: string[];
};

function hasTimestamp(value: unknown): value is Timestamp {
  return (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  );
}

function isNonNegativeInteger(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

function isNonNegativeFiniteNumber(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * Treats a product as catalog-complete when every field the app uses for display
 * and merchandising is present: identity, category, pricing, stock, timestamps,
 * and either an image URL or a stored image path (uploaded file).
 */
export function getProductCompleteness(row: ProductRow): ProductCompletenessResult {
  const missing: string[] = [];

  if (!row.name?.trim()) {
    missing.push("Name is missing or blank.");
  }

  if (!row.category?.trim()) {
    missing.push("Category is missing or blank.");
  }

  if (typeof row.cost_price !== "number" || !isNonNegativeFiniteNumber(row.cost_price)) {
    missing.push("Cost price is missing or invalid.");
  }

  if (typeof row.sale_price !== "number" || !isNonNegativeFiniteNumber(row.sale_price)) {
    missing.push("Sale price is missing or invalid.");
  }

  if (typeof row.stock_quantity !== "number" || !isNonNegativeInteger(row.stock_quantity)) {
    missing.push("Stock quantity is missing or not a whole number ≥ 0.");
  }

  if (!hasTimestamp(row.created_at)) {
    missing.push("Created date is missing.");
  }

  const hasImage =
    Boolean(row.image_url?.trim()) ||
    Boolean(row.image_path?.trim());
  if (!hasImage) {
    missing.push("Product image is missing (no image URL and no uploaded image).");
  }

  return { complete: missing.length === 0, missing };
}
