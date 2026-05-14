import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { parseGoogleServiceAccountJson } from "@/lib/server/googleServiceAccountJson";

let adminApp: App | null = null;

function resolveFirebaseProjectIdForAdmin(): string | undefined {
  return (
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCS_PROJECT_ID?.trim() ||
    undefined
  );
}

/**
 * Credentials for Firebase Admin (verifyIdToken, etc.).
 * On Vercel, `applicationDefault()` has no project/credentials — always use explicit `cert()` when possible.
 */
function getAdminCredential() {
  const splitProjectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (splitProjectId && clientEmail && privateKey) {
    return cert({
      projectId: splitProjectId,
      clientEmail,
      privateKey,
    });
  }

  const fromFirebaseAdminJson = parseGoogleServiceAccountJson(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON);
  if (fromFirebaseAdminJson) {
    const projectId =
      fromFirebaseAdminJson.project_id?.trim() || resolveFirebaseProjectIdForAdmin();
    if (!projectId) {
      return applicationDefault();
    }
    return cert({
      projectId,
      clientEmail: fromFirebaseAdminJson.client_email,
      privateKey: fromFirebaseAdminJson.private_key,
    });
  }

  // Same GCP service account JSON as GCS — typical on Vercel when only one secret is configured.
  const fromGcsJson = parseGoogleServiceAccountJson(process.env.GCS_SERVICE_ACCOUNT_JSON);
  if (fromGcsJson) {
    const projectId = fromGcsJson.project_id?.trim() || resolveFirebaseProjectIdForAdmin();
    if (!projectId) {
      return applicationDefault();
    }
    return cert({
      projectId,
      clientEmail: fromGcsJson.client_email,
      privateKey: fromGcsJson.private_key,
    });
  }

  return applicationDefault();
}

export function getFirebaseAdminApp(): App {
  if (adminApp) {
    return adminApp;
  }

  const existing = getApps();
  if (existing.length > 0) {
    adminApp = existing[0]!;
    return adminApp;
  }

  const projectIdForInit = resolveFirebaseProjectIdForAdmin();

  adminApp = initializeApp({
    credential: getAdminCredential(),
    ...(projectIdForInit ? { projectId: projectIdForInit } : {}),
  });
  return adminApp;
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}
