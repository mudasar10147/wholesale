# Firestore security rules

**Source of truth:** the repo root file [`firestore.rules`](../firestore.rules). Localhost uses the **same** Firebase project and **published** rules as production—there is no separate “local” permission layer.

## Authentication (required)

Firestore and the app distinguish:

- **Admin:** ID token includes **`admin: true`** (boolean or string `"true"`). Full access.
- **Clerk:** ID token includes **`role: "clerk"`** (string) and **no** `admin` claim. Limited access: customers, expenses, invoice **drafts** (create/edit/delete drafts), and read products for line items. Clerks **cannot** post or void invoices, edit products, use FIFO reports, or the main dashboard KPIs (those reads are admin-only in rules).

Uses Firebase Auth [custom claims](https://firebase.google.com/docs/auth/admin/custom-claims).

1. **Firebase Console** → **Authentication** → enable **Email/Password**.
2. Create a user (or use an existing account). Copy the user’s **UID** from the Users list.
3. Set claims using the Admin SDK (local scripts from the repo root; service account JSON: Project settings → Service accounts → Generate new private key):
   - **Admin:** [`scripts/set-admin-claim.cjs`](../scripts/set-admin-claim.cjs) sets `{ admin: true }` (replaces other custom claims on that user).
     - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/set-admin-claim.cjs <UID>`
   - **Clerk:** [`scripts/set-clerk-claim.cjs`](../scripts/set-clerk-claim.cjs) sets `{ role: "clerk" }` (replaces other custom claims; removes `admin` if present).
     - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/set-clerk-claim.cjs <UID>`
4. **Authorized domains**: Authentication → Settings → add your production domain (e.g. Vercel `*.vercel.app` and custom domain). Include `localhost` for dev.
5. **Publish** `firestore.rules` after you can sign in (or use the Rules Playground first). Users without `admin` or `role: "clerk"` cannot use the app.
6. After setting or changing claims, the user must **sign out and sign in again** so the client picks up the new token (the app refreshes claims on auth state change with `getIdToken(true)`).

The Next.js app uses **Email/Password** sign-in on [`/login`](../app/login/page.tsx); the dashboard is behind `RequireAdmin`, which allows **admin or clerk** (`hasAppAccess`).

## One-time inventory lot backfill (admin script)

Use this when existing products have `stock_quantity` but missing lots (`sum(qty_remaining)` is lower).

- Script: [`scripts/backfill-opening-lots.cjs`](../scripts/backfill-opening-lots.cjs)
- Behavior:
  - Finds products where `stock_quantity > sum(lot.qty_remaining)`.
  - Creates one `stock_lots` row per product with:
    - `source: "opening_balance"`
    - `qty_in = gap`
    - `qty_remaining = gap`
    - `unit_cost = product.cost_price`
    - `reference_id = backfill tag`
  - Does **not** change `products.stock_quantity`.
  - Skips anomalies where `sum(lots) > stock_quantity` and logs them for manual review.

### Commands

1. **Dry run (default, no writes):**
   - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/backfill-opening-lots.cjs`
2. **Apply writes:**
   - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json node scripts/backfill-opening-lots.cjs --apply`
3. **Optional flags:**
   - `--project <projectId>`
   - `--tag <referenceTag>`
   - `--limit <N>`

### Safety notes

- Run dry-run first and review candidate/anomaly output before `--apply`.
- Re-running with the same `--tag` is idempotent (script skips products already backfilled with that tag).
- Because source is `opening_balance`, this backfill does **not** inflate stock purchase cash-outflow (`source: stock_in` only).

### Rollback guidance

- If you need to revert this run, delete only lots with:
  - `source == "opening_balance"` and
  - `reference_id == <backfill tag used>`
- After deletion, verify per affected product:
  - Lots modal `Sum of lots`
  - Product `stock_quantity` (unchanged by this script)

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

Rules use **`isAdmin()`** for full access and **`isStaff()`** (`isAdmin() || isClerk()`) where clerks are allowed—e.g. read `products`, read/write `expenses`, read/write `customers` and draft `invoices` / `invoice_items`. Posting invoices and inventory collections remain **`isAdmin()`** only. See `isClerk()` and `isStaff()` in [`firestore.rules`](../firestore.rules).

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
