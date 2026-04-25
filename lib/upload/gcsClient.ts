import { Storage } from '@google-cloud/storage';
import { logger } from '../utils/logger';

let storageClient: Storage | null = null;

// Returns a cached GCS client, or null if env vars are missing.
// Auth is via ADC — no key file needed when a service account is attached to the instance.
export function getGCSClient(): Storage | null {
  if (storageClient !== null) {
    return storageClient;
  }

  const projectId = process.env.GCS_PROJECT_ID;
  const bucketName = process.env.GCS_BUCKET_NAME;

  if (!projectId || !bucketName) {
    logger.info('GCS not configured: Missing GCS_PROJECT_ID or GCS_BUCKET_NAME. Using local file storage.');
    return null;
  }

  try {
    storageClient = new Storage({ projectId });
    logger.info('GCS client initialized with Application Default Credentials');
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
