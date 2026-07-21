/**
 * Run inventory validation and PERSIST the run record to inventory_validation_runs
 * (§8.3, §9). Read-only over inventory; writes only its own run record + watermark.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     npm run validate:run -- --project prod --mode full
 *   ... --mode incremental      (falls back to full on a stale/missing watermark)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runValidation } from "@/lib/inventory/validationRun";

const PROJECT_ROOT = path.resolve(process.cwd());

function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function readFirebaseProjects() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, ".firebaserc"), "utf8"))?.projects ?? {};
}
function resolveTargetProjectId(projectFlag, projects) {
  if (!projectFlag) return null;
  if (projects[projectFlag]) return projects[projectFlag];
  if (new Set(Object.values(projects)).has(projectFlag)) return projectFlag;
  throw new Error(`Unknown --project "${projectFlag}". Aliases: ${Object.keys(projects).join(", ")}.`);
}
function credentialProjectId() {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")).project_id ?? null; } catch { return null; }
}

async function main() {
  const mode = flag("--mode") === "incremental" ? "incremental" : "full";
  const projects = readFirebaseProjects();
  const targetProjectId = resolveTargetProjectId(flag("--project"), projects);
  if (!targetProjectId) {
    console.error(`ERROR: --project <alias|id> is required (aliases: ${Object.keys(projects).join(", ")}).`);
    process.exit(1);
  }
  const credProject = credentialProjectId();
  if (credProject && credProject !== targetProjectId) {
    console.error(`ERROR: credential project "${credProject}" != --project target "${targetProjectId}".`);
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId: targetProjectId });
  const db = getFirestore();

  const { record, fellBackToFull } = await runValidation(db, { mode, projectId: targetProjectId });

  console.log(`Validation run ${record.run_id}`);
  console.log(`  project:  ${targetProjectId}`);
  console.log(`  mode:     ${record.mode}${fellBackToFull ? " (fell back from incremental)" : ""}`);
  console.log(`  verdict:  ${record.verdict}`);
  console.log(`  counts:   ${JSON.stringify(record.counts)}`);
  console.log(`  summary:  critical ${record.summary.critical}, error ${record.summary.error}, warning ${record.summary.warning}`);
  if (record.scope) console.log(`  scope:    ${record.scope.product_ids.length} products discovered`);
  console.log(`  complete: ${record.complete} (watermark ${record.complete ? "advances" : "does NOT advance"})`);
  console.log(`  persisted ${record.issues.length}${record.truncated ? ` of ${record.issues_total} (truncated)` : ""} issue metadata rows.`);

  if (record.summary.critical + record.summary.error > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
