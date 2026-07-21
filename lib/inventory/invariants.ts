/**
 * The inventory invariant register — the single machine-readable source of truth
 * (PHASE1_INTEGRITY_ARCHITECTURE_V2.md §7, §7.9).
 *
 * The validator iterates THIS register and never carries its own list, so
 * coverage is a countable number rather than a belief. Each entry declares its
 * id, severity, enforcement points, category, deploy-blocking status and
 * investigation action; an entry with a `check` is implemented, one without is
 * declared-but-pending (M1's job is to reach full coverage).
 *
 * Severity is authoritative here and joins to every reported issue by
 * `invariant_id`, so a report can never disagree with the register (§8.3).
 *
 * NOTE on transitional WARNING grades: L6 and the COGS cross-checks are declared
 * WARNING for now, not their eventual CRITICAL. This is deliberate and matches
 * the G6 precedent (§7.7): grading them CRITICAL before the physical-recount
 * re-baseline (docs/inventory/PHYSICAL_RECOUNT_REBASELINE.md) would start the
 * validator red across production — where history is known to be untrustworthy —
 * and a validator that is never green is one people learn to ignore. Each carries
 * an `escalatesTo` note recording the eventual grade and its trigger.
 */

import type { ValidationContext, InvariantFinding } from "@/lib/inventory/validationContext";
import type { ValidationIssueCode } from "@/lib/inventory/validationTypes";

export type InvariantSeverity = "CRITICAL" | "ERROR" | "WARNING";

/** T = asserted in the mutating transaction · R = Firestore rule · V = validator only. */
export type EnforcementPoint = "T" | "R" | "V";

export type InvariantCategory =
  | "product"
  | "lot"
  | "consumption"
  | "invoice"
  | "return"
  | "discard_adjustment"
  | "ledger"
  | "cash";

export type InvariantCheck = (ctx: ValidationContext) => InvariantFinding[];

export type Invariant = {
  /** Register id, e.g. "P1", "L6". Joins to every reported issue. */
  id: string;
  title: string;
  description: string;
  severity: InvariantSeverity;
  enforcement: EnforcementPoint[];
  category: InvariantCategory;
  /** CRITICAL and ERROR block deploys; WARNING does not (§7). */
  deployBlocking: boolean;
  investigation: string;
  /** Legacy ValidationIssueCode kept on emitted issues for back-compat. */
  legacyCode?: ValidationIssueCode;
  /** Records a deliberate transitional grade and the trigger to raise it. */
  escalatesTo?: { severity: InvariantSeverity; when: string };
  /** Present ⇒ implemented. Absent ⇒ declared but not yet checked. */
  check?: InvariantCheck;
};

// ─────────────────────────────────────────────────────────────────────────────
// Check helpers (pure over the prepared ValidationContext).
// ─────────────────────────────────────────────────────────────────────────────

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function approxMoneyEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.05;
}

// ── Product ──────────────────────────────────────────────────────────────────

const checkP1: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const product of ctx.input.products) {
    const book = isInt(product.data.stock_quantity) ? product.data.stock_quantity : 0;
    let lotsSum = 0;
    for (const lot of ctx.lotsByProduct.get(product.id) ?? []) {
      if (isInt(lot.data.qty_remaining)) lotsSum += lot.data.qty_remaining;
    }
    if (book !== lotsSum) {
      out.push({
        code: "STOCK_LOT_MISMATCH",
        message: `Book stock (${book}) != sum of lot qty_remaining (${lotsSum})`,
        product_id: product.id,
        product_name: product.data.name,
        book,
        lots_sum: lotsSum,
        delta: lotsSum - book,
      });
    }
  }
  return out;
};

const checkP2: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const product of ctx.input.products) {
    const book = isInt(product.data.stock_quantity) ? product.data.stock_quantity : 0;
    if (book < 0) {
      out.push({
        code: "NEGATIVE_BOOK_STOCK",
        message: `Book stock_quantity is negative (${book})`,
        product_id: product.id,
        product_name: product.data.name,
        book,
      });
    }
  }
  return out;
};

const checkP3: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const product of ctx.input.products) {
    const q = product.data.stock_quantity;
    if (typeof q === "number" && !Number.isInteger(q)) {
      out.push({
        message: `Book stock_quantity is not an integer (${q})`,
        product_id: product.id,
        product_name: product.data.name,
        actual: q,
      });
    }
  }
  return out;
};

// ── Lots ─────────────────────────────────────────────────────────────────────

const checkL1: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const lot of ctx.input.lots) {
    const qr = lot.data.qty_remaining;
    const qi = lot.data.qty_in;
    if (!isInt(qr) || qr < 0) {
      out.push({
        code: "NEGATIVE_LOT_QTY",
        message: "Lot qty_remaining is negative or not an integer",
        lot_id: lot.id,
        product_id: lot.data.product_id,
        context: { qty_remaining: qr },
      });
    }
    if (isInt(qr) && isInt(qi) && qr > qi) {
      out.push({
        code: "LOT_QTY_EXCEEDS_IN",
        message: `qty_remaining (${qr}) exceeds qty_in (${qi})`,
        lot_id: lot.id,
        product_id: lot.data.product_id,
      });
    }
  }
  return out;
};

const checkL5: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const lot of ctx.input.lots) {
    if (!ctx.productById.has(lot.data.product_id)) {
      out.push({
        code: "ORPHANED_LOT",
        message: "Lot references missing product",
        lot_id: lot.id,
        product_id: lot.data.product_id,
      });
    }
  }
  return out;
};

const checkL6: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const lot of ctx.input.lots) {
    const qi = isInt(lot.data.qty_in) ? lot.data.qty_in : 0;
    const qr = isInt(lot.data.qty_remaining) ? lot.data.qty_remaining : 0;
    const consumed = ctx.activeConsumptionByLot.get(lot.id) ?? 0;
    // NOTE: consumption-only form (the current identity). The full L6 adds
    // − discard allocations + restorations; that expansion + escalation to
    // CRITICAL lands with the post-recount work. Guarded by `consumed > 0` so a
    // fresh lot with no history is not flagged.
    const expectedRemaining = qi - consumed;
    if (expectedRemaining !== qr && consumed > 0) {
      out.push({
        code: "LOT_BALANCE_VS_CONSUMPTIONS",
        message: `Lot qty_remaining (${qr}) != qty_in - consumptions (${expectedRemaining})`,
        lot_id: lot.id,
        product_id: lot.data.product_id,
        context: { qty_in: qi, consumed, qty_remaining: qr },
      });
    }
  }
  return out;
};

// ── Consumptions ─────────────────────────────────────────────────────────────

const checkC3: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const row of ctx.input.consumptions) {
    const c = row.data;
    if (!ctx.lotById.has(c.lot_id)) {
      out.push({
        code: "ORPHANED_CONSUMPTION",
        message: "Consumption references missing lot",
        consumption_id: row.id,
        lot_id: c.lot_id,
        invoice_id: c.invoice_id,
      });
    }
    if (!ctx.invoiceById.has(c.invoice_id)) {
      out.push({
        code: "ORPHANED_CONSUMPTION_INVOICE",
        message: "Consumption references missing invoice",
        consumption_id: row.id,
        invoice_id: c.invoice_id,
      });
    }
  }
  return out;
};

const checkC8: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  const keyCount = new Map<string, number>();
  for (const row of ctx.input.consumptions) {
    if (row.data.reversed_at) continue;
    const key = `${row.data.invoice_item_id}::${row.data.lot_id}`;
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
  }
  for (const [key, count] of keyCount) {
    if (count > 1) {
      const [invoice_item_id, lot_id] = key.split("::");
      out.push({
        code: "DUPLICATE_CONSUMPTION",
        message: `Duplicate active consumption for item ${invoice_item_id} and lot ${lot_id}`,
        invoice_item_id,
        lot_id,
        context: { count },
      });
    }
  }
  return out;
};

const checkI6: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  const cogsByItem = new Map<string, number>();
  for (const row of ctx.input.consumptions) {
    if (row.data.reversed_at) continue;
    cogsByItem.set(row.data.invoice_item_id, (cogsByItem.get(row.data.invoice_item_id) ?? 0) + row.data.cogs_amount);
  }
  for (const row of ctx.input.itemCogs) {
    const cogs = row.data.cogs_amount;
    const fromConsumptions = cogsByItem.get(row.id) ?? 0;
    if (fromConsumptions > 0 && !approxMoneyEq(cogs, fromConsumptions)) {
      out.push({
        code: "COGS_MISMATCH",
        message: `invoice_item_cogs (${cogs}) != sum lot_consumptions (${fromConsumptions})`,
        invoice_item_id: row.id,
        invoice_id: row.data.invoice_id,
        delta: fromConsumptions - cogs,
      });
    }
  }
  return out;
};

// ── Ledger ───────────────────────────────────────────────────────────────────

const checkG5: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  if (!ctx.input.inventoryTransactions || !ctx.input.inventoryTransactionLines) return out;
  const txnById = new Map(ctx.input.inventoryTransactions.map((t) => [t.id, t]));
  for (const line of ctx.input.inventoryTransactionLines) {
    if (!txnById.has(line.data.transaction_id)) {
      out.push({
        code: "ORPHANED_LEDGER_LINE",
        message: "Ledger line references missing transaction header",
        transaction_id: line.data.transaction_id,
        product_id: line.data.product_id,
      });
    }
  }
  return out;
};

const checkG1: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  if (!ctx.input.inventoryTransactions || !ctx.input.inventoryTransactionLines) return out;
  const linesByTxn = new Map<string, number>();
  for (const line of ctx.input.inventoryTransactionLines) {
    linesByTxn.set(line.data.transaction_id, (linesByTxn.get(line.data.transaction_id) ?? 0) + 1);
  }
  const sourceKeyCount = new Map<string, number>();
  for (const txn of ctx.input.inventoryTransactions) {
    if (txn.data.status !== "posted") continue;
    const srcType = txn.data.source_document_type?.trim();
    const srcId = txn.data.source_document_id?.trim();
    if (srcType && srcId) {
      const key = `${txn.data.type}::${srcType}::${srcId}`;
      sourceKeyCount.set(key, (sourceKeyCount.get(key) ?? 0) + 1);
    }
    if ((linesByTxn.get(txn.id) ?? 0) === 0) {
      out.push({
        code: "INVENTORY_TXN_INTEGRITY",
        message: "Posted inventory transaction has no lines",
        transaction_id: txn.id,
      });
    }
  }
  for (const [key, count] of sourceKeyCount) {
    if (count > 1) {
      const [type, sourceType, sourceId] = key.split("::");
      out.push({
        code: "DUPLICATE_LEDGER_BY_SOURCE",
        message: `Duplicate ledger for ${sourceType}/${sourceId} (${type})`,
        transaction_id: sourceId,
        context: { type, sourceType, sourceId, count },
      });
    }
  }
  return out;
};

const checkTxnLineTotals: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  if (!ctx.input.inventoryTransactionLines) return out;
  for (const line of ctx.input.inventoryTransactionLines) {
    const expected = line.data.quantity * line.data.unit_cost;
    if (!approxMoneyEq(line.data.total_cost, expected)) {
      out.push({
        code: "INVENTORY_TXN_INTEGRITY",
        message: "Line total_cost does not match quantity * unit_cost",
        transaction_id: line.data.transaction_id,
        product_id: line.data.product_id,
      });
    }
  }
  return out;
};

const checkG2: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const inv of ctx.input.invoices) {
    if (inv.data.status !== "posted") continue;
    const ledgerStatus = inv.data.ledger_status;
    if (ledgerStatus === "pending" || ledgerStatus === "failed") {
      out.push({
        code: "MISSING_LEDGER_FOR_POSTED_DOC",
        message: `Posted invoice missing inventory ledger (status: ${ledgerStatus})`,
        invoice_id: inv.id,
        context: { ledger_status: ledgerStatus, ledger_error: inv.data.ledger_error },
      });
    }
  }
  for (const ret of ctx.input.invoiceReturns ?? []) {
    if (ret.data.status !== "posted") continue;
    const ledgerStatus = ret.data.ledger_status;
    const hasTxn = Boolean(ret.data.inventory_transaction_id?.trim());
    if ((ledgerStatus === "pending" || ledgerStatus === "failed") && !hasTxn) {
      out.push({
        code: "MISSING_LEDGER_FOR_POSTED_DOC",
        message: `Posted return missing inventory ledger (status: ${ledgerStatus ?? "unset"})`,
        invoice_id: ret.data.original_invoice_id,
        context: { return_id: ret.id, ledger_status: ledgerStatus },
      });
    }
  }
  return out;
};

const checkD4: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const disc of ctx.input.inventoryDiscards ?? []) {
    const ledgerStatus = disc.data.ledger_status;
    const hasTxn = Boolean(disc.data.inventory_transaction_id?.trim());
    if ((ledgerStatus === "pending" || ledgerStatus === "failed") && !hasTxn) {
      out.push({
        code: "MISSING_LEDGER_FOR_POSTED_DOC",
        message: `Discard missing inventory ledger (status: ${ledgerStatus ?? "unset"})`,
        context: { discard_id: disc.id },
      });
    }
  }
  return out;
};

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function toMillis(v: unknown): number {
  const t = v as { toMillis?: () => number } | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : 0;
}

// ── Product (extended) ───────────────────────────────────────────────────────

const checkP4: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const p of ctx.input.products) {
    const c = p.data.cost_price;
    if (typeof c !== "number" || !Number.isFinite(c) || c < 0) {
      out.push({ message: `cost_price invalid (${c})`, product_id: p.id, product_name: p.data.name, actual: c });
    }
  }
  return out;
};

const checkP5: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const p of ctx.input.products) {
    const lots = ctx.lotsByProduct.get(p.id) ?? [];
    let newest: { received: number; cost: number } | null = null;
    for (const lot of lots) {
      if (!isInt(lot.data.qty_remaining) || lot.data.qty_remaining <= 0) continue;
      const received = toMillis(lot.data.received_at);
      const cost = typeof lot.data.unit_cost === "number" ? lot.data.unit_cost : 0;
      if (!newest || received >= newest.received) newest = { received, cost };
    }
    if (newest && typeof p.data.cost_price === "number" && !approxMoneyEq(p.data.cost_price, newest.cost)) {
      out.push({
        message: `cost_price (${p.data.cost_price}) != newest live lot cost (${newest.cost})`,
        product_id: p.id,
        product_name: p.data.name,
        expected: newest.cost,
        actual: p.data.cost_price,
      });
    }
  }
  return out;
};

const checkP6: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  const seen = new Set<string>();
  const flag = (pid: string | undefined, where: string, refId: string) => {
    if (!pid || ctx.productById.has(pid) || seen.has(`${where}:${refId}`)) return;
    seen.add(`${where}:${refId}`);
    out.push({ message: `${where} references missing product ${pid}`, product_id: pid, context: { ref: refId } });
  };
  for (const c of ctx.input.consumptions) flag(c.data.product_id, "consumption", c.id);
  for (const ic of ctx.input.itemCogs) flag(ic.data.product_id, "invoice_item_cogs", ic.id);
  return out;
};

// ── Lots (extended) ──────────────────────────────────────────────────────────

const checkL2: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const lot of ctx.input.lots) {
    if (!isInt(lot.data.qty_in) || lot.data.qty_in <= 0) {
      out.push({ message: `qty_in must be a positive integer (${lot.data.qty_in})`, lot_id: lot.id, product_id: lot.data.product_id });
    }
  }
  return out;
};

const checkL3: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const lot of ctx.input.lots) {
    const u = lot.data.unit_cost;
    if (typeof u !== "number" || !Number.isFinite(u) || u < 0) {
      out.push({ message: `lot unit_cost invalid (${u})`, lot_id: lot.id, product_id: lot.data.product_id });
    }
  }
  return out;
};

const checkL4: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const lot of ctx.input.lots) {
    if (lot.data.received_at == null) {
      out.push({ message: "lot missing received_at (FIFO order at risk)", lot_id: lot.id, product_id: lot.data.product_id });
    }
  }
  return out;
};

const checkL8: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const lot of ctx.input.lots) {
    if (lot.data.source === "stock_in" && !lot.data.trader_id?.trim()) {
      out.push({ message: "receipt-origin lot missing trader_id", lot_id: lot.id, product_id: lot.data.product_id });
    }
  }
  return out;
};

// ── Consumptions (extended) ──────────────────────────────────────────────────

const checkC1: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  const activeQtyByItem = new Map<string, number>();
  for (const row of ctx.input.consumptions) {
    if (row.data.reversed_at) continue;
    activeQtyByItem.set(row.data.invoice_item_id, (activeQtyByItem.get(row.data.invoice_item_id) ?? 0) + row.data.quantity);
  }
  for (const ic of ctx.input.itemCogs) {
    const active = activeQtyByItem.get(ic.id) ?? 0;
    if (isInt(ic.data.quantity) && active !== ic.data.quantity) {
      out.push({
        message: `Σ active consumption qty (${active}) != invoice item qty (${ic.data.quantity})`,
        invoice_item_id: ic.id,
        invoice_id: ic.data.invoice_id,
        expected: ic.data.quantity,
        actual: active,
        delta: active - ic.data.quantity,
      });
    }
  }
  return out;
};

const checkC2: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const row of ctx.input.consumptions) {
    if (!(typeof row.data.quantity === "number" && row.data.quantity > 0)) {
      out.push({ message: `consumption quantity must be > 0 (${row.data.quantity})`, consumption_id: row.id, invoice_id: row.data.invoice_id });
    }
  }
  return out;
};

const checkC4: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const row of ctx.input.consumptions) {
    const expected = round2(row.data.unit_cost * row.data.quantity);
    if (Number.isFinite(expected) && !approxMoneyEq(row.data.cogs_amount, expected)) {
      out.push({
        message: `consumption cogs_amount (${row.data.cogs_amount}) != round2(unit_cost × qty) (${expected})`,
        consumption_id: row.id,
        invoice_id: row.data.invoice_id,
        delta: row.data.cogs_amount - expected,
      });
    }
  }
  return out;
};

const checkC5: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const row of ctx.input.consumptions) {
    const lot = ctx.lotById.get(row.data.lot_id);
    if (lot && typeof lot.data.unit_cost === "number" && !approxMoneyEq(row.data.unit_cost, lot.data.unit_cost)) {
      out.push({
        message: `consumption unit_cost (${row.data.unit_cost}) != lot unit_cost (${lot.data.unit_cost})`,
        consumption_id: row.id,
        lot_id: row.data.lot_id,
        invoice_id: row.data.invoice_id,
      });
    }
  }
  return out;
};

const checkC6: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const row of ctx.input.consumptions) {
    const inv = ctx.invoiceById.get(row.data.invoice_id);
    if (inv?.data.status === "void" && !row.data.reversed_at) {
      out.push({ message: "consumption of a voided invoice is not reversed", consumption_id: row.id, invoice_id: row.data.invoice_id });
    }
  }
  return out;
};

const checkC7: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const row of ctx.input.consumptions) {
    const inv = ctx.invoiceById.get(row.data.invoice_id);
    if (inv && inv.data.status !== "posted" && inv.data.status !== "void") {
      out.push({ message: `consumption belongs to a ${inv.data.status} invoice (torn post)`, consumption_id: row.id, invoice_id: row.data.invoice_id });
    }
  }
  return out;
};

// ── Invoices (extended) ──────────────────────────────────────────────────────

const checkI1: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const inv of ctx.input.invoices) {
    if (inv.data.status !== "posted") continue;
    const missing = [];
    if (inv.data.posted_total_amount == null) missing.push("posted_total_amount");
    if (inv.data.posted_cogs_amount == null) missing.push("posted_cogs_amount");
    if (inv.data.posted_at == null) missing.push("posted_at");
    if (missing.length) {
      out.push({ message: `posted invoice missing ${missing.join(", ")}`, invoice_id: inv.id, context: { missing } });
    }
  }
  return out;
};

const checkI2: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  const itemsWithActive = new Set<string>();
  for (const row of ctx.input.consumptions) {
    if (!row.data.reversed_at) itemsWithActive.add(row.data.invoice_item_id);
  }
  for (const inv of ctx.input.invoices) {
    if (inv.data.status !== "posted") continue;
    for (const itemId of inv.data.item_ids ?? []) {
      if (!itemsWithActive.has(itemId)) {
        out.push({ message: `posted invoice item ${itemId} has no active consumption`, invoice_id: inv.id, invoice_item_id: itemId });
      }
    }
  }
  return out;
};

const checkI3: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  const draftIds = new Set(ctx.input.invoices.filter((i) => i.data.status === "draft").map((i) => i.id));
  if (draftIds.size === 0) return out;
  for (const row of ctx.input.consumptions) {
    if (draftIds.has(row.data.invoice_id)) {
      out.push({ message: "draft invoice owns a consumption (draft firewall breach)", consumption_id: row.id, invoice_id: row.data.invoice_id });
    }
  }
  for (const ic of ctx.input.itemCogs) {
    if (draftIds.has(ic.data.invoice_id)) {
      out.push({ message: "draft invoice owns an invoice_item_cogs row", invoice_item_id: ic.id, invoice_id: ic.data.invoice_id });
    }
  }
  return out;
};

const checkI4: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  const itemCogsIds = new Set(ctx.input.itemCogs.map((i) => i.id));
  for (const inv of ctx.input.invoices) {
    if (inv.data.status !== "posted") continue;
    for (const itemId of inv.data.item_ids ?? []) {
      if (!itemCogsIds.has(itemId)) {
        out.push({ message: `posted invoice item_id ${itemId} does not resolve`, invoice_id: inv.id, invoice_item_id: itemId });
      }
    }
  }
  return out;
};

const checkI5: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  const cogsByInvoice = new Map<string, number>();
  for (const ic of ctx.input.itemCogs) {
    cogsByInvoice.set(ic.data.invoice_id, (cogsByInvoice.get(ic.data.invoice_id) ?? 0) + ic.data.cogs_amount);
  }
  for (const inv of ctx.input.invoices) {
    const posted = inv.data.posted_cogs_amount;
    if (typeof posted !== "number") continue;
    const sum = cogsByInvoice.get(inv.id) ?? 0;
    if (!approxMoneyEq(posted, sum)) {
      out.push({ message: `posted_cogs_amount (${posted}) != Σ invoice_item_cogs (${sum})`, invoice_id: inv.id, delta: sum - posted });
    }
  }
  return out;
};

const checkI9: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const inv of ctx.input.invoices) {
    if (inv.data.status === "void" && inv.data.stock_reversal_applied !== true) {
      out.push({ message: "voided invoice does not have stock_reversal_applied == true", invoice_id: inv.id });
    }
  }
  return out;
};

const checkI10: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  const byOrder = new Map<string, number>();
  for (const inv of ctx.input.invoices) {
    const oid = inv.data.order_id;
    if (oid) byOrder.set(oid, (byOrder.get(oid) ?? 0) + 1);
  }
  for (const [oid, count] of byOrder) {
    if (count > 1) out.push({ message: `order_id ${oid} used by ${count} invoices`, context: { order_id: oid, count } });
  }
  return out;
};

// ── Ledger (extended) ────────────────────────────────────────────────────────

const checkG7: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const txn of ctx.input.inventoryTransactions ?? []) {
    if (txn.data.status !== "posted") continue;
    if (!txn.data.posted_by_uid?.trim()) {
      out.push({ message: `ledger transaction has no posted_by_uid (${txn.data.type})`, transaction_id: txn.id });
    }
  }
  return out;
};

const checkG8: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const txn of ctx.input.inventoryTransactions ?? []) {
    if (txn.data.type === "RECONCILIATION" && (txn.data as { movement?: boolean }).movement !== false) {
      out.push({ message: "RECONCILIATION row must carry movement:false", transaction_id: txn.id });
    }
  }
  return out;
};

// ── Adjustments (extended) ───────────────────────────────────────────────────

const checkA1: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const txn of ctx.input.inventoryTransactions ?? []) {
    if (txn.data.type === "ADJUSTMENT" && !txn.data.reason?.trim()) {
      out.push({ message: "ADJUSTMENT ledger row missing reason", transaction_id: txn.id });
    }
  }
  return out;
};

const checkA2: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const txn of ctx.input.inventoryTransactions ?? []) {
    if (txn.data.type === "ADJUSTMENT" && !txn.data.posted_by_uid?.trim()) {
      out.push({ message: "ADJUSTMENT ledger row missing posted_by_uid", transaction_id: txn.id });
    }
  }
  return out;
};

const checkA3: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  if (!ctx.input.inventoryTransactionLines) return out;
  const adjTxnIds = new Set((ctx.input.inventoryTransactions ?? []).filter((t) => t.data.type === "ADJUSTMENT").map((t) => t.id));
  for (const line of ctx.input.inventoryTransactionLines) {
    if (!adjTxnIds.has(line.data.transaction_id)) continue;
    if (line.data.before_on_hand == null || line.data.after_on_hand == null) {
      out.push({ message: "ADJUSTMENT line missing before/after on_hand", transaction_id: line.data.transaction_id, product_id: line.data.product_id });
    }
  }
  return out;
};

// ── Cash (extended) ──────────────────────────────────────────────────────────

const checkK1: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const inv of ctx.input.invoices) {
    if (typeof inv.data.paid_amount === "number" && inv.data.paid_amount < 0) {
      out.push({ message: `paid_amount is negative (${inv.data.paid_amount})`, invoice_id: inv.id });
    }
  }
  return out;
};

const checkK2: InvariantCheck = (ctx) => {
  const out: InvariantFinding[] = [];
  for (const inv of ctx.input.invoices) {
    if (inv.data.status !== "posted") continue;
    const total = typeof inv.data.posted_total_amount === "number" ? inv.data.posted_total_amount : inv.data.total_amount;
    const returned = typeof inv.data.returned_amount === "number" ? inv.data.returned_amount : 0;
    const effective = total - returned;
    if (typeof inv.data.paid_amount === "number" && inv.data.paid_amount > effective + 0.05) {
      out.push({
        message: `paid_amount (${inv.data.paid_amount}) > effective total (${effective})`,
        invoice_id: inv.id,
        expected: effective,
        actual: inv.data.paid_amount,
      });
    }
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// The register. Order is validation-pass order (cheap/structural first).
// Entries without a `check` are declared-but-pending — the M1 coverage target.
// ─────────────────────────────────────────────────────────────────────────────

export const INVARIANTS: Invariant[] = [
  // 7.1 Product stock
  { id: "P1", title: "Book stock equals lot total", description: "stock_quantity == Σ qty_remaining (two-sided)", severity: "CRITICAL", enforcement: ["T", "V"], category: "product", deployBlocking: true, investigation: "Movements in window; then §15 repair", legacyCode: "STOCK_LOT_MISMATCH", check: checkP1 },
  { id: "P2", title: "Book stock non-negative", description: "stock_quantity >= 0", severity: "CRITICAL", enforcement: ["T", "R", "V"], category: "product", deployBlocking: true, investigation: "Find the over-consuming write", legacyCode: "NEGATIVE_BOOK_STOCK", check: checkP2 },
  { id: "P3", title: "Book stock integer", description: "stock_quantity is an integer", severity: "ERROR", enforcement: ["T", "R", "V"], category: "product", deployBlocking: true, investigation: "Find the fractional writer", check: checkP3 },
  { id: "P4", title: "Cost price valid", description: "cost_price >= 0, finite", severity: "ERROR", enforcement: ["R", "V"], category: "product", deployBlocking: true, investigation: "Check last receipt" },
  { id: "P5", title: "Cost price matches newest live lot", description: "cost_price matches newest live lot cost", severity: "WARNING", enforcement: ["V"], category: "product", deployBlocking: false, investigation: "Informational only" },
  { id: "P6", title: "Referenced products exist", description: "Referenced products exist", severity: "ERROR", enforcement: ["V"], category: "product", deployBlocking: true, investigation: "Check deletion history" },

  // 7.2 FIFO lots
  { id: "L1", title: "Lot remaining in range", description: "0 <= qty_remaining <= qty_in", severity: "CRITICAL", enforcement: ["T", "R", "V"], category: "lot", deployBlocking: true, investigation: "Restoration or lost update", legacyCode: "NEGATIVE_LOT_QTY", check: checkL1 },
  { id: "L2", title: "Lot intake positive", description: "qty_in > 0", severity: "ERROR", enforcement: ["R", "V"], category: "lot", deployBlocking: true, investigation: "Check creating operation" },
  { id: "L3", title: "Lot unit cost valid", description: "unit_cost >= 0, finite", severity: "CRITICAL", enforcement: ["R", "V"], category: "lot", deployBlocking: true, investigation: "Check receipt" },
  { id: "L4", title: "Received-at present", description: "received_at present and valid", severity: "ERROR", enforcement: ["T", "R", "V"], category: "lot", deployBlocking: true, investigation: "FIFO order at risk" },
  { id: "L5", title: "Lot product resolves", description: "product_id resolves", severity: "ERROR", enforcement: ["V"], category: "lot", deployBlocking: true, investigation: "Orphan lot", legacyCode: "ORPHANED_LOT", check: checkL5 },
  { id: "L6", title: "Lot consumption chain", description: "qty_in − qty_remaining == Σ active consumptions + Σ discard allocations − Σ restorations", severity: "WARNING", enforcement: ["V"], category: "lot", deployBlocking: false, investigation: "The chain check", legacyCode: "LOT_BALANCE_VS_CONSUMPTIONS", escalatesTo: { severity: "CRITICAL", when: "full identity implemented AND production re-baselined via physical recount" }, check: checkL6 },
  { id: "L7", title: "Lots never deleted", description: "Lots are never deleted", severity: "CRITICAL", enforcement: ["R"], category: "lot", deployBlocking: true, investigation: "Rule must forbid delete" },
  { id: "L8", title: "Receipt-origin lots carry trader", description: "trader_id on receipt-origin lots", severity: "WARNING", enforcement: ["V"], category: "lot", deployBlocking: false, investigation: "Sourcing gap" },

  // 7.3 Consumptions
  { id: "C1", title: "Consumption qty matches item", description: "Σ active consumption qty == invoice item qty", severity: "CRITICAL", enforcement: ["T", "V"], category: "consumption", deployBlocking: true, investigation: "Torn post / partial consume" },
  { id: "C2", title: "Consumption qty positive", description: "quantity > 0", severity: "ERROR", enforcement: ["T", "V"], category: "consumption", deployBlocking: true, investigation: "Check consuming op" },
  { id: "C3", title: "Consumption refs resolve", description: "lot_id / invoice_item_id resolve", severity: "ERROR", enforcement: ["V"], category: "consumption", deployBlocking: true, investigation: "Orphan consumption", legacyCode: "ORPHANED_CONSUMPTION", check: checkC3 },
  { id: "C4", title: "Consumption COGS arithmetic", description: "cogs_amount == round2(unit_cost × quantity)", severity: "WARNING", enforcement: ["T", "V"], category: "consumption", deployBlocking: false, investigation: "Cost basis", escalatesTo: { severity: "CRITICAL", when: "production re-baselined" } },
  { id: "C5", title: "Consumption cost basis", description: "consumption.unit_cost == lot.unit_cost at consumption time", severity: "CRITICAL", enforcement: ["T", "V"], category: "consumption", deployBlocking: true, investigation: "Cost basis drift" },
  { id: "C6", title: "Void reverses consumptions", description: "Voided invoice → all consumptions carry reversed_at", severity: "CRITICAL", enforcement: ["V"], category: "consumption", deployBlocking: true, investigation: "Torn void" },
  { id: "C7", title: "Consumptions only for posted/void", description: "Consumptions exist only for posted/void invoices", severity: "CRITICAL", enforcement: ["V"], category: "consumption", deployBlocking: true, investigation: "Torn post" },
  { id: "C8", title: "No duplicate active consumption", description: "One active consumption per (item, lot)", severity: "ERROR", enforcement: ["V"], category: "consumption", deployBlocking: true, investigation: "Duplicate consume", legacyCode: "DUPLICATE_CONSUMPTION", check: checkC8 },

  // 7.4 Invoices, sales, COGS
  { id: "I1", title: "Posted invoice complete", description: "Posted invoice has all posted_* fields", severity: "ERROR", enforcement: ["T", "R"], category: "invoice", deployBlocking: true, investigation: "Torn post" },
  { id: "I2", title: "Posted item has consumption", description: "Every item of a posted non-void invoice has ≥1 active consumption", severity: "CRITICAL", enforcement: ["V"], category: "invoice", deployBlocking: true, investigation: "Missing consume" },
  { id: "I3", title: "Draft immobility", description: "Draft invoices own no consumptions, sales, or COGS rows", severity: "CRITICAL", enforcement: ["V"], category: "invoice", deployBlocking: true, investigation: "Draft firewall breach" },
  { id: "I4", title: "Invoice item refs resolve", description: "item_ids all resolve", severity: "CRITICAL", enforcement: ["T", "V"], category: "invoice", deployBlocking: true, investigation: "Dangling item" },
  { id: "I5", title: "Invoice COGS total", description: "posted_cogs_amount == Σ invoice_item_cogs.cogs_amount", severity: "CRITICAL", enforcement: ["T", "V"], category: "invoice", deployBlocking: true, investigation: "COGS rollup" },
  { id: "I6", title: "Item COGS from consumptions", description: "Item COGS == Σ that item's consumption COGS", severity: "WARNING", enforcement: ["T", "V"], category: "invoice", deployBlocking: false, investigation: "COGS rollup", legacyCode: "COGS_MISMATCH", escalatesTo: { severity: "CRITICAL", when: "production re-baselined" }, check: checkI6 },
  { id: "I7", title: "Sales qty matches items", description: "Σ sales qty == Σ invoice item qty (posted)", severity: "ERROR", enforcement: ["V"], category: "invoice", deployBlocking: true, investigation: "Sales projection" },
  { id: "I8", title: "One sales row per item", description: "Exactly one sales row per posted item", severity: "ERROR", enforcement: ["V"], category: "invoice", deployBlocking: true, investigation: "Sales projection" },
  { id: "I9", title: "Void reversal flagged", description: "Voided invoice has stock_reversal_applied == true", severity: "CRITICAL", enforcement: ["T", "R"], category: "invoice", deployBlocking: true, investigation: "Torn void" },
  { id: "I10", title: "Order id unique", description: "order_id unique", severity: "CRITICAL", enforcement: ["T"], category: "invoice", deployBlocking: true, investigation: "Duplicate order" },

  // 7.5 Returns, restorations, exchanges
  { id: "R1", title: "Return within sold", description: "Returned qty ≤ sold − already returned", severity: "CRITICAL", enforcement: ["T", "V"], category: "return", deployBlocking: true, investigation: "Over-return" },
  { id: "R2", title: "Restoration within consumption", description: "Σ restorations per consumption ≤ consumption qty", severity: "CRITICAL", enforcement: ["T", "V"], category: "return", deployBlocking: true, investigation: "Over-restore" },
  { id: "R3", title: "Restore+writeoff within consumed", description: "restorations + write-offs ≤ consumed", severity: "CRITICAL", enforcement: ["T", "V"], category: "return", deployBlocking: true, investigation: "Over-unwind" },
  { id: "R4", title: "Restore to original lot/cost", description: "Restored qty returns to original lot at original cost", severity: "CRITICAL", enforcement: ["T", "V"], category: "return", deployBlocking: true, investigation: "Cost basis" },
  { id: "R5", title: "Restore within intake", description: "Restoration never pushes qty_remaining above qty_in", severity: "CRITICAL", enforcement: ["T", "R"], category: "return", deployBlocking: true, investigation: "Over-restore" },
  { id: "R6", title: "Write-offs never restock", description: "Written-off returns never restock", severity: "CRITICAL", enforcement: ["T", "V"], category: "return", deployBlocking: true, investigation: "Bad restock" },
  { id: "R7", title: "Posted return has ledger", description: "Posted return has its ledger row", severity: "ERROR", enforcement: ["V"], category: "return", deployBlocking: true, investigation: "Missing ledger" },
  { id: "R8", title: "Counter-sale credit matches", description: "Σ attached credit == returns_credit_amount", severity: "ERROR", enforcement: ["V"], category: "return", deployBlocking: true, investigation: "Credit netting" },
  { id: "R9", title: "Void has no posted returns", description: "Voided invoice has no posted returns", severity: "CRITICAL", enforcement: ["T"], category: "return", deployBlocking: true, investigation: "Void vs return" },
  { id: "R10", title: "No stale pending counter-sale", description: "returns_post_status: pending older than 1h", severity: "ERROR", enforcement: ["V"], category: "return", deployBlocking: true, investigation: "Unfinalised counter-sale" },

  // 7.6 Discards and adjustments
  { id: "D1", title: "Discard allocations match qty", description: "Σ discard lot allocations == discard item qty", severity: "CRITICAL", enforcement: ["T", "V"], category: "discard_adjustment", deployBlocking: true, investigation: "Allocation" },
  { id: "D2", title: "Discard FIFO", description: "Discard allocations follow FIFO", severity: "ERROR", enforcement: ["V"], category: "discard_adjustment", deployBlocking: true, investigation: "FIFO order" },
  { id: "D3", title: "Discard COGS", description: "Discard COGS == Σ(lot cost × qty), rounded 2dp", severity: "ERROR", enforcement: ["T", "V"], category: "discard_adjustment", deployBlocking: true, investigation: "COGS" },
  { id: "D4", title: "Discard has ledger", description: "Every discard has a DAMAGE ledger row", severity: "WARNING", enforcement: ["V"], category: "discard_adjustment", deployBlocking: false, investigation: "Missing ledger", legacyCode: "MISSING_LEDGER_FOR_POSTED_DOC", check: checkD4 },
  { id: "A1", title: "Adjustment has reason", description: "Adjustment carries reason category + detail", severity: "CRITICAL", enforcement: ["T"], category: "discard_adjustment", deployBlocking: true, investigation: "Audit gap" },
  { id: "A2", title: "Adjustment has uid", description: "Adjustment carries posted_by_uid", severity: "CRITICAL", enforcement: ["T"], category: "discard_adjustment", deployBlocking: true, investigation: "Audit gap" },
  { id: "A3", title: "Adjustment records on-hand", description: "Ledger line records before/after on_hand", severity: "ERROR", enforcement: ["T"], category: "discard_adjustment", deployBlocking: true, investigation: "Audit gap" },
  { id: "A4", title: "Negative adjustment FIFO cost", description: "Negative adjustment ledger cost is FIFO cost consumed", severity: "ERROR", enforcement: ["T"], category: "discard_adjustment", deployBlocking: true, investigation: "Cost basis" },
  { id: "A5", title: "Adjustment ledger type", description: "Adjustments emit ADJUSTMENT, never PURCHASE_RECEIPT/STOCK_ISSUE", severity: "CRITICAL", enforcement: ["T"], category: "discard_adjustment", deployBlocking: true, investigation: "Ledger type" },

  // 7.7 Ledger
  { id: "G1", title: "One ledger per movement", description: "Every committed movement has exactly one ledger transaction", severity: "CRITICAL", enforcement: ["V"], category: "ledger", deployBlocking: true, investigation: "Duplicate/missing ledger", legacyCode: "DUPLICATE_LEDGER_BY_SOURCE", check: checkG1 },
  { id: "G2", title: "No stale pending ledger", description: "No source doc pending/failed beyond 1h (CRITICAL beyond 24h)", severity: "ERROR", enforcement: ["V"], category: "ledger", deployBlocking: true, investigation: "Outbox stuck", legacyCode: "MISSING_LEDGER_FOR_POSTED_DOC", check: checkG2 },
  { id: "G3", title: "Ledger append-only", description: "Ledger is append-only", severity: "CRITICAL", enforcement: ["R"], category: "ledger", deployBlocking: true, investigation: "Mutation attempt" },
  { id: "G4", title: "Ledger reconciles stock change", description: "net Δ stock_quantity == Σ movement line qty + Σ reconciliation corrections", severity: "CRITICAL", enforcement: ["V"], category: "ledger", deployBlocking: true, investigation: "Second opinion" },
  { id: "G5", title: "No orphan ledger line", description: "No orphan ledger row", severity: "ERROR", enforcement: ["V"], category: "ledger", deployBlocking: true, investigation: "Orphan line", legacyCode: "ORPHANED_LEDGER_LINE", check: checkG5 },
  { id: "G6", title: "Line unit cost where basis exists", description: "Line unit_cost > 0 where a cost basis exists", severity: "WARNING", enforcement: ["V"], category: "ledger", deployBlocking: false, investigation: "Cost basis", escalatesTo: { severity: "ERROR", when: "M5 ledger unit_cost work" } },
  { id: "G7", title: "Ledger has uid", description: "posted_by_uid non-empty", severity: "ERROR", enforcement: ["V"], category: "ledger", deployBlocking: true, investigation: "Attribution" },
  { id: "G8", title: "Reconciliation rows non-movement", description: "RECONCILIATION rows carry movement:false and never enter movement sums", severity: "ERROR", enforcement: ["V"], category: "ledger", deployBlocking: true, investigation: "Movement classification" },

  // 7.8 Cash-only invoice constraints
  { id: "K1", title: "Paid non-negative", description: "paid_amount >= 0", severity: "CRITICAL", enforcement: ["T", "R", "V"], category: "cash", deployBlocking: true, investigation: "Bad payment" },
  { id: "K2", title: "Paid within effective total", description: "paid_amount <= effective invoice total (posted − returned)", severity: "CRITICAL", enforcement: ["T", "V"], category: "cash", deployBlocking: true, investigation: "Overpayment" },
  { id: "K3", title: "Void cash rule", description: "Voided invoice handles recorded cash per approved rule", severity: "CRITICAL", enforcement: ["T", "V"], category: "cash", deployBlocking: true, investigation: "Void cash" },
  { id: "K4", title: "Finalize preserves cash", description: "Counter-sale finalize never reduces paid_amount it did not record", severity: "CRITICAL", enforcement: ["T", "V"], category: "cash", deployBlocking: true, investigation: "Cash overwrite" },
  { id: "K5", title: "Cash attributable", description: "Cash mutation attributable to user + timestamp where practical", severity: "WARNING", enforcement: ["T"], category: "cash", deployBlocking: false, investigation: "Attribution" },

  // Ledger line arithmetic (validator-only structural check; groups under G1's integrity code)
  { id: "G1b", title: "Ledger line total arithmetic", description: "line total_cost == quantity × unit_cost", severity: "WARNING", enforcement: ["V"], category: "ledger", deployBlocking: false, investigation: "Line arithmetic", legacyCode: "INVENTORY_TXN_INTEGRITY", check: checkTxnLineTotals },
];

const BY_ID = new Map(INVARIANTS.map((i) => [i.id, i]));

// Checks implemented in this M1 PR beyond the initial ported set, attached by id
// so adding an implementation is a one-line change here plus the function above.
const ADDITIONAL_CHECKS: Record<string, InvariantCheck> = {
  P4: checkP4, P5: checkP5, P6: checkP6,
  L2: checkL2, L3: checkL3, L4: checkL4, L8: checkL8,
  C1: checkC1, C2: checkC2, C4: checkC4, C5: checkC5, C6: checkC6, C7: checkC7,
  I1: checkI1, I2: checkI2, I3: checkI3, I4: checkI4, I5: checkI5, I9: checkI9, I10: checkI10,
  G7: checkG7, G8: checkG8,
  A1: checkA1, A2: checkA2, A3: checkA3,
  K1: checkK1, K2: checkK2,
};
for (const [id, check] of Object.entries(ADDITIONAL_CHECKS)) {
  const inv = BY_ID.get(id);
  if (inv) inv.check = check;
}

export function getInvariant(id: string): Invariant | undefined {
  return BY_ID.get(id);
}

export type RegisterCoverage = {
  total: number;
  implemented: number;
  pending: number;
  implementedIds: string[];
  pendingIds: string[];
};

/** Countable coverage — the number that replaces "we think it's covered". */
export function registerCoverage(): RegisterCoverage {
  const implemented = INVARIANTS.filter((i) => i.check).map((i) => i.id);
  const pending = INVARIANTS.filter((i) => !i.check).map((i) => i.id);
  return {
    total: INVARIANTS.length,
    implemented: implemented.length,
    pending: pending.length,
    implementedIds: implemented,
    pendingIds: pending,
  };
}
