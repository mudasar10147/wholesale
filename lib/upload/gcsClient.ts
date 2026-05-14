import { Storage } from "@google-cloud/storage";
import { parseGoogleServiceAccountJson } from "@/lib/server/googleServiceAccountJson";
import { logger } from "../utils/logger";

let storageClient: Storage | null = null;

// Returns a cached GCS client, or null if env vars are missing.
// Auth (in order): `GCS_SERVICE_ACCOUNT_JSON` (Vercel / serverless), else Application Default Credentials
// (e.g. `GOOGLE_APPLICATION_CREDENTIALS` path on a laptop or SA attached to a GCP VM).
export function getGCSClient(): Storage | null {
  if (storageClient !== null) {
    return storageClient;
  }

  const projectId = process.env.GCS_PROJECT_ID?.trim();
  const bucketName = process.env.GCS_BUCKET_NAME?.trim();

  if (!projectId || !bucketName) {
    logger.info("GCS not configured: Missing GCS_PROJECT_ID or GCS_BUCKET_NAME. Using local file storage.");
    return null;
  }

  const credentials = parseGoogleServiceAccountJson(process.env.GCS_SERVICE_ACCOUNT_JSON);
  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  // Never use `new Storage({ projectId })` alone on Vercel/serverless: there is no metadata-based
  // Application Default Credentials, so the first API call fails with "Unable to detect a Project Id".
  if (!credentials && !adcPath) {
    logger.warn(
      "GCS is partially configured: GCS_PROJECT_ID and GCS_BUCKET_NAME are set but GCS_SERVICE_ACCOUNT_JSON " +
        "is missing or invalid JSON. On Vercel paste the full service account key as one line (see docs/GCS_VERCEL.md). " +
        "Locally you can use GOOGLE_APPLICATION_CREDENTIALS instead.",
    );
    return null;
  }

  try {
    storageClient = credentials
      ? new Storage({
          projectId: credentials.project_id || projectId,
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
          },
        })
      : new Storage({ projectId });
    logger.info(
      credentials
        ? "GCS client initialized with GCS_SERVICE_ACCOUNT_JSON"
        : "GCS client initialized with Application Default Credentials",
    );
    return storageClient;
  } catch (error) {
    logger.error("Failed to initialize GCS client", { err: error });
    return null;
  }
}

export function getGCSBucketName(): string | null {
  return process.env.GCS_BUCKET_NAME?.trim() || null;
}

// Convenience check used by saveFile.ts to decide between GCS and local disk.
export function isGCSConfigured(): boolean {
  const client = getGCSClient();
  const bucketName = getGCSBucketName();
  return client !== null && bucketName !== null;
}
