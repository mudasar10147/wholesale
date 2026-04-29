/**
 * Backfill missing opening lots for products where stock_quantity exceeds summed lot qty_remaining.
 *
 * Default mode is DRY RUN (no writes). Use --apply to persist changes.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/backfill-opening-lots.cjs
 *   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/backfill-opening-lots.cjs --apply
 *
 * Optional flags:
 *   --project <PROJECT_ID>   (defaults to .firebaserc "projects.default")
 *   --tag <STRING>           (defaults to backfill-opening-balance-YYYYMMDD)
 *   --limit <N>              (process first N products after sorting by id)
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const FIREBASERC_PATH = path.join(PROJECT_ROOT, ".firebaserc");

function parseArg(flagName) {
  const idx = process.argv.indexOf(flagName);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function parseArgs() {
  const apply = process.argv.includes("--apply");
  const tag = parseArg("--tag");
  const projectFromFlag = parseArg("--project");
  const limitRaw = parseArg("--limit");
  let limit = undefined;
  if (limitRaw !== undefined) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("--limit must be a positive integer.");
    }
    limit = parsed;
  }
  return { apply, tag, projectFromFlag, limit };
}

function readDefaultProjectId() {
  const raw = fs.readFileSync(FIREBASERC_PATH, "utf8");
  const json = JSON.parse(raw);
  return json?.projects?.default;
}

function todayTag() {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `backfill-opening-balance-${y}${m}${day}`;
}

function money(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

async function main() {
  const { apply, tag: customTag, projectFromFlag, limit } = parseArgs();
  const projectId = projectFromFlag || readDefaultProjectId();
  if (!projectId) {
    throw new Error("Could not determine Firebase project id. Set --project or .firebaserc projects.default.");
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath || !fs.existsSync(credPath)) {
    throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file path.");
  }

  const referenceTag = customTag || todayTag();
  const rawCred = fs.readFileSync(path.resolve(credPath), "utf8");
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(rawCred)),
    projectId,
  });

  const db = admin.firestore();

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Project: ${projectId}`);
  console.log(`Reference tag: ${referenceTag}`);
  if (limit) {
    console.log(`Product limit: ${limit}`);
  }

  const [productsSnap, lotsSnap] = await Promise.all([
    db.collection("products").get(),
    db.collection("stock_lots").get(),
  ]);

  const lotsByProduct = new Map();
  for (const lotDoc of lotsSnap.docs) {
    const data = lotDoc.data() || {};
    const productId = typeof data.product_id === "string" ? data.product_id : "";
    if (!productId) continue;
    if (!lotsByProduct.has(productId)) {
      lotsByProduct.set(productId, []);
    }
    lotsByProduct.get(productId).push({ id: lotDoc.id, data });
  }

  const productDocs = [...productsSnap.docs].sort((a, b) => a.id.localeCompare(b.id));
  const scopedProducts = limit ? productDocs.slice(0, limit) : productDocs;

  let scanned = 0;
  let aligned = 0;
  let malformed = 0;
  let anomalies = 0;
  let skippedIdempotent = 0;
  let candidateCount = 0;
  let totalUnitsToBackfill = 0;

  const plannedWrites = [];
  const anomalySamples = [];
  const candidateSamples = [];
  const malformedSamples = [];

  for (const productDoc of scopedProducts) {
    scanned += 1;
    const product = productDoc.data() || {};
    const stockQuantity = product.stock_quantity;
    const costPrice = product.cost_price;

    if (!Number.isInteger(stockQuantity) || stockQuantity < 0 || typeof costPrice !== "number" || !Number.isFinite(costPrice) || costPrice < 0) {
      malformed += 1;
      if (malformedSamples.length < 20) {
        malformedSamples.push({
          productId: productDoc.id,
          stock_quantity: stockQuantity,
          cost_price: costPrice,
        });
      }
      continue;
    }

    const lots = lotsByProduct.get(productDoc.id) || [];
    const sumQtyRemaining = lots.reduce((sum, lot) => {
      const qr = lot.data.qty_remaining;
      return sum + (Number.isInteger(qr) && qr >= 0 ? qr : 0);
    }, 0);

    const hasSameTagBackfill = lots.some((lot) => {
      return lot.data.source === "opening_balance" && lot.data.reference_id === referenceTag;
    });
    if (hasSameTagBackfill) {
      skippedIdempotent += 1;
      continue;
    }

    const gap = stockQuantity - sumQtyRemaining;
    if (gap === 0) {
      aligned += 1;
      continue;
    }
    if (gap < 0) {
      anomalies += 1;
      if (anomalySamples.length < 20) {
        anomalySamples.push({
          productId: productDoc.id,
          stockQuantity,
          sumQtyRemaining,
          gap,
        });
      }
      continue;
    }

    candidateCount += 1;
    totalUnitsToBackfill += gap;
    if (candidateSamples.length < 20) {
      candidateSamples.push({
        productId: productDoc.id,
        stockQuantity,
        sumQtyRemaining,
        gap,
        unit_cost: money(costPrice),
      });
    }

    plannedWrites.push({
      productId: productDoc.id,
      payload: {
        product_id: productDoc.id,
        unit_cost: money(costPrice),
        qty_in: gap,
        qty_remaining: gap,
        source: "opening_balance",
        reference_id: referenceTag,
        received_at: admin.firestore.FieldValue.serverTimestamp(),
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  }

  console.log("");
  console.log("Summary");
  console.log("-------");
  console.log(`Products scanned: ${scanned}`);
  console.log(`Aligned (gap=0): ${aligned}`);
  console.log(`Backfill candidates (gap>0): ${candidateCount}`);
  console.log(`Anomalies (gap<0): ${anomalies}`);
  console.log(`Malformed skipped: ${malformed}`);
  console.log(`Idempotent skips (tag exists): ${skippedIdempotent}`);
  console.log(`Total units to backfill: ${totalUnitsToBackfill}`);

  if (candidateSamples.length) {
    console.log("");
    console.log("Candidate samples (first 20):");
    console.table(candidateSamples);
  }
  if (anomalySamples.length) {
    console.log("");
    console.log("Anomaly samples (first 20):");
    console.table(anomalySamples);
  }
  if (malformedSamples.length) {
    console.log("");
    console.log("Malformed samples (first 20):");
    console.table(malformedSamples);
  }

  if (!apply) {
    console.log("");
    console.log("Dry run complete. Re-run with --apply to write opening_balance lots.");
    return;
  }

  if (plannedWrites.length === 0) {
    console.log("");
    console.log("Apply complete: no writes needed.");
    return;
  }

  const batches = chunk(plannedWrites, 400);
  let created = 0;
  for (const rows of batches) {
    const batch = db.batch();
    for (const row of rows) {
      const ref = db.collection("stock_lots").doc();
      batch.set(ref, row.payload);
      created += 1;
    }
    await batch.commit();
  }

  console.log("");
  console.log(`Apply complete: created ${created} opening_balance lot(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
