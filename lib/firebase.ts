import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  disableNetwork,
  enableNetwork,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";

// Use static process.env.NEXT_PUBLIC_* access only. Next.js inlines these for the
// client bundle; dynamic access like process.env[name] stays undefined in the browser.

function createFirebaseApp(): FirebaseApp {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (
    !apiKey ||
    !authDomain ||
    !projectId ||
    !storageBucket ||
    !messagingSenderId ||
    !appId
  ) {
    throw new Error(
      "Missing Firebase env vars. Copy .env.example to .env.local and add values (see docs/FIREBASE_PHASE1.md).",
    );
  }

  return initializeApp({
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  });
}

export function getFirebaseApp(): FirebaseApp {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0]!;
  }
  return createFirebaseApp();
}

let firestoreSingleton: Firestore | null = null;

/**
 * Prefer long-polling auto-detect so Safari / strict browsers are less likely to fail
 * Firestore Listen/WebChannel ("access control checks" on the Listen URL).
 */
export function getDb(): Firestore {
  if (firestoreSingleton) {
    return firestoreSingleton;
  }
  const app = getFirebaseApp();
  try {
    firestoreSingleton = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    firestoreSingleton = getFirestore(app);
  }
  return firestoreSingleton;
}

/**
 * Tears down and re-dials Firestore's network streams — the programmatic version of
 * the page reload people currently do by hand when an operation wedges.
 *
 * `getDocs` and snapshot listeners ride the Listen/WebChannel stream and never time
 * out on their own, so a stream that has died without noticing leaves them waiting
 * forever. Rebuilding the stream is what actually clears that state; retrying the
 * same call against the same dead stream does not.
 *
 * Briefly takes the whole client offline, so live listeners flap to cached data for a
 * moment. Never throws — a failed reset must not mask the error that prompted it.
 */
export async function resetFirestoreConnection(): Promise<void> {
  try {
    const db = getDb();
    await disableNetwork(db);
    await enableNetwork(db);
    console.info("[firestore] connection reset — streams rebuilt");
  } catch (e) {
    console.error("[firestore] connection reset failed", e);
  }
}

let authSingleton: Auth | null = null;

export function getAuthClient(): Auth {
  if (!authSingleton) {
    authSingleton = getAuth(getFirebaseApp());
  }
  return authSingleton;
}
