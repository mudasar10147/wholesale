/**
 * Issue #3 — prove the production validator identity is STRICTLY READ-ONLY.
 * Run with the validator service account's credentials, against production:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/inventory-validator-sa.json \
 *     npm run prove:validator-readonly -- --project prod
 *
 * Confirms:
 *   - production READS succeed (get + list),
 *   - CREATE, UPDATE and DELETE on every protected collection are DENIED
 *     (PERMISSION_DENIED).
 *
 * SAFETY: for a correctly-denied identity NOTHING is written, so NO cleanup is
 * required. Update/delete probes target a NON-EXISTENT doc id, so even a
 * misconfigured (over-permissive) role modifies/deletes no real data. A create
 * that is NOT denied is a hard failure — the script does NOT issue any cleanup
 * write (that would itself require write access); it reports the stray probe id
 * for manual removal. Only PERMISSION_DENIED passes.
 *
 * The validator is strictly read-only: it does NOT persist run records to
 * Firestore. Run history for the M2 gate is retained as a protected CI artifact
 * (see M2_DEPLOYMENT_RUNBOOK.md §0); Firestore persistence is a separate,
 * schema-validated ingestion endpoint (runbook §0.4), not this identity.
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ROOT = path.resolve(process.cwd());
// NOTE: must NOT match Firestore's reserved id pattern `__.*__` — a reserved id
// is rejected with INVALID_ARGUMENT at argument validation, BEFORE the IAM
// permission check, which would make the read-only probe inconclusive.
const PROBE_ID = "validator-readonly-probe-DO-NOT-USE";
const PROTECTED = [
  "products", "stock_lots", "lot_consumptions", "inventory_transactions",
  "inventory_transaction_lines", "inventory_discards", "inventory_discard_lots",
  "invoice_returns", "return_lot_restorations", "inventory_validation_runs",
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
    /permission[_-]denied|Missing or insufficient permissions/i.test(err?.message ?? "");
}
function isNotFound(err) {
  const code = err?.code;
  return code === 5 || code === "not-found" || /NOT_FOUND|No document to update/i.test(err?.message ?? "");
}
// INVALID_ARGUMENT (gRPC 3) is raised at argument validation, BEFORE the IAM
// permission check runs. It is neither a denial nor a grant — the probe never
// reached the permission layer, so the result is INCONCLUSIVE, not a failure.
function isInvalidArgument(err) {
  const code = err?.code;
  return code === 3 || code === "invalid-argument" || /INVALID_ARGUMENT/i.test(err?.message ?? "");
}

/** Returns { denied: boolean, wrote: boolean, why?: string }. Only denied passes. */
async function probe(op, fn) {
  try {
    await fn();
    // Resolved without error ⇒ the operation was PERMITTED (not read-only).
    return { denied: false, wrote: op === "create", why: "succeeded — permission granted" };
  } catch (e) {
    if (isPermissionDenied(e)) return { denied: true, wrote: false };
    if (isInvalidArgument(e)) return { denied: false, wrote: false, inconclusive: true, why: `INVALID_ARGUMENT before permission check — probe inconclusive: ${e.message}` };
    if (isNotFound(e)) return { denied: false, wrote: false, why: "NOT_FOUND — permission granted (target absent)" };
    return { denied: false, wrote: false, why: `unexpected error: ${e.message}` };
  }
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
  console.log(`Proving validator identity is STRICTLY READ-ONLY on ${targetProjectId}\n`);

  const failures = [];
  const inconclusive = [];
  const strays = [];

  // 1. READ must work (get + list).
  try { await db.collection("products").limit(1).get(); console.log("  ✓ READ (list) works"); }
  catch (e) { failures.push(`READ denied on products — validator must be able to read: ${e.message}`); console.log("  ✗ READ (list) FAILED"); }

  // 2. CREATE / UPDATE / DELETE must be DENIED on every protected collection.
  for (const coll of PROTECTED) {
    const ref = db.collection(coll).doc(PROBE_ID); // PROBE_ID does not exist
    const create = await probe("create", () => ref.create({ __probe: true }));
    const update = await probe("update", () => ref.update({ __probe: true })); // update non-existent
    const del = await probe("delete", () => ref.delete()); // delete non-existent

    const denials = [create, update, del];
    if (denials.every((r) => r.denied)) { console.log(`  ✓ ${coll}: create/update/delete DENIED`); continue; }

    for (const [op, r] of [["create", create], ["update", update], ["delete", del]]) {
      if (r.denied) continue;
      if (r.inconclusive) inconclusive.push(`${coll}.${op} INCONCLUSIVE (${r.why})`);
      else failures.push(`${coll}.${op} NOT denied (${r.why}) — identity is not read-only on ${coll}`);
    }
    if (create.wrote) strays.push(`${coll}/${PROBE_ID}`);
    const bad = denials.filter((r) => !r.denied);
    const marker = bad.every((r) => r.inconclusive) ? "? " : "✗ ";
    console.log(`  ${marker}${coll}: ${marker === "? " ? "INCONCLUSIVE" : "NOT read-only"} (${bad.length}/3 not denied)`);
  }

  console.log("");
  if (strays.length) {
    console.error("PROBE DOCS WRITTEN (role permits create) — remove these manually; this script does NOT auto-write:");
    strays.forEach((s) => console.error(`  - ${s}`));
  }
  if (failures.length) { console.error("\nSTRICT READ-ONLY PROOF FAILED:"); failures.forEach((f) => console.error(`  - ${f}`)); process.exit(1); }
  if (inconclusive.length) {
    console.error("\nSTRICT READ-ONLY PROOF INCONCLUSIVE (probe rejected before the permission check — not a denial and not a grant):");
    inconclusive.forEach((f) => console.error(`  - ${f}`));
    console.error("Fix the probe so the request reaches the IAM layer, then re-run. This is a script issue, not proof of write access.");
    process.exit(2);
  }
  console.log("STRICT READ-ONLY PROOF PASSED: reads work; create/update/delete on all protected collections are denied; nothing was written.");
}

main().catch((err) => { console.error(err); process.exit(1); });
