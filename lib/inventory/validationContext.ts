/**
 * The prepared input a register check receives. Building the indexes once here
 * (rather than in each check) keeps the register O(n) and the checks readable.
 */

import type {
  InvoiceDoc,
  InvoiceItemCogsDoc,
  InventoryDiscardDoc,
  InventoryDiscardItemDoc,
  InventoryDiscardLotDoc,
  InventoryTransactionDoc,
  InventoryTransactionLineDoc,
  InvoiceReturnDoc,
  InvoiceReturnItemDoc,
  LotConsumptionDoc,
  ProductDoc,
  ReturnLotRestorationDoc,
  ReturnLotWriteOffDoc,
  SaleDoc,
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
  invoiceReturnItems?: Array<WithId<InvoiceReturnItemDoc>>;
  returnLotRestorations?: Array<WithId<ReturnLotRestorationDoc>>;
  returnLotWriteOffs?: Array<WithId<ReturnLotWriteOffDoc>>;
  inventoryDiscards?: Array<WithId<InventoryDiscardDoc>>;
  inventoryDiscardItems?: Array<WithId<InventoryDiscardItemDoc>>;
  inventoryDiscardLots?: Array<WithId<InventoryDiscardLotDoc>>;
  sales?: Array<WithId<SaleDoc>>;
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
  consumptionById: Map<string, WithId<LotConsumptionDoc>>;
  lotsByProduct: Map<string, Array<WithId<StockLotDoc>>>;
  /** Σ quantity of active (not reversed) consumptions per lot. */
  activeConsumptionByLot: Map<string, number>;
  /** Σ inventory_discard_lots allocation quantity per lot. */
  discardAllocByLot: Map<string, number>;
  /** Σ inventory_discard_lots allocation quantity per discard_item_id. */
  discardAllocByItem: Map<string, number>;
  /** Σ return_lot_restorations quantity per lot. */
  restorationByLot: Map<string, number>;
  /** Σ return_lot_restorations quantity per consumption. */
  restorationByConsumption: Map<string, number>;
  /** Σ return_lot_write_offs quantity per consumption. */
  writeOffByConsumption: Map<string, number>;
};

function addTo(map: Map<string, number>, key: string | undefined, qty: unknown): void {
  if (!key) return;
  const q = typeof qty === "number" ? qty : 0;
  map.set(key, (map.get(key) ?? 0) + q);
}

export function buildValidationContext(input: ValidationInput): ValidationContext {
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const lotById = new Map(input.lots.map((l) => [l.id, l]));
  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]));
  const consumptionById = new Map(input.consumptions.map((c) => [c.id, c]));

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
    addTo(activeConsumptionByLot, row.data.lot_id, row.data.quantity);
  }

  const discardAllocByLot = new Map<string, number>();
  const discardAllocByItem = new Map<string, number>();
  for (const alloc of input.inventoryDiscardLots ?? []) {
    addTo(discardAllocByLot, alloc.data.lot_id, alloc.data.quantity);
    addTo(discardAllocByItem, alloc.data.discard_item_id, alloc.data.quantity);
  }

  const restorationByLot = new Map<string, number>();
  const restorationByConsumption = new Map<string, number>();
  for (const r of input.returnLotRestorations ?? []) {
    addTo(restorationByLot, r.data.lot_id, r.data.quantity);
    addTo(restorationByConsumption, r.data.consumption_id, r.data.quantity);
  }

  const writeOffByConsumption = new Map<string, number>();
  for (const w of input.returnLotWriteOffs ?? []) {
    addTo(writeOffByConsumption, w.data.consumption_id, w.data.quantity);
  }

  return {
    input,
    productById,
    lotById,
    invoiceById,
    consumptionById,
    lotsByProduct,
    activeConsumptionByLot,
    discardAllocByLot,
    discardAllocByItem,
    restorationByLot,
    restorationByConsumption,
    writeOffByConsumption,
  };
}
