/**
 * Smoke test: upload public/wholesale_logo.png to GCS using the same env as the app.
 *
 * Prereqs in .env.local (or exported in the shell):
 *   GCS_PROJECT_ID
 *   GCS_BUCKET_NAME
 * And one of:
 *   GCS_SERVICE_ACCOUNT_JSON — full service account JSON (one line / minified; same as Vercel), or
 *   GOOGLE_APPLICATION_CREDENTIALS — absolute path to the key file (local ADC-style).
 *
 * Run from repo root:
 *   npm run test:gcs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "@google-cloud/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.warn("No .env.local found; using process.env only.\n");
    return;
  }
  const raw = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  for (let line of raw.split("\n")) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    trimmed = trimmed.replace(/^export\s+/i, "");
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("Loaded env from", envPath);
}

loadEnvLocal();

const projectId = process.env.GCS_PROJECT_ID;
const bucketName = process.env.GCS_BUCKET_NAME;
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const jsonFromEnv = process.env.GCS_SERVICE_ACCOUNT_JSON?.trim();

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/** @returns {{ client_email: string, private_key: string } | null} */
function parseServiceAccountJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      console.error("GCS_SERVICE_ACCOUNT_JSON must include client_email and private_key strings.");
      return null;
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch (e) {
    console.error("GCS_SERVICE_ACCOUNT_JSON is not valid JSON:", e?.message || e);
    return null;
  }
}

const credentials = parseServiceAccountJson(jsonFromEnv);

if (!projectId) fail("Missing GCS_PROJECT_ID (set in .env.local or export it).");
if (!bucketName) fail("Missing GCS_BUCKET_NAME.");
if (jsonFromEnv && !credentials) {
  fail("GCS_SERVICE_ACCOUNT_JSON is set but could not be parsed (invalid JSON or missing fields).");
}
if (!credentials) {
  if (!credPath) {
    fail(
      "Set either GCS_SERVICE_ACCOUNT_JSON (full JSON string) or GOOGLE_APPLICATION_CREDENTIALS (path to key file).",
    );
  }
  if (!fs.existsSync(credPath)) {
    fail(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${credPath}`);
  }
}

const logoPath = path.join(repoRoot, "public", "wholesale_logo.png");
if (!fs.existsSync(logoPath)) {
  fail(`Logo not found at ${logoPath}`);
}

const ownerId = "gcs-test-script";
const ext = ".png";
const objectPath = `products/${ownerId}/product-image-${Date.now()}${ext}`;

async function main() {
  console.log("Project:", projectId);
  console.log("Bucket: ", bucketName);
  console.log(
    "Auth:   ",
    credentials ? "GCS_SERVICE_ACCOUNT_JSON" : `GOOGLE_APPLICATION_CREDENTIALS=${credPath}`,
  );
  console.log("Object: ", objectPath);
  console.log("");

  const storage = credentials
    ? new Storage({ projectId, credentials })
    : new Storage({ projectId });
  const bucket = storage.bucket(bucketName);
  const buffer = fs.readFileSync(logoPath);

  const file = bucket.file(objectPath);
  await file.save(buffer, {
    metadata: {
      contentType: "image/png",
      cacheControl: "public, max-age=3600",
      metadata: { uploadedBy: "scripts/test-gcs-upload.mjs", purpose: "gcs-smoke-test" },
    },
  });

  const [exists] = await file.exists();
  if (!exists) {
    fail("Upload reported success but object does not exist.");
  }

  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });

  console.log("GCS upload OK.");
  console.log("Signed URL (15 min, open in browser to verify image):\n", signedUrl);
  console.log("\nYou can delete the test object in Console → Storage → Buckets →", objectPath);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
