/**
 * Backfill: re-encode product photos already sitting in GCS.
 *
 * New uploads are normalised at write time (see lib/upload/imageProcessing.ts), but every
 * photo uploaded before that still lives in the bucket at its original size — commonly a
 * 7 MB, 4000px phone JPEG. Those cost real time and money on every cache miss and on the
 * optimiser's first encode of each rendered width.
 *
 * This walks the `products` collection, rewrites each stored image to the same bounded
 * WebP the upload path now produces, and repoints the Firestore document at the new
 * object. Originals are left in place unless you pass --delete-originals.
 *
 * Prereqs in .env.local (or exported):
 *   GCS_PROJECT_ID, GCS_BUCKET_NAME
 *   and one of GCS_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS
 *
 * Usage:
 *   npm run images:backfill                              # dry run, reports what it would do
 *   npm run images:backfill -- --apply                   # rewrite and repoint
 *   npm run images:backfill -- --apply --delete-originals
 *   npm run images:backfill -- --apply --limit=25        # work through it in batches
 *   npm run images:backfill -- --delete-orphans          # report bucket objects nothing references
 *   npm run images:backfill -- --apply --delete-orphans  # ...and remove them
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "@google-cloud/storage";
import { cert, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { processProductImage } from "../../lib/upload/imageProcessing.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DELETE_ORIGINALS = args.includes("--delete-originals");
const DELETE_ORPHANS = args.includes("--delete-orphans");
/** Orphans younger than this are ignored — they may be an upload still being written. */
const ORPHAN_MIN_AGE_HOURS = 24;
const CONCURRENCY = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 4);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);

function loadEnvLocal() {
  const envPath = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8").replace(/^﻿/, "");
  for (const line of raw.split("\n")) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    trimmed = trimmed.replace(/^export\s+/i, "");
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function parseServiceAccountJson(raw) {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Run `worker` over `items`, at most `limit` in flight. Keeps memory flat on big buckets. */
async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

loadEnvLocal();

const projectId = process.env.GCS_PROJECT_ID?.trim();
const bucketName = process.env.GCS_BUCKET_NAME?.trim();
if (!projectId) fail("Missing GCS_PROJECT_ID.");
if (!bucketName) fail("Missing GCS_BUCKET_NAME.");

const gcsCredentials = parseServiceAccountJson(process.env.GCS_SERVICE_ACCOUNT_JSON);
if (!gcsCredentials && !process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
  fail("Set GCS_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.");
}

const storage = gcsCredentials
  ? new Storage({
      projectId: gcsCredentials.project_id || projectId,
      credentials: { client_email: gcsCredentials.client_email, private_key: gcsCredentials.private_key },
    })
  : new Storage({ projectId });
const bucket = storage.bucket(bucketName);

// Firestore and the bucket routinely live in different GCP projects here, so the
// Firebase project id must never fall back to GCS_PROJECT_ID — that would silently
// point the backfill at the wrong database.
const firebaseProjectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
const adminCredentials =
  parseServiceAccountJson(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) ?? gcsCredentials;
const resolvedFirebaseProject = adminCredentials?.project_id?.trim() || firebaseProjectId;
if (!resolvedFirebaseProject) {
  fail("Cannot determine the Firebase project. Set FIREBASE_ADMIN_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
}
if (getApps().length === 0) {
  initializeApp({
    credential: adminCredentials
      ? cert({
          projectId: resolvedFirebaseProject,
          clientEmail: adminCredentials.client_email,
          privateKey: adminCredentials.private_key,
        })
      : applicationDefault(),
    projectId: resolvedFirebaseProject,
  });
}
const db = getFirestore();

/** Rows written before `image_path` existed still carry a bucket URL we can recover a path from. */
function derivePathFromUrl(imageUrl) {
  if (!imageUrl) return null;
  const patterns = [
    new RegExp(`^https://storage\\.googleapis\\.com/${bucketName}/(.+?)(?:\\?|$)`),
    new RegExp(`^https://${bucketName}\\.storage\\.googleapis\\.com/(.+?)(?:\\?|$)`),
  ];
  for (const pattern of patterns) {
    const match = imageUrl.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

const RESTORE = args.find((a) => a.startsWith("--restore="))?.split("=").slice(1).join("=");

if (RESTORE) {
  const parsed = JSON.parse(fs.readFileSync(RESTORE, "utf8"));
  if (parsed.project !== resolvedFirebaseProject) {
    fail(`Backup is for project "${parsed.project}" but this run resolved "${resolvedFirebaseProject}".`);
  }
  console.log(`\nRestoring ${parsed.products.length} products in ${parsed.project} from ${RESTORE}`);
  if (!APPLY) {
    console.log("Dry run — add --apply to actually write.\n");
    process.exit(0);
  }
  let n = 0;
  for (const p of parsed.products) {
    const payload = {};
    for (const key of ["image_path", "image_url", "image_mime", "image_size"]) {
      payload[key] = p[key] === null ? FieldValue.delete() : p[key];
    }
    await db.collection("products").doc(p.id).update(payload);
    n++;
  }
  console.log(`Restored ${n} products.\n`);
  process.exit(0);
}

console.log(`\nProduct image backfill`);
console.log(`  bucket:    ${bucketName} (project ${projectId})`);
console.log(`  firestore: ${resolvedFirebaseProject}`);
console.log(APPLY ? "Mode: APPLY (writes)" : "Mode: DRY RUN (no writes; pass --apply to commit)");
if (APPLY && DELETE_ORIGINALS) console.log("Originals will be DELETED after a verified rewrite.");

const snapshot = await db
  .collection("products")
  .select("name", "image_path", "image_url", "image_mime", "image_size")
  .get();

const candidates = [];
/** Every object path any product references — the inverse of this set is an orphan. */
const referenced = new Set();
for (const doc of snapshot.docs) {
  const data = doc.data();
  const storedPath = data.image_path?.trim();
  const fromUrl = derivePathFromUrl(data.image_url?.trim());
  if (storedPath) referenced.add(storedPath);
  if (fromUrl) referenced.add(fromUrl);
  const derived = storedPath || fromUrl;
  if (!derived || !derived.startsWith("products/")) continue;
  candidates.push({
    id: doc.id,
    name: data.name ?? "(unnamed)",
    objectPath: derived,
    // A row whose path we recovered from the URL needs image_path written even if the
    // bytes turn out to be fine already.
    needsPathWrite: !storedPath,
  });
}

const work = candidates.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
console.log(
  `\n${snapshot.size} products scanned, ${candidates.length} with a bucket image` +
    (work.length !== candidates.length ? `, processing ${work.length} (--limit)` : "") +
    "\n",
);

if (work.length === 0) {
  console.log("No product images to convert. Still checking the bucket for unreferenced objects.\n");
}

// Snapshot every image field we are about to overwrite. Originals stay in the bucket
// unless --delete-originals is passed, so this file plus those objects is enough to put
// every product back exactly as it was.
if (APPLY && work.length > 0) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(repoRoot, `image-backfill-backup-${resolvedFirebaseProject}-${stamp}.json`);
  const rows = [];
  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (!d.image_path && !d.image_url) continue;
    rows.push({
      id: doc.id,
      image_path: d.image_path ?? null,
      image_url: d.image_url ?? null,
      image_mime: d.image_mime ?? null,
      image_size: d.image_size ?? null,
    });
  }
  fs.writeFileSync(backupPath, JSON.stringify({ project: resolvedFirebaseProject, bucket: bucketName, takenAt: new Date().toISOString(), products: rows }, null, 2));
  console.log(`Backup written: ${backupPath}  (${rows.length} products)`);
  console.log(`Restore with:   npm run images:backfill -- --restore="${backupPath}"\n`);
}

const stats = { rewritten: 0, skipped: 0, missing: 0, failed: 0, bytesBefore: 0, bytesAfter: 0 };

await mapWithConcurrency(work, CONCURRENCY, async (item) => {
  const label = `${item.name} (${item.id})`;
  try {
    const sourceFile = bucket.file(item.objectPath);
    const [exists] = await sourceFile.exists();
    if (!exists) {
      stats.missing++;
      console.log(`  ⚠ missing in bucket   ${label} → ${item.objectPath}`);
      return;
    }

    const [metadata] = await sourceFile.getMetadata();
    const originalSize = Number(metadata.size ?? 0);
    const contentType = metadata.contentType || "image/jpeg";

    const [buffer] = await sourceFile.download();
    const processed = await processProductImage(buffer, contentType, item.objectPath);

    if (!processed.optimized) {
      stats.failed++;
      console.log(`  ⚠ could not decode    ${label} (${contentType}, ${mb(originalSize)})`);
      return;
    }

    // Re-encoding an already-lean file only loses detail for no gain.
    if (processed.buffer.byteLength >= originalSize) {
      stats.skipped++;
      stats.bytesBefore += originalSize;
      stats.bytesAfter += originalSize;
      if (item.needsPathWrite && APPLY) {
        await db.collection("products").doc(item.id).update({ image_path: item.objectPath });
      }
      console.log(`  = already optimal     ${label} (${mb(originalSize)})`);
      return;
    }

    const owner = item.objectPath.split("/")[1] ?? "legacy";
    const newPath = `products/${owner}/product-image-${Date.now()}-${item.id}.webp`;

    stats.bytesBefore += originalSize;
    stats.bytesAfter += processed.buffer.byteLength;
    const saving = (1 - processed.buffer.byteLength / originalSize) * 100;

    if (!APPLY) {
      stats.rewritten++;
      console.log(
        `  → would rewrite       ${label}: ${mb(originalSize)} → ${mb(processed.buffer.byteLength)} (-${saving.toFixed(0)}%)`,
      );
      return;
    }

    const target = bucket.file(newPath);
    await target.save(processed.buffer, {
      metadata: {
        contentType: processed.contentType,
        cacheControl: "public, max-age=31536000, immutable",
        metadata: {
          backfilledFrom: item.objectPath,
          backfilledAt: new Date().toISOString(),
        },
      },
    });

    const [written] = await target.exists();
    if (!written) throw new Error("upload verification failed");

    await db.collection("products").doc(item.id).update({
      image_path: newPath,
      image_url: `https://storage.googleapis.com/${bucketName}/${newPath}`,
      image_mime: processed.contentType,
      image_size: processed.buffer.byteLength,
    });

    // Only after Firestore points at the new object — never leave a row referencing
    // something that has been deleted.
    if (DELETE_ORIGINALS && item.objectPath !== newPath) {
      await bucket.file(item.objectPath).delete({ ignoreNotFound: true });
    }

    referenced.add(newPath);
    stats.rewritten++;
    console.log(
      `  ✓ rewritten           ${label}: ${mb(originalSize)} → ${mb(processed.buffer.byteLength)} (-${saving.toFixed(0)}%)`,
    );
  } catch (error) {
    stats.failed++;
    console.log(`  ✗ failed              ${label}: ${error?.message ?? error}`);
  }
});

// ---------------------------------------------------------------- orphan sweep
// Objects under products/ that no product row points at: abandoned replacements, deleted
// products, and test uploads. They cost storage and nothing else.
const orphans = [];
let orphanBytes = 0;
{
  const cutoff = Date.now() - ORPHAN_MIN_AGE_HOURS * 3600 * 1000;
  let pageToken;
  do {
    const [objects, , meta] = await bucket.getFiles({
      prefix: "products/",
      autoPaginate: false,
      maxResults: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const o of objects) {
      if (referenced.has(o.name)) continue;
      const updated = Date.parse(o.metadata.updated ?? "") || 0;
      if (updated > cutoff) continue;
      const size = Number(o.metadata.size ?? 0);
      orphans.push({ name: o.name, size });
      orphanBytes += size;
    }
    pageToken = meta?.nextPageToken;
  } while (pageToken);
}

if (orphans.length > 0) {
  console.log(`\nUNREFERENCED OBJECTS  —  ${orphans.length} files, ${mb(orphanBytes)}`);
  console.log(`(older than ${ORPHAN_MIN_AGE_HOURS}h and pointed at by no product in ${resolvedFirebaseProject})`);
  for (const o of orphans.slice(0, 20)) console.log(`  ${mb(o.size).padStart(9)}  ${o.name}`);
  if (orphans.length > 20) console.log(`  ...and ${orphans.length - 20} more`);

  // A bucket shared with another environment would make live objects look orphaned here.
  // Far more objects than products is the signature of pointing at the wrong database.
  const suspicious = snapshot.size === 0 || orphans.length > snapshot.size * 3;
  if (DELETE_ORPHANS && suspicious) {
    console.log(
      `\n  REFUSING to delete: ${snapshot.size} products but ${orphans.length} unreferenced objects.\n` +
        `  That usually means this is pointed at the wrong Firestore project, or the bucket is\n` +
        `  shared with another environment. Check the header above before forcing anything.`,
    );
  } else if (DELETE_ORPHANS && APPLY) {
    for (const o of orphans) await bucket.file(o.name).delete({ ignoreNotFound: true });
    console.log(`\n  Deleted ${orphans.length} unreferenced objects, freeing ${mb(orphanBytes)}.`);
  } else if (DELETE_ORPHANS) {
    console.log(`\n  Dry run — re-run with --apply --delete-orphans to remove these.`);
  } else {
    console.log(`\n  Pass --delete-orphans to review removing them.`);
  }
} else {
  console.log(`\nNo unreferenced objects under products/ older than ${ORPHAN_MIN_AGE_HOURS}h.`);
}

const saved = stats.bytesBefore - stats.bytesAfter;
console.log(`
────────────────────────────────────────────
  ${APPLY ? "Rewritten" : "Would rewrite"}: ${stats.rewritten}
  Already optimal:  ${stats.skipped}
  Missing in bucket:${String(stats.missing).padStart(2)}
  Failed:           ${stats.failed}

  Before: ${mb(stats.bytesBefore)}
  After:  ${mb(stats.bytesAfter)}
  Saved:  ${mb(saved)}${stats.bytesBefore > 0 ? ` (${((saved / stats.bytesBefore) * 100).toFixed(0)}%)` : ""}
────────────────────────────────────────────
`);

if (!APPLY && stats.rewritten > 0) {
  console.log("Dry run only. Re-run with --apply to commit these changes.\n");
}
