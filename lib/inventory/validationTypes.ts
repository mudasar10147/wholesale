/**
 * Shared validation vocabulary. Kept in its own module so the register
 * (invariants.ts) and the validator (validateInventory.ts) can both depend on it
 * without a circular import.
 */

/** Legacy issue codes, retained on emitted issues for back-compat with existing consumers. */
export type ValidationIssueCode =
  | "STOCK_LOT_MISMATCH"
  | "NEGATIVE_LOT_QTY"
  | "LOT_QTY_EXCEEDS_IN"
  | "ORPHANED_LOT"
  | "ORPHANED_CONSUMPTION"
  | "ORPHANED_CONSUMPTION_INVOICE"
  | "DUPLICATE_CONSUMPTION"
  | "COGS_MISMATCH"
  | "INVENTORY_TXN_INTEGRITY"
  | "SALES_WITHOUT_LOTS"
  | "DUPLICATE_LEDGER_BY_SOURCE"
  | "MISSING_LEDGER_FOR_POSTED_DOC"
  | "ORPHANED_LEDGER_LINE"
  | "LOT_BALANCE_VS_CONSUMPTIONS"
  | "NEGATIVE_BOOK_STOCK";

/** Legacy two-level severity, still surfaced alongside the register's three-level model. */
export type ValidationSeverity = "error" | "warning";
