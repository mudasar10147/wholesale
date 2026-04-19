/**
 * Set Firebase Auth custom claim { role: "clerk" } for a user UID.
 *
 * Replaces all custom claims on that user with this object (clerk has no `admin` claim).
 * To promote to admin later, run set-admin-claim.cjs (which sets { admin: true } only).
 *
 * Prerequisites:
 * - Service account JSON from Firebase Console → Project settings → Service accounts
 * - npm install (installs firebase-admin as devDependency)
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/set-clerk-claim.cjs <USER_UID>
 *
 * Find UID: Firebase Console → Authentication → Users → copy UID.
 * After running, have the user sign out and sign in again (or wait for token refresh).
 */

const fs = require("fs");
const path = require("path");

const uid = process.argv[2];
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!uid) {
  console.error(
    "Usage: GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json node scripts/set-clerk-claim.cjs <USER_UID>",
  );
  process.exit(1);
}
if (!credPath || !fs.existsSync(credPath)) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file path.");
  process.exit(1);
}

const admin = require("firebase-admin");

const raw = fs.readFileSync(path.resolve(credPath), "utf8");
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(raw)),
});

admin
  .auth()
  .setCustomUserClaims(uid, { role: "clerk" })
  .then(() => {
    console.log(`Custom claim role=clerk set for uid=${uid}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
