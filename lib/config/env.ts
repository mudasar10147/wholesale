export const env = {
  GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME,
  GCS_PROJECT_ID: process.env.GCS_PROJECT_ID,
  /** Server-only: full service account JSON string (Vercel). Do not expose with NEXT_PUBLIC_. */
  GCS_SERVICE_ACCOUNT_JSON: process.env.GCS_SERVICE_ACCOUNT_JSON,
} as const;
