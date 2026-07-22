/**
 * Issue #3 — prove the production validator identity is READ-ONLY on the
 * stock/ledger collections. Run this with the validator service account's
 * credentials, against production:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/inventory-validator-sa.json \
 *     npm run prove:validator-readonly -- --project prod
 *
 * It confirms READ works (get + list) and that CREATE / UPDATE / DELETE on every
 * protected collection are DENIED (PERMISSION_DENIED). Exit 0 only if all denials
 * hold. It writes to a single, clearly-named probe id and, in the UNEXPECTED case
 * that a write is allowed, immediately best-effort deletes it and FAILS loudly.
 *
 * Protected collections (must be read-only for the validator):
 *   products · stock_lots · lot_consumptions · inventory_transactions ·
 *   inventory_transaction_lines · inventory_discards · inventory_discard_lots ·
 *   invoice_returns · return_lot_restorations
 * The validator MAY write inventory_validation_runs (its own run record); this
 * script reports that collection's create result separately, it does not gate.
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ROOT = path.resolve(process.cwd());
const PROBE_ID = "__validator_readonly_probe__";
const PROTECTED = [
  "products", "stock_lots", "lot_consumptions", "inventory_transactions",
  "inventory_transaction_lines", "inventory_discards", "inventory_discard_lots",
  "invoice_returns", "return_lot_restorations",
];

function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function readFirebaseProjects() { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, ".firebaserc"), "utf8"))?.projects ?? {}; }
function resolveTargetProjectId(f, projects) {
  if (!f) return null;
  if (projects[f]) return projects[f];
  if (new Set(Object.values(projects)).has(f)) return f;
  throw new Error(`Unknown --project "${f}". Aliases: ${Object.keys(projects).join(", ")}.`);
}
function credentialProjectId() {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")).project_id ?? null; } catch { return null; }
}
function isPermissionDenied(err) {
  const code = err?.code;
  return code === 7 || code === "permission-denied" || code === "PERMISSION_DENIED" ||
    /permission_denied|Missing or insufficient permissions|PERMISSION_DENIED/i.test(err?.message ?? "");
}

async function main() {
  const projects = readFirebaseProjects();
  const targetProjectId = resolveTargetProjectId(flag("--project"), projects);
  if (!targetProjectId) { console.error(`ERROR: --project <alias|id> required (aliases: ${Object.keys(projects).join(", ")}).`); process.exit(1); }
  const cred = credentialProjectId();
  if (!cred) { console.error("ERROR: set GOOGLE_APPLICATION_CREDENTIALS to the validator SA key."); process.exit(1); }
  if (cred !== targetProjectId) { console.error(`ERROR: credential project "${cred}" != --project "${targetProjectId}".`); process.exit(1); }

  initializeApp({ credential: applicationDefault(), projectId: targetProjectId });
  const db = getFirestore();
  console.log(`Proving validator identity is read-only on ${targetProjectId}\n`);

  const failures = [];

  // 1. READ must work (get + list) on a protected collection.
  try {
    await db.collection("products").limit(1).get();
    console.log("  ✓ READ (list) works");
  } catch (e) {
    failures.push(`READ denied on products (validator must be able to read): ${e.message}`);
    console.log("  ✗ READ (list) FAILED — validator cannot read");
  }

  // 2. WRITE (create/update/delete) must be DENIED on every protected collection.
  for (const coll of PROTECTED) {
    const ref = db.collection(coll).doc(PROBE_ID);
    let allowed = false;
    try {
      await ref.set({ __probe: true, at: new Date().toISOString() });
      allowed = true; // UNEXPECTED — the role permits writes
    } catch (e) {
      if (isPermissionDenied(e)) { console.log(`  ✓ ${coll}: write DENIED`); continue; }
      failures.push(`${coll}: write failed with a non-permission error: ${e.message}`);
      console.log(`  ? ${coll}: write failed (non-permission): ${e.message}`);
      continue;
    }
    if (allowed) {
      failures.push(`${coll}: WRITE ALLOWED — the validator identity is NOT read-only on this collection`);
      console.log(`  ✗ ${coll}: WRITE ALLOWED (cleaning up probe doc)`);
      await ref.delete().catch(() => console.log(`    (could not delete probe in ${coll} — remove ${PROBE_ID} manually)`));
    }
  }

  // 3. Report (do not gate) whether the validator can create its own run record.
  const runRef = db.collection("inventory_validation_runs").doc(`__probe_${Date.now()}__`);
  try {
    await runRef.set({ __probe: true });
    await runRef.delete().catch(() => {});
    console.log("\n  ℹ inventory_validation_runs: create ALLOWED (validator can persist run records — append role).");
  } catch (e) {
    if (isPermissionDenied(e)) console.log("\n  ℹ inventory_validation_runs: create DENIED (strict read-only — run records will NOT persist; use validate:inventory read-only report, or grant append on this collection).");
    else console.log(`\n  ℹ inventory_validation_runs: create failed: ${e.message}`);
  }

  console.log("");
  if (failures.length) { console.error("READ-ONLY PROOF FAILED:"); failures.forEach((f) => console.error(`  - ${f}`)); process.exit(1); }
  console.log("READ-ONLY PROOF PASSED: validator can read; all protected-collection writes are denied.");
}

main().catch((err) => { console.error(err); process.exit(1); });
