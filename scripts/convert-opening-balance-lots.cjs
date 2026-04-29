/**
 * Review and (optionally) convert opening_balance lots to stock_in.
 *
 * Default mode: read-only (prints rows only).
 * Apply mode: use --apply to convert all opening_balance lots found.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/convert-opening-balance-lots.cjs
 *   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/convert-opening-balance-lots.cjs --apply
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const FIREBASERC_PATH = path.join(PROJECT_ROOT, ".firebaserc");

function readDefaultProjectId() {
  const raw = fs.readFileSync(FIREBASERC_PATH, "utf8");
  const json = JSON.parse(raw);
  return json?.projects?.default;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function formatMoney(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath || !fs.existsSync(credPath)) {
    throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file path.");
  }

  const projectId = readDefaultProjectId();
  if (!projectId) {
    throw new Error("Could not resolve project id from .firebaserc");
  }

  const rawCred = fs.readFileSync(path.resolve(credPath), "utf8");
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(rawCred)),
    projectId,
  });

  const db = admin.firestore();
  const [productsSnap, lotsSnap] = await Promise.all([
    db.collection("products").get(),
    db.collection("stock_lots").get(),
  ]);

  const products = new Map();
  for (const p of productsSnap.docs) {
    products.set(p.id, p.data() || {});
  }

  const openingLots = [];
  for (const lotDoc of lotsSnap.docs) {
    const lot = lotDoc.data() || {};
    if (lot.source !== "opening_balance") continue;
    openingLots.push({
      lotId: lotDoc.id,
      productId: typeof lot.product_id === "string" ? lot.product_id : "",
      unitCost: typeof lot.unit_cost === "number" && Number.isFinite(lot.unit_cost) ? lot.unit_cost : 0,
      qtyRemaining: Number.isInteger(lot.qty_remaining) ? lot.qty_remaining : 0,
    });
  }

  const rows = openingLots
    .map((lot) => {
      const p = products.get(lot.productId) || {};
      const name = typeof p.name === "string" && p.name.trim() ? p.name : lot.productId;
      const stock = Number.isInteger(p.stock_quantity) ? p.stock_quantity : 0;
      return {
        name,
        stock,
        purchasePrice: formatMoney(lot.unitCost),
        quantityLeft: lot.qtyRemaining,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (rows.length === 0) {
    console.log("No opening_balance lots found.");
    return;
  }

  console.table(rows);

  if (!apply) {
    console.log(`Found ${openingLots.length} opening_balance lot(s). Re-run with --apply to convert all to stock_in.`);
    return;
  }

  const batches = chunk(openingLots, 400);
  let updated = 0;
  for (const group of batches) {
    const batch = db.batch();
    for (const lot of group) {
      const ref = db.collection("stock_lots").doc(lot.lotId);
      batch.update(ref, {
        source: "stock_in",
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      updated += 1;
    }
    await batch.commit();
  }

  console.log(`Apply complete: converted ${updated} lot(s) from opening_balance to stock_in.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
