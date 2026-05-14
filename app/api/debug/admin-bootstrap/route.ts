import { NextResponse } from "next/server";
import { verifyRequestAuth } from "@/lib/server/auth";
import { parseGoogleServiceAccountJson } from "@/lib/server/googleServiceAccountJson";
import { getGCSClient, isGCSConfigured } from "@/lib/upload/gcsClient";

/**
 * Admin-only diagnostics for Vercel/server bootstrap (no secrets returned).
 * GET /api/debug/admin-bootstrap with `Authorization: Bearer <Firebase ID token>`.
 */
export async function GET(request: Request) {
  await verifyRequestAuth(request, true);

  const gcsJson = parseGoogleServiceAccountJson(process.env.GCS_SERVICE_ACCOUNT_JSON);
  const adminJson = parseGoogleServiceAccountJson(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON);
  const splitVars =
    Boolean(process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()) &&
    Boolean(process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()) &&
    Boolean(process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim());

  let firebaseAdminCredentialSource:
    | "split_env"
    | "firebase_admin_json"
    | "gcs_json_reuse"
    | "application_default" = "application_default";
  if (splitVars) {
    firebaseAdminCredentialSource = "split_env";
  } else if (adminJson) {
    firebaseAdminCredentialSource = "firebase_admin_json";
  } else if (gcsJson) {
    firebaseAdminCredentialSource = "gcs_json_reuse";
  }

  const gcsClientOk = getGCSClient() !== null;

  return NextResponse.json({
    vercel: process.env.VERCEL === "1",
    gcs: {
      has_GCS_PROJECT_ID: Boolean(process.env.GCS_PROJECT_ID?.trim()),
      has_GCS_BUCKET_NAME: Boolean(process.env.GCS_BUCKET_NAME?.trim()),
      GCS_SERVICE_ACCOUNT_JSON_parseable: Boolean(gcsJson),
      gcs_client_constructed: gcsClientOk,
      is_gcs_configured: isGCSConfigured(),
      json_project_id_present: Boolean(gcsJson?.project_id?.trim()),
    },
    firebaseAdmin: {
      has_FIREBASE_ADMIN_split_vars: splitVars,
      FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON_parseable: Boolean(adminJson),
      has_NEXT_PUBLIC_FIREBASE_PROJECT_ID: Boolean(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()),
      has_GOOGLE_APPLICATION_CREDENTIALS: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()),
      inferred_credential_source: firebaseAdminCredentialSource,
    },
    hints: [
      !gcsJson
        ? "GCS_SERVICE_ACCOUNT_JSON is missing or not valid JSON. Minify with `jq -c . key.json` and paste one line into Vercel, then redeploy."
        : null,
      firebaseAdminCredentialSource === "application_default" && process.env.VERCEL === "1"
        ? "Firebase Admin had no explicit service account. On Vercel, set FIREBASE_ADMIN_* vars, FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON, or ensure GCS_SERVICE_ACCOUNT_JSON parses (it is reused for Admin after this fix)."
        : null,
      gcsJson && !gcsJson.project_id?.trim() && !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
        ? "Service account JSON has no project_id; set NEXT_PUBLIC_FIREBASE_PROJECT_ID or GCS_PROJECT_ID so Firebase Admin can initialize."
        : null,
    ].filter((x): x is string => typeof x === "string"),
  });
}
