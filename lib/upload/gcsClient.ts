import { Storage } from '@google-cloud/storage';
import { logger } from '../utils/logger';

let storageClient: Storage | null = null;

/** Minimal shape for `Storage({ credentials })` — full SA JSON from GCP. */
type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

function parseServiceAccountFromEnv(): ServiceAccountCredentials | null {
  let raw = process.env.GCS_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  // Strip UTF-8 BOM if the secret was saved with one
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  try {
    let parsed: unknown = JSON.parse(raw);
    // Vercel / copy-paste: value is sometimes a JSON-encoded string containing the object
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed) as unknown;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      logger.warn('GCS_SERVICE_ACCOUNT_JSON parsed to a non-object');
      return null;
    }
    const rec = parsed as Record<string, unknown>;
    const client_email = rec.client_email;
    const private_key = rec.private_key;
    if (typeof client_email !== 'string' || typeof private_key !== 'string') {
      logger.warn(
        'GCS_SERVICE_ACCOUNT_JSON is set but JSON is missing client_email or private_key (wrong file type?)',
      );
      return null;
    }
    return {
      client_email,
      private_key,
      project_id: typeof rec.project_id === 'string' ? rec.project_id : undefined,
    };
  } catch (error) {
    logger.error('GCS_SERVICE_ACCOUNT_JSON is not valid JSON', { err: error });
    return null;
  }
}

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
    logger.info('GCS not configured: Missing GCS_PROJECT_ID or GCS_BUCKET_NAME. Using local file storage.');
    return null;
  }

  const credentials = parseServiceAccountFromEnv();
  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  // Never use `new Storage({ projectId })` alone on Vercel/serverless: there is no metadata-based
  // Application Default Credentials, so the first API call fails with "Unable to detect a Project Id".
  if (!credentials && !adcPath) {
    logger.warn(
      'GCS is partially configured: GCS_PROJECT_ID and GCS_BUCKET_NAME are set but GCS_SERVICE_ACCOUNT_JSON ' +
        'is missing or invalid JSON. On Vercel paste the full service account key as one line (see docs/GCS_VERCEL.md). ' +
        'Locally you can use GOOGLE_APPLICATION_CREDENTIALS instead.',
    );
    return null;
  }

  try {
    storageClient = credentials
      ? new Storage({
          projectId: credentials.project_id || projectId,
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key.replace(/\\n/g, '\n'),
          },
        })
      : new Storage({ projectId });
    logger.info(
      credentials
        ? 'GCS client initialized with GCS_SERVICE_ACCOUNT_JSON'
        : 'GCS client initialized with Application Default Credentials',
    );
    return storageClient;
  } catch (error) {
    logger.error('Failed to initialize GCS client', { err: error });
    return null;
  }
}

export function getGCSBucketName(): string | null {
  return process.env.GCS_BUCKET_NAME || null;
}

// Convenience check used by saveFile.ts to decide between GCS and local disk.
export function isGCSConfigured(): boolean {
  const client = getGCSClient();
  const bucketName = getGCSBucketName();
  return client !== null && bucketName !== null;
}
