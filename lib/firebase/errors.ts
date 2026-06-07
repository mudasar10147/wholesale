import { FirebaseError } from "firebase/app";

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  customData?: unknown;
  stack?: unknown;
};

/** Duck-type Firebase/Firestore errors (instanceof can fail across bundles). */
export function extractFirestoreErrorDetails(error: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (error == null) {
    base.kind = error === null ? "null" : "undefined";
    return base;
  }

  if (error instanceof FirebaseError) {
    base.code = error.code;
    base.message = error.message;
    base.name = error.name;
    const cd = (error as FirebaseError & { customData?: unknown }).customData;
    if (cd !== undefined) base.customData = cd;
    return base;
  }

  if (error instanceof Error) {
    base.message = error.message;
    base.name = error.name;
    if (error.stack) base.stack = error.stack;
  }

  if (typeof error === "object") {
    const o = error as ErrorLike;
    if (typeof o.code === "string" && !base.code) base.code = o.code;
    if (typeof o.message === "string" && !base.message) base.message = o.message;
    if (typeof o.name === "string" && !base.name) base.name = o.name;
    if (o.customData !== undefined && !("customData" in base)) base.customData = o.customData;
    if (typeof o.stack === "string" && !base.stack) base.stack = o.stack;
  }

  if (Object.keys(base).length === 0) {
    try {
      base.detail = JSON.stringify(error);
    } catch {
      base.detail = String(error);
    }
  }

  return base;
}

function getFirebaseErrorCode(error: unknown): string | undefined {
  if (error instanceof FirebaseError) return error.code;
  if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return undefined;
}

function getFirebaseErrorMessage(error: unknown): string | undefined {
  if (error instanceof FirebaseError) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  if (error instanceof Error) return error.message;
  return undefined;
}

/**
 * User-facing message for Firestore / Firebase client errors.
 */
export function getFirestoreUserMessage(error: unknown): string {
  const code = getFirebaseErrorCode(error);
  const message = getFirebaseErrorMessage(error);

  if (code) {
    switch (code) {
      case "permission-denied": {
        return (
          `${message ?? "Missing or insufficient permissions."} ` +
          "This usually means Firestore security rules rejected the operation—not necessarily a missing admin claim. " +
          "If your token already has admin=true, check: deployed rules match this project (firebase deploy --only firestore:rules), " +
          "and that the write passes rule validation (e.g. invoice post money/shape checks, stock lot document fields). " +
          "If Auth shows \"offline\" for token or accounts:lookup, fix network/blockers first so requests use a fresh token."
        );
      }
      case "unavailable":
        return "Service temporarily unavailable. Try again in a moment.";
      case "failed-precondition": {
        // Often a missing Firestore composite index; the SDK message includes a console link.
        const msg = message?.trim() ?? "";
        if (msg.length > 0 && (msg.includes("index") || msg.includes("console.firebase.google.com"))) {
          return msg.length <= 600 ? msg : `${msg.slice(0, 597)}…`;
        }
        return "Request could not be completed. Try again.";
      }
      case "resource-exhausted":
        return "Too many requests. Wait a moment and try again.";
      case "deadline-exceeded":
        return "Request timed out. Check your connection and try again.";
      case "unauthenticated":
        return "Authentication required.";
      default:
        break;
    }
    if (message && message.length > 0 && message.length < 200) {
      return message;
    }
    return "Something went wrong. Please try again.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const details = extractFirestoreErrorDetails(error);
  if (typeof details.message === "string" && details.message.length > 0 && details.message.length < 200) {
    return details.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * User-facing message for Firebase Authentication errors (sign-in, etc.).
 */
export function getAuthUserMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/user-disabled":
        return "This account has been disabled.";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Invalid email or password.";
      case "auth/too-many-requests":
        return "Too many attempts. Try again later.";
      case "auth/network-request-failed":
        return "Network error. Check your connection.";
      default:
        break;
    }
    if (error.message && error.message.length > 0 && error.message.length < 200) {
      return error.message;
    }
    return "Sign-in failed. Please try again.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Sign-in failed. Please try again.";
}
