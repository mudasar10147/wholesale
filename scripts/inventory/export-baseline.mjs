/**
 * Export anonymized inventory baseline for CI parity tests.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npm run inventory:export-baseline
 *   npm run inventory:export-baseline -- --out test/fixtures/inventory-baseline/baseline.json
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const PROJECT_ROOT = path.resolve(process.cwd());
const FIREBASERC_PATH = path.join(PROJECT_ROOT, ".firebaserc");
const DEFAULT_OUT = path.join(
  PROJECT_ROOT,
  "test/fixtures/inventory-baseline/baseline.json",
);

function readDefaultProjectId() {
  const raw = fs.readFileSync(FIREBASERC_PATH, "utf8");
  return JSON.parse(raw)?.projects?.default;
}

function parseArgs() {
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx >= 0 ? process.argv[outIdx + 1] : DEFAULT_OUT;
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : undefined;
  return { out, limit };
}

async function loadCollections(db) {
  const [productsSnap, lotsSnap, consumptionsSnap, invoicesSnap, cogsSnap] =
    await Promise.all([
      db.collection("products").get(),
      db.collection("stock_lots").get(),
      db.collection("lot_consumptions").get(),
      db.collection("invoices").get(),
      db.collection("invoice_item_cogs").get(),
    ]);

  const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, data: d.data() }));

  return {
    products: mapDocs(productsSnap),
    lots: mapDocs(lotsSnap),
    consumptions: mapDocs(consumptionsSnap),
    invoices: mapDocs(invoicesSnap),
    itemCogs: mapDocs(cogsSnap),
    inventoryTransactions: [],
    inventoryTransactionLines: [],
  };
}

function anonymize(input, limit) {
  const products = limit ? input.products.slice(0, limit) : input.products;
  const productIds = new Set(products.map((p) => p.id));

  const lots = input.lots.filter((l) => productIds.has(l.data.product_id));
  const lotIds = new Set(lots.map((l) => l.id));

  const consumptions = input.consumptions.filter(
    (c) => productIds.has(c.data.product_id) && lotIds.has(c.data.lot_id),
  );
  const invoiceIds = new Set(consumptions.map((c) => c.data.invoice_id).filter(Boolean));

  const invoices = input.invoices.filter((i) => invoiceIds.has(i.id));
  const invoiceItemIds = new Set(
    consumptions.map((c) => c.data.invoice_item_id).filter(Boolean),
  );
  const itemCogs = input.itemCogs.filter((c) => invoiceItemIds.has(c.data.invoice_item_id));

  return {
    products: products.map((p) => ({
      ...p,
      data: { ...p.data, name: p.data.name ? `Product-${p.id.slice(0, 6)}` : p.data.name },
    })),
    lots,
    consumptions,
    invoices,
    itemCogs,
    inventoryTransactions: [],
    inventoryTransactionLines: [],
  };
}

async function main() {
  const { out, limit } = parseArgs();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: readDefaultProjectId(),
    });
  }

  const db = admin.firestore();
  const raw = await loadCollections(db);
  const baseline = anonymize(raw, limit);

  const absOut = path.isAbsolute(out) ? out : path.join(PROJECT_ROOT, out);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, JSON.stringify(baseline, null, 2));

  console.log(
    `Exported baseline: ${baseline.products.length} products, ${baseline.lots.length} lots, ${baseline.consumptions.length} consumptions`,
  );
  console.log(`Wrote ${absOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
