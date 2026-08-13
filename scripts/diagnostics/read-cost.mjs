/**
 * Measure the real Firestore read cost of each page.
 *
 * READ-ONLY. Uses count() aggregations exclusively — it never fetches a document,
 * so running it costs roughly 1 read per 1000 matched index entries per query
 * (a few dozen reads total, versus the ~25k a single dashboard view costs).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/diagnostics/read-cost.mjs
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/diagnostics/read-cost.mjs --project prod
 *   ... --views 12          # project a daily total over N page views
 *
 * The page models below mirror the code as it exists today; see PAGES for the
 * call path each line came from.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const FIREBASERC = path.join(path.resolve(process.cwd()), ".firebaserc");

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function resolveProjectId() {
  const alias = arg("--project", "default");
  const raw = JSON.parse(fs.readFileSync(FIREBASERC, "utf8"));
  const id = raw?.projects?.[alias];
  if (!id) {
    throw new Error(
      `No project alias "${alias}" in .firebaserc. Available: ${Object.keys(raw?.projects ?? {}).join(", ")}`,
    );
  }
  return { alias, id };
}

// ── date bounds, mirroring lib/profit/periods.ts ────────────────────────────
function todayBounds(now) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999),
  };
}

function yearBounds(now) {
  return {
    start: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
    end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
  };
}

/** Mon–Sun route week; on any day but Sunday the *previous* complete week is used. */
function velocityWeekBounds(now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = today.getDay();
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(monday.getDate() + offsetToMonday);
  if (dow !== 0) monday.setDate(monday.getDate() - 7);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

// ── counting ────────────────────────────────────────────────────────────────
let queryCount = 0;

async function countAll(db, name) {
  queryCount += 1;
  const snap = await db.collection(name).count().get();
  return snap.data().count;
}

async function countRange(db, name, field, start, end) {
  queryCount += 1;
  const snap = await db
    .collection(name)
    .where(field, ">=", admin.firestore.Timestamp.fromDate(start))
    .where(field, "<=", admin.firestore.Timestamp.fromDate(end))
    .count()
    .get();
  return snap.data().count;
}

async function countWhere(db, name, field, op, value) {
  queryCount += 1;
  const snap = await db.collection(name).where(field, op, value).count().get();
  return snap.data().count;
}

let quotaExhausted = false;
const failures = [];

async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (e?.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(msg)) {
      quotaExhausted = true;
    }
    failures.push(label);
    console.warn(`  ! ${label}: ${msg}`);
    return null;
  }
}

/**
 * A zero from a failed count is not a measurement. Bail rather than print a
 * report full of zeros that reads like real data.
 */
function assertMeasured(n) {
  if (quotaExhausted) {
    console.error(
      "\n━━ Cannot measure: the daily read quota is already exhausted ━━\n\n" +
        "Every count() aggregation was rejected with RESOURCE_EXHAUSTED. Those are the\n" +
        "cheapest reads Firestore offers, so this is itself the finding: the project is on\n" +
        "the Spark plan and has spent its 50,000 reads for the day.\n\n" +
        "Two ways forward:\n" +
        "  1. Upgrade to Blaze — lifts the cap immediately, unblocks production, and lets\n" +
        "     this script run right away. Reads past the free tier are $0.06 per 100k.\n" +
        "  2. Wait for the reset at midnight US Pacific, then run this script FIRST,\n" +
        "     before anyone opens the app — a few dashboard views will spend it again.\n",
    );
    process.exit(2);
  }
  const missing = Object.entries(n).filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length > 0) {
    console.error(
      `\nCould not count: ${missing.join(", ")}\n` +
        "Check the service account has Firestore read access to this project.\n",
    );
    process.exit(2);
  }
}

// ── page models, traced from the source ─────────────────────────────────────
function buildPages(n) {
  return [
    {
      route: "/ (dashboard home)",
      note: "P1: fetchDashboardRaw — one read per collection, shared by every panel",
      reads: [
        ["fetchDashboardRaw → sales", n.sales],
        ["fetchDashboardRaw → stock_lots", n.stockLots],
        ["fetchDashboardRaw → invoices", n.invoices],
        ["fetchDashboardRaw → products", n.products],
        ["fetchDashboardRaw → cash_entries", n.cashEntries],
        ["fetchDashboardRaw → customers", n.customers],
        ["fetchDashboardRaw → expenses", n.expenses],
        ["fetchDashboardRaw → invoice_returns", n.invoiceReturns],
        ["fetchDashboardRaw → inventory_discards", n.inventoryDiscards],
        ["fetchCashSettings → settings/cash", 1],
      ],
    },
    {
      route: "/ (dashboard, pre-P1)",
      note: "BASELINE for comparison — the five-loader version this replaced",
      reads: [
        ["loadCashInHandSnapshot → sales", n.sales],
        ["loadCashInHandSnapshot → expenses", n.expenses],
        ["loadCashInHandSnapshot → invoices", n.invoices],
        ["loadCashInHandSnapshot → stock_lots", n.stockLots],
        ["loadCashInHandSnapshot → cash_entries", n.cashEntries],
        ["loadProfitForPeriod → products", n.products],
        ["loadProfitForPeriod → sales (today)", n.salesToday],
        ["loadProfitForPeriod → expenses (today)", n.expensesToday],
        ["loadProfitForPeriod → invoices (void scan)", n.invoices],
        ["loadProfitForPeriod → invoice_returns", n.invoiceReturns],
        ["loadProfitForPeriod → inventory_discards", n.inventoryDiscards],
        ["loadStockSummary → products", n.products],
        ["loadStockSummary → stock_lots", n.stockLots],
        ["loadActiveCustomerCount → customers", n.customers],
        ["loadCogsForVelocityWeek → products", n.products],
        ["loadCogsForVelocityWeek → sales (week)", n.salesWeek],
        ["loadCogsForVelocityWeek → invoices (void scan)", n.invoices],
        ["loadYtdAverageWeeklySales → sales (YTD)", n.salesYtd],
        ["loadYtdAverageWeeklySales → invoices (void scan)", n.invoices],
      ],
    },
    {
      route: "/customers",
      note: "P2 + shared reference data: customers read once per SESSION, not per panel",
      reads: [
        ["CustomerKpiCards → invoices", n.invoices],
        ["CustomerEngagementPanel → invoices", n.invoices],
        ["customers (shared, first use only)", 0],
      ],
    },
    {
      route: "/customers (pre-P2)",
      note: "BASELINE — 4 panels CSS-hidden, so every listener attached",
      reads: [
        ["CustomerKpiCards → customers", n.customers],
        ["CustomerKpiCards → invoices", n.invoices],
        ["CustomerEngagementPanel → customers", n.customers],
        ["CustomerEngagementPanel → invoices", n.invoices],
        ["CustomerPurchaseReturnPanel → customers", n.customers],
        ["CustomerPurchaseReturnPanel → products", n.products],
        ["CustomerCrudPanel → customers", n.customers],
        ["CustomerCrudPanel → invoices", n.invoices],
        ["CustomerLedgerTable → customers", n.customers],
        ["CustomerLedgerTable → invoices", n.invoices],
      ],
    },
    {
      route: "  ↳ opening Ledger tab",
      note: "P2: cost is now paid per tab actually opened, once per visit",
      reads: [
        ["CustomerLedgerTable → customers", n.customers],
        ["CustomerLedgerTable → invoices", n.invoices],
      ],
    },
    {
      route: "/business-intelligence",
      note: "loadBusinessDataset — 10 full collections, each read once",
      reads: [
        ["products", n.products],
        ["sales", n.sales],
        ["expenses", n.expenses],
        ["invoices", n.invoices],
        ["stock_lots", n.stockLots],
        ["cash_entries", n.cashEntries],
        ["customers", n.customers],
        ["traders", n.traders],
        ["invoice_returns", n.invoiceReturns],
        ["inventory_discards", n.inventoryDiscards],
      ],
    },
    {
      route: "/sales",
      note: "InvoiceDraftList + ReturnList; customer names come from the shared store",
      reads: [
        ["InvoiceDraftList → invoices", n.invoices],
        ["InvoiceDraftList → invoice_returns", n.invoiceReturns],
        ["ReturnList → invoice_returns", n.invoiceReturns],
        ["customers (shared, first use only)", 0],
      ],
    },
    {
      route: "/sales/new",
      note: "Shared reference data: products + customers already loaded this session",
      reads: [
        ["AddInvoiceForm → customers (shared)", 0],
        ["AddInvoiceForm → products (shared)", 0],
        ["useLiveOffers → social_offers (active)", n.socialOffersActive],
      ],
    },
    {
      route: "/sales/new (pre-shared)",
      note: "BASELINE — every visit re-read both collections",
      reads: [
        ["AddInvoiceForm → customers", n.customers],
        ["AddInvoiceForm → products", n.products],
        ["useLiveOffers → social_offers (active)", n.socialOffersActive],
      ],
    },
    {
      route: "reference data (once per session)",
      note: "products + customers + traders, shared by every page that needs them",
      reads: [
        ["products", n.products],
        ["customers", n.customers],
        ["traders", n.traders],
      ],
    },
    {
      route: "/products",
      note: "traders shared; ProductList + ProductStockInSummary still read products separately",
      reads: [
        ["ProductList → products", n.products],
        ["ProductStockInSummary → products", n.products],
        ["ProductStockInSummary → stock_lots", n.stockLots],
        ["traders (shared, first use only)", 0],
      ],
    },
    {
      route: "/inventory",
      note: "P3: lines scoped to the 100 shown transactions (chunked `in`, 30 per query)",
      reads: [
        ["InventoryMovementLog → inventory_transactions (limit 100)", Math.min(100, n.inventoryTransactions)],
        ["InventoryMovementLog → lines for shown transactions", n.linesForShownTxns],
        ["stock summary → products", n.products],
        ["stock summary → stock_lots", n.stockLots],
      ],
    },
    {
      route: "/inventory (pre-P3)",
      note: "BASELINE — every line ever written, to render 100 rows",
      reads: [
        ["InventoryMovementLog → inventory_transactions (limit 100)", Math.min(100, n.inventoryTransactions)],
        ["InventoryMovementLog → inventory_transaction_lines (all)", n.inventoryTransactionLines],
        ["stock summary → products", n.products],
        ["stock summary → stock_lots", n.stockLots],
      ],
    },
  ];
}

function fmt(x) {
  return x.toLocaleString("en-US");
}

async function main() {
  const { alias, id: projectId } = resolveProjectId();
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "GOOGLE_APPLICATION_CREDENTIALS is not set.\n" +
        "Point it at a service-account JSON with Firestore read access:\n" +
        "  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/diagnostics/read-cost.mjs --project prod",
    );
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  const db = admin.firestore();
  const now = new Date();

  console.log(`\nProject: ${projectId}  (alias "${alias}")`);
  console.log(`Measured: ${now.toISOString()}\n`);

  const today = todayBounds(now);
  const week = velocityWeekBounds(now);
  const year = yearBounds(now);

  console.log("Counting collections (read-only aggregations)…");
  const n = {
    products: await safe("products", () => countAll(db, "products")),
    sales: await safe("sales", () => countAll(db, "sales")),
    expenses: await safe("expenses", () => countAll(db, "expenses")),
    invoices: await safe("invoices", () => countAll(db, "invoices")),
    invoiceItems: await safe("invoice_items", () => countAll(db, "invoice_items")),
    stockLots: await safe("stock_lots", () => countAll(db, "stock_lots")),
    cashEntries: await safe("cash_entries", () => countAll(db, "cash_entries")),
    customers: await safe("customers", () => countAll(db, "customers")),
    traders: await safe("traders", () => countAll(db, "traders")),
    parties: await safe("parties", () => countAll(db, "parties")),
    invoiceReturns: await safe("invoice_returns", () => countAll(db, "invoice_returns")),
    inventoryDiscards: await safe("inventory_discards", () => countAll(db, "inventory_discards")),
    inventoryTransactions: await safe("inventory_transactions", () =>
      countAll(db, "inventory_transactions"),
    ),
    inventoryTransactionLines: await safe("inventory_transaction_lines", () =>
      countAll(db, "inventory_transaction_lines"),
    ),
    lotConsumptions: await safe("lot_consumptions", () => countAll(db, "lot_consumptions")),
    socialOffers: await safe("social_offers", () => countAll(db, "social_offers")),
  };

  n.salesToday = await safe("sales today", () =>
    countRange(db, "sales", "date", today.start, today.end),
  );
  n.salesWeek = await safe("sales week", () =>
    countRange(db, "sales", "date", week.start, week.end),
  );
  n.salesYtd = await safe("sales ytd", () => countRange(db, "sales", "date", year.start, year.end));
  n.expensesToday = await safe("expenses today", () =>
    countRange(db, "expenses", "date", today.start, today.end),
  );
  n.voidInvoices = await safe("void invoices", () =>
    countWhere(db, "invoices", "status", "==", "void"),
  );
  n.socialOffersActive = await safe("active offers", () =>
    countWhere(db, "social_offers", "is_active", "==", true),
  );

  assertMeasured(n);

  // The movement log shows the newest 100 transactions and fetches only their
  // lines, so cost scales with the shown slice rather than the whole collection.
  n.linesForShownTxns =
    n.inventoryTransactions > 100
      ? Math.round((n.inventoryTransactionLines * 100) / n.inventoryTransactions)
      : n.inventoryTransactionLines;

  console.log("\n━━ Collection sizes ━━");
  const sizeRows = [
    ["products", n.products],
    ["sales", n.sales],
    ["expenses", n.expenses],
    ["invoices", n.invoices],
    ["invoice_items", n.invoiceItems],
    ["stock_lots", n.stockLots],
    ["lot_consumptions", n.lotConsumptions],
    ["cash_entries", n.cashEntries],
    ["customers", n.customers],
    ["traders", n.traders],
    ["parties", n.parties],
    ["invoice_returns", n.invoiceReturns],
    ["inventory_discards", n.inventoryDiscards],
    ["inventory_transactions", n.inventoryTransactions],
    ["inventory_transaction_lines", n.inventoryTransactionLines],
    ["social_offers", n.socialOffers],
  ].sort((a, b) => b[1] - a[1]);
  for (const [name, c] of sizeRows) {
    console.log(`  ${name.padEnd(30)} ${fmt(c).padStart(9)}`);
  }

  console.log("\n━━ Cost per page view ━━");
  const pages = buildPages(n);
  const totals = [];
  for (const page of pages) {
    const total = page.reads.reduce((s, [, c]) => s + c, 0);
    totals.push([page.route, total]);
    console.log(`\n  ${page.route}  →  ${fmt(total)} reads`);
    if (page.note) console.log(`  ${"".padEnd(2)}(${page.note})`);
    for (const [label, c] of page.reads) {
      console.log(`      ${label.padEnd(48)} ${fmt(c).padStart(8)}`);
    }
  }

  console.log("\n━━ Ranked ━━");
  for (const [route, total] of [...totals].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${route.padEnd(28)} ${fmt(total).padStart(9)} reads/view`);
  }

  const views = Number(arg("--views", "10"));
  const dash = totals.find(([r]) => r.startsWith("/ (dashboard home)"))?.[1] ?? 0;
  console.log(`\n━━ Daily projection ━━`);
  console.log(`  Spark free tier is 50,000 reads/day.`);
  console.log(
    `  ${views} dashboard views, all cold  →  ${fmt(dash * views)} reads (${Math.ceil(50000 / Math.max(dash, 1))} views to exhaust)`,
  );
  console.log(
    `  ...but the session cache means repeat visits and KPI-period switches cost 0,`,
  );
  console.log(
    `  so ${views} views is typically 2-3 fetches ≈ ${fmt(dash * 3)} reads. Cold cost is the ceiling,`,
  );
  console.log(`  not the expected figure.`);

  const after = totals.find(([r]) => r.startsWith("/ (dashboard home)"))?.[1] ?? 0;
  const before = totals.find(([r]) => r.startsWith("/ (dashboard, pre-P1)"))?.[1] ?? 0;
  if (before > 0 && after > 0) {
    const cut = Math.round(((before - after) / before) * 100);
    console.log(`\n━━ P1 effect ━━`);
    console.log(`  before: ${fmt(before)} reads/view    after: ${fmt(after)} reads/view    −${cut}%`);
    console.log(
      `  Saved ${fmt(before - after)} reads per view by fetching each collection once.`,
    );
  }

  console.log(`\n━━ Remaining waste ━━`);
  console.log(
    `  The dashboard still reads all ${fmt(n.sales)} sales and ${fmt(n.stockLots)} stock lots per view;`,
  );
  console.log(
    `  together that is ${fmt(n.sales + n.stockLots)} of the ${fmt(after)} remaining reads. Only rollup/aggregate`,
  );
  console.log(`  documents (P6) reduce those further — and sales grows daily.`);

  console.log(`\n(This script used ${queryCount} aggregation queries — negligible read cost.)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
