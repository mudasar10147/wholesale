import { FirebaseError } from "firebase/app";
import { getAuthClient } from "@/lib/firebase";

const TAG = "[Wholesale Firestore]";

/**
 * Logs ID token claims before sensitive writes. Open DevTools → Console to verify.
 * `admin` should be `true` (boolean) for Firestore rules `isAdmin()`.
 */
export async function logFirestoreAuthForDebug(context: string): Promise<void> {
  if (typeof console === "undefined") return;
  const auth = getAuthClient();
  const u = auth.currentUser;
  if (!u) {
    console.warn(
      TAG,
      context,
      "No Firebase Auth user — writes will fail rules (auth is null). Sign in first.",
    );
    return;
  }
  try {
    const tr = await u.getIdTokenResult(false);
    const hasAdmin = tr.claims.admin === true || tr.claims.admin === "true";
    // Use error level so default console filters show it (Info is often hidden).
    if (hasAdmin) {
      console.info(TAG, context, "auth OK — admin claim present", {
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        uid: u.uid,
        email: u.email,
      });
    } else {
      console.error(
        TAG,
        `\n━━ ${context} ━━\n` +
          "NO admin CUSTOM CLAIM on this ID token — Firestore rules will DENY all writes.\n" +
          `  projectId: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}\n` +
          `  uid: ${u.uid}\n` +
          `  email: ${u.email ?? "(none)"}\n` +
          "  claims.admin: " +
          String(tr.claims.admin) +
          "\n" +
          "Fix: Firebase Console → Authentication → copy your User UID, then from your machine:\n" +
          "  GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json \\\n" +
          "    node scripts/set-admin-claim.cjs <USER_UID>\n" +
          "Then Sign out → Sign in (or wait ~1h) so the new token loads.\n",
      );
    }
  } catch (e) {
    console.error(TAG, context, "Could not read ID token for debug", e);
  }
}

/**
 * Logs full Firebase error details (code, message, customData) for permission-denied debugging.
 */
export function logFirestoreError(context: string, error: unknown): void {
  if (typeof console === "undefined") return;
  const base: Record<string, unknown> = { context };
  if (error instanceof FirebaseError) {
    base.code = error.code;
    base.message = error.message;
    base.name = error.name;
    const cd = (error as FirebaseError & { customData?: unknown }).customData;
    if (cd !== undefined) base.customData = cd;
  } else if (error instanceof Error) {
    base.message = error.message;
    base.stack = error.stack;
  } else {
    base.value = error;
  }
  console.error(TAG, "request failed", base);
}
