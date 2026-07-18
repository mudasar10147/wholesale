/**
 * Reconcile product book stock (`products.stock_quantity`) to the authoritative
 * lot stock (sum of `stock_lots.qty_remaining` for the product).
 *
 * Since inventory moved to a lot-based model, the lots are the source of truth:
 * this script rewrites each product's book stock to equal its lot sum, clearing
 * any drift that blocks stock-in / stock-out / invoice posting
 * ("Inventory invariant violated ... book stock X != lot sum Y").
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply.
 *
 * Usage:
 *   # dry-run every product (report only)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/wholesale-b4ff9-sa.json \
 *     node scripts/inventory/reconcile-book-stock.mjs
 *
 *   # actually write the fixes
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/wholesale-b4ff9-sa.json \
 *     node scripts/inventory/reconcile-book-stock.mjs --apply
 *
 *   # only one product
 *   ... node scripts/inventory/reconcile-book-stock.mjs --product nkutRnw5oOjMpx3IVroj --apply
 *
 *   # also zero-out products that have book stock but NO lots (off by default — see below)
 *   ... node scripts/inventory/reconcile-book-stock.mjs --apply --include-zero-lot
 *
 * NOTE ON --include-zero-lot: a product with book stock but zero lots would be set
 * to 0. That is destructive if the lot backfill simply missed the product, so these
 * are flagged and SKIPPED unless you explicitly opt in.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const PROJECT_ROOT = path.resolve(process.cwd());
const FIREBASERC_PATH = path.join(PROJECT_ROOT, ".firebaserc");

function readDefaultProjectId() {
  return JSON.parse(fs.readFileSync(FIREBASERC_PATH, "utf8"))?.projects?.default;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const productIdx = a.indexOf("--product");
  return {
    apply: a.includes("--apply"),
    includeZeroLot: a.includes("--include-zero-lot"),
    product: productIdx >= 0 ? a[productIdx + 1] : undefined,
  };
}

/**
 * Guard against the .env.local footgun: the app runs on wholesale-b4ff9 but the
 * default SA in .env.local is a *different* project (tardebridge). Writing book
 * stock with the wrong-project SA either fails or hits the wrong database.
 */
function assertCredentialMatchesProject(targetProjectId) {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS is not set. Point it at a wholesale-b4ff9 service-account JSON.",
    );
  }
  let credProject;
  try {
    credProject = JSON.parse(fs.readFileSync(credPath, "utf8"))?.project_id;
  } catch {
    throw new Error(`Could not read service-account file at ${credPath}`);
  }
  if (credProject !== targetProjectId) {
    throw new Error(
      `Service account project "${credProject}" does not match target "${targetProjectId}".\n` +
        `Use a ${targetProjectId} service account (the tardebridge SA in .env.local will NOT work).`,
    );
  }
}

function toInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

async function main() {
  const { apply, includeZeroLot, product: onlyProduct } = parseArgs();
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = emulator ? readDefaultProjectId() || "demo-test" : readDefaultProjectId();

  if (!admin.apps.length) {
    if (emulator) {
      // Emulator ignores credentials; skip the prod-only cred/project guard.
      admin.initializeApp({ projectId });
    } else {
      assertCredentialMatchesProject(projectId);
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId,
      });
    }
  }
  const db = admin.firestore();

  console.log(`Project: ${projectId}`);
  console.log(`Mode:    ${apply ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  if (onlyProduct) console.log(`Filter:  product == ${onlyProduct}`);
  console.log("");

  const [productsSnap, lotsSnap] = await Promise.all([
    db.collection("products").get(),
    db.collection("stock_lots").get(),
  ]);

  // Sum qty_remaining per product.
  const lotSumByProduct = new Map();
  const lotCountByProduct = new Map();
  const nonIntegerLots = [];
  for (const d of lotsSnap.docs) {
    const lot = d.data();
    const pid = lot.product_id;
    if (!pid) continue;
    const q = toInt(lot.qty_remaining);
    if (!Number.isInteger(q)) nonIntegerLots.push({ lot: d.id, product: pid, qty_remaining: lot.qty_remaining });
    lotSumByProduct.set(pid, (lotSumByProduct.get(pid) ?? 0) + q);
    lotCountByProduct.set(pid, (lotCountByProduct.get(pid) ?? 0) + 1);
  }

  const reconcilable = []; // has lots, book != lotSum -> set book = lotSum
  const zeroLot = []; // no lots but book != 0 -> flagged
  let okCount = 0;

  for (const d of productsSnap.docs) {
    if (onlyProduct && d.id !== onlyProduct) continue;
    const p = d.data();
    const book = toInt(p.stock_quantity);
    const lotSum = lotSumByProduct.get(d.id) ?? 0;
    const lotCount = lotCountByProduct.get(d.id) ?? 0;
    if (book === lotSum) {
      okCount += 1;
      continue;
    }
    const row = { id: d.id, name: p.name ?? "", book, lotSum, delta: lotSum - book, lotCount };
    if (lotCount === 0) zeroLot.push(row);
    else reconcilable.push(row);
  }

  reconcilable.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const fmt = (r) =>
    `  ${r.id}  book=${r.book}  lotSum=${r.lotSum}  delta=${r.delta > 0 ? "+" : ""}${r.delta}  (lots=${r.lotCount})  ${r.name}`;

  console.log(`Products in sync:            ${okCount}`);
  console.log(`Products to reconcile:       ${reconcilable.length}`);
  reconcilable.forEach((r) => console.log(fmt(r)));
  console.log("");
  console.log(`Zero-lot products w/ book:   ${zeroLot.length}  ${includeZeroLot ? "(will set to 0)" : "(SKIPPED — pass --include-zero-lot to fix)"}`);
  zeroLot.forEach((r) => console.log(fmt(r)));
  if (nonIntegerLots.length) {
    console.log(`\nWARNING: ${nonIntegerLots.length} lot(s) have non-integer qty_remaining:`);
    nonIntegerLots.forEach((l) => console.log(`  lot ${l.lot} (product ${l.product}) qty_remaining=${l.qty_remaining}`));
  }

  const targets = includeZeroLot ? [...reconcilable, ...zeroLot] : reconcilable;

  // Persist a report for audit.
  const reportsDir = path.join(PROJECT_ROOT, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(reportsDir, `book-stock-reconcile-${stamp}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ projectId, apply, onlyProduct: onlyProduct ?? null, reconcilable, zeroLot, nonIntegerLots }, null, 2),
  );
  console.log(`\nWrote ${outPath}`);

  if (!apply) {
    console.log(`\nDRY-RUN: would update ${targets.length} product(s). Re-run with --apply to write.`);
    return;
  }
  if (targets.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  let written = 0;
  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    for (const r of targets.slice(i, i + 400)) {
      batch.update(db.collection("products").doc(r.id), {
        stock_quantity: r.lotSum,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    written += Math.min(400, targets.length - i);
    console.log(`  committed ${written}/${targets.length}`);
  }
  console.log(`\nDONE. Set book stock = lot sum for ${written} product(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
