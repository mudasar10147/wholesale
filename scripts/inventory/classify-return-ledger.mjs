/**
 * READ-ONLY classification of posted returns whose inventory ledger is unfinished.
 *
 * These are the returns the validator reports as "posted return missing inventory
 * ledger" (R7). They do not all have the same cause, and one bucket cannot be
 * repaired at all by the pre-hardening code, which is why they never cleared:
 * a return whose lines were ALL discarded restocks nothing, produces no ledger
 * lines, and the old repair silently no-opped on it.
 *
 * Run this BEFORE repairing anything, so the expected outcome of each repair is
 * written down first and can be checked afterwards.
 *
 * STRICTLY READ-ONLY. Every Firestore call in this file is a `.get()`. It creates
 * no documents, updates none, and deletes none. Safe to run against production
 * with the read-only validator service account.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/prod-readonly-sa.json \
 *     npm run classify:return-ledger -- --project prod
 *
 *   # against the emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     npm run classify:return-ledger -- --project test
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const PROJECT_ROOT = path.resolve(process.cwd());
const FIREBASERC_PATH = path.join(PROJECT_ROOT, ".firebaserc");

function readFirebaseProjects() {
  return JSON.parse(fs.readFileSync(FIREBASERC_PATH, "utf8"))?.projects ?? {};
}

/** Same guard as validate.mjs: a live run must name its project explicitly. */
function resolveTargetProjectId(projectFlag, projects) {
  if (!projectFlag) return null;
  if (projects[projectFlag]) return projects[projectFlag];
  const knownIds = new Set(Object.values(projects));
  if (knownIds.has(projectFlag)) return projectFlag;
  throw new Error(
    `Unknown --project "${projectFlag}". Use an alias (${Object.keys(projects).join(", ")}) ` +
      `or a known id (${[...knownIds].join(", ")}).`,
  );
}

function credentialProjectId() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) return null;
  try {
    return JSON.parse(fs.readFileSync(credPath, "utf8")).project_id ?? null;
  } catch {
    return null;
  }
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Which bucket a return falls into, and what repairing it should do.
 * Evaluated in order: a non-posted or already-linked return never reaches the
 * restock question.
 */
function classify(ret, restockQty, discardQty, restorations) {
  if (ret.status !== "posted") {
    return {
      bucket: "D",
      expected: "Repair REFUSES — only posted returns can be repaired. Investigate why it was reported.",
    };
  }
  if (typeof ret.inventory_transaction_id === "string" && ret.inventory_transaction_id.trim()) {
    return {
      bucket: "C",
      expected:
        "Already linked to a ledger. Repair is a no-op. Investigate why the status was not 'posted'.",
    };
  }
  if (restockQty > 0) {
    const mismatch = restorations.quantity !== restockQty;
    return {
      bucket: "A",
      expected: mismatch
        ? `INVESTIGATE FIRST — restorations (${restorations.quantity}) do not match restock (${restockQty}). Do not repair until explained.`
        : `Creates ONE SALES_RETURN ledger row, direction in, quantity ${restockQty}; ledger_status -> posted.`,
    };
  }
  return {
    bucket: "B",
    expected:
      "Creates NO ledger row (nothing re-entered stock); ledger_status -> not_applicable. " +
      "Unrepairable on the pre-hardening code — this is why it never cleared.",
  };
}

async function main() {
  const flag = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const projects = readFirebaseProjects();
  const targetProjectId = resolveTargetProjectId(flag("--project"), projects);
  if (!targetProjectId) {
    throw new Error(
      "Refusing to run without --project. Pass an alias " +
        `(${Object.keys(projects).join(", ")}) so the wrong Firestore cannot be read by accident.`,
    );
  }
  const credProject = credentialProjectId();
  if (credProject && credProject !== targetProjectId) {
    throw new Error(
      `Credential project "${credProject}" does not match --project "${targetProjectId}". Refusing to run.`,
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: targetProjectId,
    });
  }
  const db = admin.firestore();
  console.log(`Classifying return ledger state in: ${targetProjectId} (READ-ONLY)\n`);

  // Candidates: exactly what R7 looks at — a posted return whose ledger is unfinished.
  const candidates = new Map();
  for (const status of ["pending", "failed"]) {
    const snap = await db.collection("invoice_returns").where("ledger_status", "==", status).get();
    snap.forEach((d) => candidates.set(d.id, d.data()));
  }

  const rows = [];
  for (const [returnId, ret] of candidates) {
    const itemIds = Array.isArray(ret.item_ids) ? ret.item_ids.filter(Boolean) : [];
    let restockQty = 0;
    let discardQty = 0;
    for (const itemId of itemIds) {
      const itemSnap = await db.collection("invoice_return_items").doc(itemId).get();
      if (!itemSnap.exists) continue;
      const item = itemSnap.data();
      restockQty += num(item.quantity_restock);
      discardQty += num(item.quantity_discard);
    }

    const restSnap = await db
      .collection("return_lot_restorations")
      .where("return_id", "==", returnId)
      .get();
    const restorations = {
      count: restSnap.size,
      quantity: restSnap.docs.reduce((sum, d) => sum + num(d.data().quantity), 0),
    };

    const { bucket, expected } = classify(ret, restockQty, discardQty, restorations);
    rows.push({
      return_id: returnId,
      original_invoice_id: ret.original_invoice_id ?? null,
      settlement_type: ret.settlement_type ?? null,
      total_amount: num(ret.total_amount),
      restock_quantity: restockQty,
      discard_quantity: discardQty,
      ledger_status: ret.ledger_status ?? null,
      inventory_transaction_id: ret.inventory_transaction_id ?? null,
      ledger_error: ret.ledger_error ?? null,
      restorations_count: restorations.count,
      restorations_quantity: restorations.quantity,
      bucket,
      expected_repair_outcome: expected,
    });
  }

  rows.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.return_id.localeCompare(b.return_id));

  const byBucket = rows.reduce((acc, r) => ({ ...acc, [r.bucket]: (acc[r.bucket] ?? 0) + 1 }), {});
  console.log(`Returns with unfinished ledger work: ${rows.length}`);
  console.log(`By bucket: ${JSON.stringify(byBucket)}\n`);

  for (const r of rows) {
    console.log(`── ${r.bucket} · ${r.return_id}`);
    console.log(`   original invoice : ${r.original_invoice_id}`);
    console.log(`   settlement       : ${r.settlement_type}`);
    console.log(`   return total     : ${r.total_amount}`);
    console.log(`   restock / discard: ${r.restock_quantity} / ${r.discard_quantity}`);
    console.log(`   ledger_status    : ${r.ledger_status}`);
    console.log(`   ledger txn id    : ${r.inventory_transaction_id ?? "(none)"}`);
    console.log(`   ledger_error     : ${r.ledger_error ?? "(none)"}`);
    console.log(`   restorations     : ${r.restorations_count} row(s), qty ${r.restorations_quantity}`);
    console.log(`   expected repair  : ${r.expected_repair_outcome}\n`);
  }

  const reportsDir = path.join(PROJECT_ROOT, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(reportsDir, `return-ledger-classification-${stamp}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ run_at: new Date().toISOString(), project_id: targetProjectId, total: rows.length, by_bucket: byBucket, rows }, null, 2),
  );
  console.log(`Wrote ${outPath}`);
  console.log("\nNothing was written to Firestore.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
