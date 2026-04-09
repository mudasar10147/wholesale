import { FirebaseError } from "firebase/app";

/**
 * User-facing message for Firestore / Firebase client errors.
 */
export function getFirestoreUserMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "permission-denied":
        return "You don't have permission to perform this action. Check Firestore rules.";
      case "unavailable":
        return "Service temporarily unavailable. Try again in a moment.";
      case "failed-precondition":
        return "Request could not be completed. Try again.";
      case "resource-exhausted":
        return "Too many requests. Wait a moment and try again.";
      case "deadline-exceeded":
        return "Request timed out. Check your connection and try again.";
      case "unauthenticated":
        return "Authentication required.";
      default:
        break;
    }
    if (error.message && error.message.length > 0 && error.message.length < 200) {
      return error.message;
    }
    return "Something went wrong. Please try again.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
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
