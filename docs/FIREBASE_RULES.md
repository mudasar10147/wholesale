# Firestore security rules

**Source of truth:** the repo root file [`firestore.rules`](../firestore.rules). Localhost uses the **same** Firebase project and **published** rules as production—there is no separate “local” permission layer.

## Authentication (required)

All Firestore reads and writes require a signed-in user whose ID token includes **`admin: true`** (Firebase Auth [custom claim](https://firebase.google.com/docs/auth/admin/custom-claims)).

1. **Firebase Console** → **Authentication** → enable **Email/Password**.
2. Create a user (or use an existing account). Copy the user’s **UID** from the Users list.
3. Set the admin claim using the Admin SDK (local script):
   - Download a **service account** JSON: Project settings → Service accounts → Generate new private key.
   - Run from the repo root (see [`scripts/set-admin-claim.cjs`](../scripts/set-admin-claim.cjs)):
     - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/set-admin-claim.cjs <UID>`
4. **Authorized domains**: Authentication → Settings → add your production domain (e.g. Vercel `*.vercel.app` and custom domain). Include `localhost` for dev.
5. **Publish** `firestore.rules` only after you can sign in and confirm the app loads data (or use the Rules Playground first). If you deploy rules before any user has `admin: true`, the app will get permission-denied until the claim is set.
6. After setting the claim, the user must **sign out and sign in again** so the client picks up the new token (the app refreshes claims on auth state change with `getIdToken(true)`).

The Next.js app uses **Email/Password** sign-in on [`/login`](../app/login/page.tsx); the dashboard is behind `RequireAdmin`.

## If you see “permission denied” on localhost

1. **Publish the full rules**  
   [Firebase Console](https://console.firebase.google.com) → your project → **Firestore** → **Rules** → paste the **entire** contents of `firestore.rules` from this repo → **Publish**.

2. **Confirm the project**  
   `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (and related keys) in `.env.local` must match the project where you published rules.

3. **Avoid the old minimal snippet below**  
   The “Phase 1 smoke + products/sales/expenses only” rules **deny** `customers`, `invoices`, `invoice_items`, `stock_lots`, `lot_consumptions`, and `invoice_item_cogs`. If the Console still has that pattern, every invoice/customer/FIFO flow will fail.

4. **If it still fails after publishing**  
   The rules validate document shape and transitions. Check the failing request in the browser Network tab (Firestore REST) or temporarily log the error code. A mismatch between what the client writes and the validators in `firestore.rules` (e.g. `validInvoiceBase`, `validInvoiceItemBase`) also surfaces as permission-denied.

## Collections covered by the current `firestore.rules`

| Path | Notes |
|------|--------|
| `phase1_smoke` | Optional smoke test |
| `products`, `sales`, `expenses` | MVP |
| `customers` | Create/update validated; no delete |
| `invoices` | Draft → posted → void lifecycle |
| `invoice_items` | Create only; immutable after |
| `stock_lots` | FIFO lots |
| `lot_consumptions` | Create + one-time `reversed_at` on void |
| `invoice_item_cogs` | Create only; COGS snapshot per line |
| `/{document=**}` | Denied |

Rules use `isAdmin()` = `request.auth != null && request.auth.token.admin == true` on every collection above.

## Tightening later

- Add non-admin roles via additional custom claims and split `match` rules.
- Prefer smaller `match` scopes per role.
- See [Phase 9 in PHASE_PLAN.md](PHASE_PLAN.md) if referenced in your plan.

---

## Historical: minimal Phase 1 + Phase 2 snippet (do not use with invoices/customers)

**Warning:** This pattern denies all paths except the four matches below. Use only for a bare smoke test without customers, invoices, or inventory lots.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /phase1_smoke/{docId} {
      allow read, write: if true;
    }
    match /products/{docId} {
      allow read, write: if true;
    }
    match /sales/{docId} {
      allow read, write: if true;
    }
    match /expenses/{docId} {
      allow read, write: if true;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

If you no longer use Phase 1 smoke tests, you can omit that block when copying from the **full** `firestore.rules` (the root file already includes an optional `phase1_smoke` match).
