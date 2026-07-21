/**
 * The prepared input a register check receives. Building the indexes once here
 * (rather than in each check) keeps the register O(n) and the checks readable.
 */

import type {
  InvoiceDoc,
  InvoiceItemCogsDoc,
  InventoryDiscardDoc,
  InventoryTransactionDoc,
  InventoryTransactionLineDoc,
  InvoiceReturnDoc,
  LotConsumptionDoc,
  ProductDoc,
  StockLotDoc,
} from "@/lib/types/firestore";
import type { ValidationIssueCode } from "@/lib/inventory/validationTypes";

export type WithId<T> = { id: string; data: T };

export type ValidationInput = {
  products: Array<WithId<ProductDoc>>;
  lots: Array<WithId<StockLotDoc>>;
  consumptions: Array<WithId<LotConsumptionDoc>>;
  invoices: Array<WithId<InvoiceDoc>>;
  itemCogs: Array<WithId<InvoiceItemCogsDoc>>;
  inventoryTransactions?: Array<WithId<InventoryTransactionDoc>>;
  inventoryTransactionLines?: Array<WithId<InventoryTransactionLineDoc>>;
  invoiceReturns?: Array<WithId<InvoiceReturnDoc>>;
  inventoryDiscards?: Array<WithId<InventoryDiscardDoc>>;
};

/**
 * One finding from a register check. Carries an optional legacy `code` (for
 * back-compat) and locator fields; the validator stamps `invariant_id` and the
 * register severity onto the emitted issue.
 */
export type InvariantFinding = {
  message: string;
  code?: ValidationIssueCode;
  product_id?: string;
  product_name?: string;
  lot_id?: string;
  consumption_id?: string;
  invoice_id?: string;
  invoice_item_id?: string;
  transaction_id?: string;
  sale_id?: string;
  book?: number;
  lots_sum?: number;
  delta?: number;
  expected?: number | string;
  actual?: number | string;
  context?: Record<string, unknown>;
};

export type ValidationContext = {
  input: ValidationInput;
  productById: Map<string, WithId<ProductDoc>>;
  lotById: Map<string, WithId<StockLotDoc>>;
  invoiceById: Map<string, WithId<InvoiceDoc>>;
  lotsByProduct: Map<string, Array<WithId<StockLotDoc>>>;
  /** Σ quantity of active (not reversed) consumptions per lot. */
  activeConsumptionByLot: Map<string, number>;
};

export function buildValidationContext(input: ValidationInput): ValidationContext {
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const lotById = new Map(input.lots.map((l) => [l.id, l]));
  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]));

  const lotsByProduct = new Map<string, Array<WithId<StockLotDoc>>>();
  for (const lot of input.lots) {
    const pid = lot.data.product_id;
    if (!pid) continue;
    const arr = lotsByProduct.get(pid) ?? [];
    arr.push(lot);
    lotsByProduct.set(pid, arr);
  }

  const activeConsumptionByLot = new Map<string, number>();
  for (const row of input.consumptions) {
    if (row.data.reversed_at) continue;
    activeConsumptionByLot.set(
      row.data.lot_id,
      (activeConsumptionByLot.get(row.data.lot_id) ?? 0) + row.data.quantity,
    );
  }

  return { input, productById, lotById, invoiceById, lotsByProduct, activeConsumptionByLot };
}
