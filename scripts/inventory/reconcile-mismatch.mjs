/**
 * M0.5 baseline reconciliation runner — TEMPORARY, deleted in M6.
 * (PHASE1_INTEGRITY_ARCHITECTURE_V2.md §19.0.5-M.8, docs/inventory/BASELINE_REMEDIATION.md.)
 *
 * Runs under the Admin SDK (`inventory-repair` identity). NEVER exposed in the UI.
 *
 * Guardrails enforced here:
 *   - Dry-run is the default. --apply is required to write, and only with an allowlist.
 *   - An explicit product allowlist FILE is mandatory (max 10 products per run).
 *   - --project is mandatory for live runs and must match the credential's project.
 *   - --apply requires a named, verified backup, recorded in the run log.
 *   - `administrative` authority requires an approver.
 *   - After apply, every touched product is re-derived and must be clean (scoped
 *     post-validation); the operator is told to run the full validator too.
 *
 * Usage:
 *   # dry-run (safe; prints the plan for each product)
 *   node --import ./scripts/support/registerTsAlias.mjs scripts/inventory/reconcile-mismatch.mjs \
 *     --project prod --run-id <baselineRunId> --acted-by <uid> --allowlist repairs.json
 *   # apply (writes)
 *   ... --apply --backup gs://backups/2026-07-21-preremediation
 *
 * Allowlist file: JSON array, max 10 entries:
 *   [ { "productId": "abc", "authorityCategory": "consumption_history",
 *       "reasonDetail": "…", "physicalCount": 98, "approvedByUid": "…" } ]
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { reconcileProduct } from "@/lib/inventory/reconcileMismatch";

const MAX_PRODUCTS_PER_RUN = 10;
const PROJECT_ROOT = path.resolve(process.cwd());
const AUTHORITIES = new Set([
  "physical_count",
  "purchase_receipt",
  "invoice_history",
  "consumption_history",
  "return_history",
  "discard_history",
  "administrative",
]);

function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name) {
  return process.argv.includes(name);
}

function readFirebaseProjects() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, ".firebaserc"), "utf8"))?.projects ?? {};
}
function resolveTargetProjectId(projectFlag, projects) {
  if (!projectFlag) return null;
  if (projects[projectFlag]) return projects[projectFlag];
  if (new Set(Object.values(projects)).has(projectFlag)) return projectFlag;
  throw new Error(
    `Unknown --project "${projectFlag}". Aliases: ${Object.keys(projects).join(", ")}; ids: ${[...new Set(Object.values(projects))].join(", ")}.`,
  );
}
function credentialProjectId() {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")).project_id ?? null;
  } catch {
    return null;
  }
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function loadAllowlist(file) {
  if (!file) fail("--allowlist <file> is required (the explicit set of products to reconcile).");
  const abs = path.isAbsolute(file) ? file : path.join(PROJECT_ROOT, file);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    fail(`could not read allowlist ${abs}: ${e.message}`);
  }
  if (!Array.isArray(parsed)) fail("allowlist must be a JSON array.");
  if (parsed.length === 0) fail("allowlist is empty.");
  if (parsed.length > MAX_PRODUCTS_PER_RUN) {
    fail(`allowlist has ${parsed.length} products; the per-run maximum is ${MAX_PRODUCTS_PER_RUN}.`);
  }
  parsed.forEach((entry, i) => {
    if (!entry || typeof entry.productId !== "string" || !entry.productId) {
      fail(`allowlist[${i}] needs a productId.`);
    }
    if (!AUTHORITIES.has(entry.authorityCategory)) {
      fail(`allowlist[${i}] (${entry.productId}) needs a valid authorityCategory (one of: ${[...AUTHORITIES].join(", ")}).`);
    }
    if (typeof entry.reasonDetail !== "string" || !entry.reasonDetail.trim()) {
      fail(`allowlist[${i}] (${entry.productId}) needs a reasonDetail.`);
    }
    if (entry.physicalCount != null && (!Number.isInteger(entry.physicalCount) || entry.physicalCount < 0)) {
      fail(`allowlist[${i}] (${entry.productId}) physicalCount must be a non-negative integer.`);
    }
  });
  return parsed;
}

function summarizePlan(plan) {
  if (!plan) return "(no plan)";
  const corr = plan.lotCorrections.filter((c) => c.delta !== 0).map((c) => `${c.lot_id}:${c.delta > 0 ? "+" : ""}${c.delta}`);
  return [
    `book ${plan.bookBefore}->${plan.finalQuantity}`,
    `lHist ${plan.lHist}`,
    `bookRecon ${plan.bookReconciliation}`,
    `physicalDelta ${plan.physicalDelta}`,
    corr.length ? `lots[${corr.join(",")}]` : "lots[none]",
  ].join("  ");
}

async function main() {
  const apply = has("--apply");
  const runId = flag("--run-id");
  const actedBy = flag("--acted-by");
  const approvedByGlobal = flag("--approved-by");
  const backup = flag("--backup");
  const projectFlag = flag("--project");

  if (!runId) fail("--run-id <baselineValidationRunId> is required (attribution).");
  if (!actedBy) fail("--acted-by <uid> is required.");

  const projects = readFirebaseProjects();
  const targetProjectId = resolveTargetProjectId(projectFlag, projects);
  if (!targetProjectId) {
    fail(`--project <alias|id> is required (aliases: ${Object.keys(projects).join(", ")}).`);
  }
  const credProject = credentialProjectId();
  if (credProject && credProject !== targetProjectId) {
    fail(`credential project "${credProject}" != --project target "${targetProjectId}". Refusing to run.`);
  }

  const allowlist = loadAllowlist(flag("--allowlist"));

  if (apply) {
    if (!backup) fail("--apply requires --backup <name> (a verified export, recorded in this run log).");
    const needsApprover = allowlist.filter(
      (e) => e.authorityCategory === "administrative" && !e.approvedByUid && !approvedByGlobal,
    );
    if (needsApprover.length) {
      fail(`administrative authority requires an approver for: ${needsApprover.map((e) => e.productId).join(", ")} (set approvedByUid per entry or pass --approved-by).`);
    }
  }

  console.log("── M0.5 reconciliation run ──");
  console.log(`  project:   ${targetProjectId}`);
  console.log(`  mode:      ${apply ? "APPLY (writes)" : "DRY-RUN (no writes)"}`);
  console.log(`  run-id:    ${runId}`);
  console.log(`  acted-by:  ${actedBy}`);
  console.log(`  backup:    ${apply ? backup : "(n/a in dry-run)"}`);
  console.log(`  products:  ${allowlist.length} (max ${MAX_PRODUCTS_PER_RUN})`);
  console.log("");

  initializeApp({ credential: applicationDefault(), projectId: targetProjectId });
  const db = getFirestore();

  const results = [];
  for (const entry of allowlist) {
    const res = await reconcileProduct(db, {
      productId: entry.productId,
      physicalCount: entry.physicalCount ?? null,
      authorityCategory: entry.authorityCategory,
      reasonDetail: entry.reasonDetail,
      validationRunId: runId,
      actedByUid: actedBy,
      approvedByUid: entry.approvedByUid ?? approvedByGlobal,
      dryRun: !apply,
    });
    results.push(res);
    const flagMark = res.status === "refused" ? "✗" : res.status === "applied" ? "✓" : "•";
    console.log(`  ${flagMark} ${entry.productId}  [${res.status}]  ${summarizePlan(res.plan)}`);
    if (res.refusalReasons?.length) {
      for (const r of res.refusalReasons) console.log(`      refused: ${r}`);
    }
  }

  const refused = results.filter((r) => r.status === "refused");

  // Scoped post-validation after an apply: every touched product must now derive
  // clean (a dry-run re-derivation returns noop/already_repaired), or the batch halts.
  if (apply) {
    console.log("\n── scoped post-validation ──");
    let dirty = 0;
    for (const res of results) {
      if (res.status !== "applied") continue;
      const recheck = await reconcileProduct(db, {
        productId: res.productId,
        authorityCategory: "consumption_history",
        reasonDetail: "post-validation recheck",
        validationRunId: runId,
        actedByUid: actedBy,
        dryRun: true,
      });
      const clean = recheck.status === "already_repaired" || recheck.status === "noop";
      console.log(`  ${clean ? "✓" : "✗"} ${res.productId}  [${recheck.status}]`);
      if (!clean) dirty += 1;
    }
    if (dirty > 0) {
      fail(`${dirty} product(s) did not validate clean after apply — HALT the milestone and investigate.`);
    }
    console.log(`\nRun the FULL validator before continuing:\n  npm run validate:inventory -- --project ${projectFlag}`);
  }

  console.log("");
  if (refused.length) {
    console.log(`${refused.length} product(s) refused (see above). Nothing was written for them.`);
    process.exitCode = 1;
  } else {
    console.log(apply ? "Apply complete." : "Dry-run complete. Re-run with --apply --backup <name> to write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
