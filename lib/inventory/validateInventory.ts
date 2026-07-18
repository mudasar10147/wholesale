import type {
  InvoiceDoc,
  InvoiceItemCogsDoc,
  LotConsumptionDoc,
  ProductDoc,
  StockLotDoc,
} from "@/lib/types/firestore";
import type { InventoryTransactionDoc, InventoryTransactionLineDoc } from "@/lib/types/firestore";

export type ValidationSeverity = "error" | "warning";

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

export type ValidationIssue = {
  code: ValidationIssueCode;
  severity: ValidationSeverity;
  message: string;
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
  details?: Record<string, unknown>;
};

export type ValidationInput = {
  products: Array<{ id: string; data: ProductDoc }>;
  lots: Array<{ id: string; data: StockLotDoc }>;
  consumptions: Array<{ id: string; data: LotConsumptionDoc }>;
  invoices: Array<{ id: string; data: InvoiceDoc }>;
  itemCogs: Array<{ id: string; data: InvoiceItemCogsDoc }>;
  inventoryTransactions?: Array<{ id: string; data: InventoryTransactionDoc }>;
  inventoryTransactionLines?: Array<{ id: string; data: InventoryTransactionLineDoc }>;
  invoiceReturns?: Array<{ id: string; data: import("@/lib/types/firestore").InvoiceReturnDoc }>;
  inventoryDiscards?: Array<{ id: string; data: import("@/lib/types/firestore").InventoryDiscardDoc }>;
};

export type ValidationReport = {
  run_at: string;
  environment: string;
  summary: {
    errors: number;
    warnings: number;
    products_checked: number;
    lots_checked: number;
  };
  issues: ValidationIssue[];
};

function approxMoneyEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.05;
}

export function validateInventoryData(
  input: ValidationInput,
  environment = "fixture",
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const lotById = new Map(input.lots.map((l) => [l.id, l]));
  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]));

  const lotsByProduct = new Map<string, Array<{ id: string; data: StockLotDoc }>>();
  for (const lot of input.lots) {
    const pid = lot.data.product_id;
    if (!pid) continue;
    const arr = lotsByProduct.get(pid) ?? [];
    arr.push(lot);
    lotsByProduct.set(pid, arr);
  }

  for (const product of input.products) {
    const book =
      typeof product.data.stock_quantity === "number" && Number.isInteger(product.data.stock_quantity)
        ? product.data.stock_quantity
        : 0;
    const productLots = lotsByProduct.get(product.id) ?? [];
    let lotsSum = 0;
    for (const lot of productLots) {
      const q = lot.data.qty_remaining;
      if (typeof q === "number" && Number.isInteger(q)) lotsSum += q;
    }
    if (book !== lotsSum) {
      issues.push({
        code: "STOCK_LOT_MISMATCH",
        severity: "error",
        message: `Book stock (${book}) != sum of lot qty_remaining (${lotsSum})`,
        product_id: product.id,
        product_name: product.data.name,
        book,
        lots_sum: lotsSum,
        delta: lotsSum - book,
      });
    }
    if (book < 0) {
      issues.push({
        code: "NEGATIVE_BOOK_STOCK",
        severity: "error",
        message: `Book stock_quantity is negative (${book})`,
        product_id: product.id,
        product_name: product.data.name,
        book,
      });
    }
  }

  for (const lot of input.lots) {
    const qr = lot.data.qty_remaining;
    const qi = lot.data.qty_in;
    if (typeof qr !== "number" || !Number.isInteger(qr) || qr < 0) {
      issues.push({
        code: "NEGATIVE_LOT_QTY",
        severity: "error",
        message: "Lot qty_remaining is negative or not an integer",
        lot_id: lot.id,
        product_id: lot.data.product_id,
        details: { qty_remaining: qr },
      });
    }
    if (
      typeof qr === "number" &&
      typeof qi === "number" &&
      Number.isInteger(qr) &&
      Number.isInteger(qi) &&
      qr > qi
    ) {
      issues.push({
        code: "LOT_QTY_EXCEEDS_IN",
        severity: "error",
        message: `qty_remaining (${qr}) exceeds qty_in (${qi})`,
        lot_id: lot.id,
        product_id: lot.data.product_id,
      });
    }
    if (!productById.has(lot.data.product_id)) {
      issues.push({
        code: "ORPHANED_LOT",
        severity: "error",
        message: "Lot references missing product",
        lot_id: lot.id,
        product_id: lot.data.product_id,
      });
    }
  }

  const consumptionsByLot = new Map<string, number>();
  for (const row of input.consumptions) {
    if (row.data.reversed_at) continue;
    const lid = row.data.lot_id;
    consumptionsByLot.set(lid, (consumptionsByLot.get(lid) ?? 0) + row.data.quantity);
  }
  for (const lot of input.lots) {
    const qi = typeof lot.data.qty_in === "number" ? lot.data.qty_in : 0;
    const qr = typeof lot.data.qty_remaining === "number" ? lot.data.qty_remaining : 0;
    const consumed = consumptionsByLot.get(lot.id) ?? 0;
    const expectedRemaining = qi - consumed;
    if (expectedRemaining !== qr && consumed > 0) {
      issues.push({
        code: "LOT_BALANCE_VS_CONSUMPTIONS",
        severity: "warning",
        message: `Lot qty_remaining (${qr}) != qty_in - consumptions (${expectedRemaining})`,
        lot_id: lot.id,
        product_id: lot.data.product_id,
        details: { qty_in: qi, consumed, qty_remaining: qr },
      });
    }
  }

  const consumptionKeyCount = new Map<string, number>();
  for (const row of input.consumptions) {
    const c = row.data;
    if (!lotById.has(c.lot_id)) {
      issues.push({
        code: "ORPHANED_CONSUMPTION",
        severity: "error",
        message: "Consumption references missing lot",
        consumption_id: row.id,
        lot_id: c.lot_id,
        invoice_id: c.invoice_id,
      });
    }
    if (!invoiceById.has(c.invoice_id)) {
      issues.push({
        code: "ORPHANED_CONSUMPTION_INVOICE",
        severity: "warning",
        message: "Consumption references missing invoice",
        consumption_id: row.id,
        invoice_id: c.invoice_id,
      });
    }
    if (!c.reversed_at) {
      const key = `${c.invoice_item_id}::${c.lot_id}`;
      consumptionKeyCount.set(key, (consumptionKeyCount.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of consumptionKeyCount) {
    if (count > 1) {
      const [invoice_item_id, lot_id] = key.split("::");
      issues.push({
        code: "DUPLICATE_CONSUMPTION",
        severity: "error",
        message: `Duplicate active consumption for item ${invoice_item_id} and lot ${lot_id}`,
        invoice_item_id,
        lot_id,
        details: { count },
      });
    }
  }

  const consumptionsByItem = new Map<string, number>();
  for (const row of input.consumptions) {
    if (row.data.reversed_at) continue;
    const key = row.data.invoice_item_id;
    consumptionsByItem.set(key, (consumptionsByItem.get(key) ?? 0) + row.data.cogs_amount);
  }
  for (const row of input.itemCogs) {
    const cogs = row.data.cogs_amount;
    const fromConsumptions = consumptionsByItem.get(row.id) ?? 0;
    if (fromConsumptions > 0 && !approxMoneyEq(cogs, fromConsumptions)) {
      issues.push({
        code: "COGS_MISMATCH",
        severity: "warning",
        message: `invoice_item_cogs (${cogs}) != sum lot_consumptions (${fromConsumptions})`,
        invoice_item_id: row.id,
        invoice_id: row.data.invoice_id,
        delta: fromConsumptions - cogs,
      });
    }
  }

  if (input.inventoryTransactions && input.inventoryTransactionLines) {
    const txnById = new Map(input.inventoryTransactions.map((t) => [t.id, t]));
    const linesByTxn = new Map<string, typeof input.inventoryTransactionLines>();
    const ledgerSourceKeyCount = new Map<string, number>();

    for (const line of input.inventoryTransactionLines) {
      const tid = line.data.transaction_id;
      const arr = linesByTxn.get(tid) ?? [];
      arr.push(line);
      linesByTxn.set(tid, arr);
      if (!txnById.has(tid)) {
        issues.push({
          code: "ORPHANED_LEDGER_LINE",
          severity: "error",
          message: "Ledger line references missing transaction header",
          transaction_id: tid,
          product_id: line.data.product_id,
        });
      }
    }

    for (const txn of input.inventoryTransactions) {
      if (txn.data.status !== "posted") continue;
      const srcType = txn.data.source_document_type?.trim();
      const srcId = txn.data.source_document_id?.trim();
      if (srcType && srcId) {
        const key = `${txn.data.type}::${srcType}::${srcId}`;
        ledgerSourceKeyCount.set(key, (ledgerSourceKeyCount.get(key) ?? 0) + 1);
      }
      const lines = linesByTxn.get(txn.id) ?? [];
      if (lines.length === 0) {
        issues.push({
          code: "INVENTORY_TXN_INTEGRITY",
          severity: "error",
          message: "Posted inventory transaction has no lines",
          transaction_id: txn.id,
        });
      }
      for (const line of lines) {
        const expectedTotal = line.data.quantity * line.data.unit_cost;
        if (!approxMoneyEq(line.data.total_cost, expectedTotal)) {
          issues.push({
            code: "INVENTORY_TXN_INTEGRITY",
            severity: "warning",
            message: "Line total_cost does not match quantity * unit_cost",
            transaction_id: txn.id,
            product_id: line.data.product_id,
          });
        }
      }
    }

    for (const [key, count] of ledgerSourceKeyCount) {
      if (count > 1) {
        const [type, sourceType, sourceId] = key.split("::");
        issues.push({
          code: "DUPLICATE_LEDGER_BY_SOURCE",
          severity: "error",
          message: `Duplicate ledger for ${sourceType}/${sourceId} (${type})`,
          transaction_id: sourceId,
          details: { type, sourceType, sourceId, count },
        });
      }
    }
  }

  for (const inv of input.invoices) {
    if (inv.data.status !== "posted") continue;
    const ledgerStatus = inv.data.ledger_status;
    if (ledgerStatus === "pending" || ledgerStatus === "failed") {
      issues.push({
        code: "MISSING_LEDGER_FOR_POSTED_DOC",
        severity: "error",
        message: `Posted invoice missing inventory ledger (status: ${ledgerStatus})`,
        invoice_id: inv.id,
        details: { ledger_status: ledgerStatus, ledger_error: inv.data.ledger_error },
      });
    }
  }

  if (input.invoiceReturns) {
    for (const ret of input.invoiceReturns) {
      if (ret.data.status !== "posted") continue;
      const ledgerStatus = ret.data.ledger_status;
      const hasTxn = Boolean(ret.data.inventory_transaction_id?.trim());
      if ((ledgerStatus === "pending" || ledgerStatus === "failed") && !hasTxn) {
        issues.push({
          code: "MISSING_LEDGER_FOR_POSTED_DOC",
          severity: "error",
          message: `Posted return missing inventory ledger (status: ${ledgerStatus ?? "unset"})`,
          invoice_id: ret.data.original_invoice_id,
          details: { return_id: ret.id, ledger_status: ledgerStatus },
        });
      }
    }
  }

  if (input.inventoryDiscards) {
    for (const disc of input.inventoryDiscards) {
      const ledgerStatus = disc.data.ledger_status;
      const hasTxn = Boolean(disc.data.inventory_transaction_id?.trim());
      if ((ledgerStatus === "pending" || ledgerStatus === "failed") && !hasTxn) {
        issues.push({
          code: "MISSING_LEDGER_FOR_POSTED_DOC",
          severity: "warning",
          message: `Discard missing inventory ledger (status: ${ledgerStatus ?? "unset"})`,
          details: { discard_id: disc.id },
        });
      }
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  return {
    run_at: new Date().toISOString(),
    environment,
    summary: {
      errors,
      warnings,
      products_checked: input.products.length,
      lots_checked: input.lots.length,
    },
    issues,
  };
}

export function formatValidationSummary(report: ValidationReport): string {
  const { summary, issues } = report;
  const lines = [
    `Inventory validation (${report.environment}) at ${report.run_at}`,
    `Products: ${summary.products_checked}, Lots: ${summary.lots_checked}`,
    `Errors: ${summary.errors}, Warnings: ${summary.warnings}`,
  ];
  if (issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of issues.slice(0, 50)) {
      lines.push(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
    if (issues.length > 50) {
      lines.push(`  ... and ${issues.length - 50} more`);
    }
  }
  return lines.join("\n");
}
