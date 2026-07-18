/**
 * Read-only inventory validation against live Firestore.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npm run validate:inventory
 *   npm run validate:inventory -- --fixture test/fixtures/inventory-baseline/baseline.json
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const PROJECT_ROOT = path.resolve(process.cwd());
const FIREBASERC_PATH = path.join(PROJECT_ROOT, ".firebaserc");

function readDefaultProjectId() {
  const raw = fs.readFileSync(FIREBASERC_PATH, "utf8");
  return JSON.parse(raw)?.projects?.default;
}

function parseArgs() {
  const fixtureIdx = process.argv.indexOf("--fixture");
  const fixture =
    fixtureIdx >= 0 ? process.argv[fixtureIdx + 1] : undefined;
  return { fixture };
}

async function loadFromFirestore(db) {
  const [
    productsSnap,
    lotsSnap,
    consumptionsSnap,
    invoicesSnap,
    cogsSnap,
    txSnap,
    txLinesSnap,
    returnsSnap,
    discardsSnap,
  ] = await Promise.all([
    db.collection("products").get(),
    db.collection("stock_lots").get(),
    db.collection("lot_consumptions").get(),
    db.collection("invoices").get(),
    db.collection("invoice_item_cogs").get(),
    db.collection("inventory_transactions").get(),
    db.collection("inventory_transaction_lines").get(),
    db.collection("invoice_returns").get(),
    db.collection("inventory_discards").get(),
  ]);

  const mapDocs = (snap) =>
    snap.docs.map((d) => ({ id: d.id, data: d.data() }));

  return {
    products: mapDocs(productsSnap),
    lots: mapDocs(lotsSnap),
    consumptions: mapDocs(consumptionsSnap),
    invoices: mapDocs(invoicesSnap),
    itemCogs: mapDocs(cogsSnap),
    inventoryTransactions: mapDocs(txSnap),
    inventoryTransactionLines: mapDocs(txLinesSnap),
    invoiceReturns: mapDocs(returnsSnap),
    inventoryDiscards: mapDocs(discardsSnap),
  };
}

function loadFixture(fixturePath) {
  const abs = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.join(PROJECT_ROOT, fixturePath);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

async function main() {
  const { fixture } = parseArgs();

  const { validateInventoryData, formatValidationSummary } = await import(
    "../../lib/inventory/validateInventory.ts"
  );

  let input;
  let environment;

  if (fixture) {
    input = loadFixture(fixture);
    environment = "fixture";
  } else {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: readDefaultProjectId(),
      });
    }
    const db = admin.firestore();
    input = await loadFromFirestore(db);
    environment = "production";
  }

  const report = validateInventoryData(input, environment);
  const reportsDir = path.join(PROJECT_ROOT, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(reportsDir, `inventory-validation-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(formatValidationSummary(report));
  console.log(`\nWrote ${outPath}`);

  if (report.summary.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
