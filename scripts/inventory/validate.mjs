/**
 * Read-only inventory validation against live Firestore.
 *
 * A live run REQUIRES an explicit --project so it can never validate the wrong
 * Firestore by accident. Pass a .firebaserc alias (default, test, prod) or a raw
 * project id. If GOOGLE_APPLICATION_CREDENTIALS is set, the service account's
 * own project must match the target, or the run is refused.
 *
 * Usage:
 *   # test project
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/test-sa.json \
 *     npm run validate:inventory -- --project test
 *   # production baseline
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/prod-sa.json \
 *     npm run validate:inventory -- --project prod
 *   # offline fixture (no --project needed)
 *   npm run validate:inventory -- --fixture test/fixtures/inventory-baseline/baseline.json
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const PROJECT_ROOT = path.resolve(process.cwd());
const FIREBASERC_PATH = path.join(PROJECT_ROOT, ".firebaserc");

function readFirebaseProjects() {
  const raw = fs.readFileSync(FIREBASERC_PATH, "utf8");
  return JSON.parse(raw)?.projects ?? {};
}

function parseArgs() {
  const flag = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  return { fixture: flag("--fixture"), project: flag("--project") };
}

/**
 * Resolve the --project flag to a concrete Firestore project id.
 * Accepts a .firebaserc alias (default/test/prod) or a raw id that matches a
 * known project. Rejects anything else so a typo cannot silently pick a project.
 */
function resolveTargetProjectId(projectFlag, projects) {
  if (!projectFlag) return null;
  if (projects[projectFlag]) return projects[projectFlag];
  const knownIds = new Set(Object.values(projects));
  if (knownIds.has(projectFlag)) return projectFlag;
  const aliases = Object.keys(projects).join(", ") || "(none)";
  const ids = [...knownIds].join(", ") || "(none)";
  throw new Error(
    `Unknown --project "${projectFlag}". Use an alias (${aliases}) or a known id (${ids}).`,
  );
}

/** project_id from the service-account file, if GOOGLE_APPLICATION_CREDENTIALS points at one. */
function credentialProjectId() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) return null;
  try {
    return JSON.parse(fs.readFileSync(credPath, "utf8")).project_id ?? null;
  } catch {
    return null;
  }
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
  const { fixture, project } = parseArgs();

  const { validateInventoryData, formatValidationSummary } = await import(
    "../../lib/inventory/validateInventory.ts"
  );

  let input;
  let environment;

  if (fixture) {
    input = loadFixture(fixture);
    environment = "fixture";
  } else {
    const projects = readFirebaseProjects();
    const targetProjectId = resolveTargetProjectId(project, projects);
    if (!targetProjectId) {
      const aliases = Object.keys(projects).join(", ") || "(none)";
      throw new Error(
        "Refusing to run against live Firestore without --project. " +
          `Pass --project <alias|id> (aliases: ${aliases}). ` +
          "This guard prevents accidentally validating the wrong project. " +
          "For an offline run use --fixture instead.",
      );
    }
    const credProject = credentialProjectId();
    if (credProject && credProject !== targetProjectId) {
      throw new Error(
        `Credential project "${credProject}" (from GOOGLE_APPLICATION_CREDENTIALS) ` +
          `does not match --project target "${targetProjectId}". ` +
          "Refusing to run to avoid cross-project reads.",
      );
    }
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: targetProjectId,
      });
    }
    console.log(`Validating live Firestore project: ${targetProjectId}`);
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
