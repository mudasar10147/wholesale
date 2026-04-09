/**
 * One-time: set Firebase Auth custom claim { admin: true } for a user UID.
 *
 * Prerequisites:
 * - Service account JSON from Firebase Console → Project settings → Service accounts
 * - npm install (installs firebase-admin as devDependency)
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/set-admin-claim.cjs <USER_UID>
 *
 * Find UID: Firebase Console → Authentication → Users → copy UID.
 * After running, have the user sign out and sign in again (or wait ~1h for token refresh).
 */

const fs = require("fs");
const path = require("path");

const uid = process.argv[2];
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!uid) {
  console.error("Usage: GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json node scripts/set-admin-claim.cjs <USER_UID>");
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
  .setCustomUserClaims(uid, { admin: true })
  .then(() => {
    console.log(`Custom claim admin=true set for uid=${uid}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
