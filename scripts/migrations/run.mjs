/**
 * Migration runner for additive inventory schema changes.
 *
 *   node scripts/migrations/run.mjs 001 [--apply] [--rollback] [--backup-path PATH]
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
  const id = process.argv[2];
  if (!id) throw new Error("Usage: node scripts/migrations/run.mjs <001|002> [--apply] [--rollback]");
  return {
    id,
    apply: process.argv.includes("--apply"),
    rollback: process.argv.includes("--rollback"),
    backupPath: (() => {
      const i = process.argv.indexOf("--backup-path");
      return i >= 0 ? process.argv[i + 1] : undefined;
    })(),
  };
}

async function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: readDefaultProjectId(),
    });
  }
  return admin.firestore();
}

const migrations = {
  "001": {
    version: "001-create-default-warehouse",
    describe: () => "Create warehouses/default document if missing",
    async dryRun(db) {
      const ref = db.collection("warehouses").doc("default");
      const snap = await ref.get();
      return { wouldChange: snap.exists ? 0 : 1, details: snap.exists ? ["exists"] : ["create default"] };
    },
    async apply(db) {
      const ref = db.collection("warehouses").doc("default");
      const snap = await ref.get();
      if (snap.exists) return 0;
      const now = admin.firestore.FieldValue.serverTimestamp();
      await ref.set({
        code: "MAIN",
        name: "Main warehouse",
        is_active: true,
        is_default: true,
        created_at: now,
        updated_at: now,
      });
      return 1;
    },
    async rollback(db) {
      const ref = db.collection("warehouses").doc("default");
      const snap = await ref.get();
      if (!snap.exists) return 0;
      await ref.delete();
      return 1;
    },
  },
  "002": {
    version: "002-add-warehouse-id-to-lots",
    describe: () => "Add warehouse_id: default to stock_lots missing it",
    async dryRun(db) {
      const snap = await db.collection("stock_lots").get();
      let count = 0;
      snap.forEach((d) => {
        if (!d.data().warehouse_id) count += 1;
      });
      return { wouldChange: count, details: [`${count} lots missing warehouse_id`] };
    },
    async apply(db) {
      const snap = await db.collection("stock_lots").get();
      let count = 0;
      const batchSize = 400;
      let batch = db.batch();
      let ops = 0;
      for (const d of snap.docs) {
        if (d.data().warehouse_id) continue;
        batch.update(d.ref, { warehouse_id: "default" });
        count += 1;
        ops += 1;
        if (ops >= batchSize) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();
      return count;
    },
    async rollback(db) {
      const snap = await db.collection("stock_lots").get();
      let count = 0;
      let batch = db.batch();
      let ops = 0;
      for (const d of snap.docs) {
        if (d.data().warehouse_id !== "default") continue;
        batch.update(d.ref, { warehouse_id: admin.firestore.FieldValue.delete() });
        count += 1;
        ops += 1;
        if (ops >= 400) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();
      return count;
    },
  },
};

async function recordManifest(db, version, recordsAffected, backupPath) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection("schema_migrations").doc(version).set({
    version,
    applied_at: now,
    records_affected: recordsAffected,
    backup_path: backupPath ?? null,
    rollback_instructions: `node scripts/migrations/run.mjs ${version.split("-")[0]} --rollback`,
  });
}

async function main() {
  const { id, apply, rollback, backupPath } = parseArgs();
  const migration = migrations[id];
  if (!migration) throw new Error(`Unknown migration: ${id}`);

  const db = await getDb();
  console.log(migration.describe());

  if (rollback) {
    const affected = await migration.rollback(db);
    console.log(`Rollback complete. Records affected: ${affected}`);
    return;
  }

  const preview = await migration.dryRun(db);
  console.log("Dry run:", preview);

  if (!apply) {
    console.log("No changes written. Pass --apply to execute (after backup).");
    return;
  }

  const affected = await migration.apply(db);
  await recordManifest(db, migration.version, affected, backupPath);
  console.log(`Applied. Records affected: ${affected}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
