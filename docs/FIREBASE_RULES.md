# Firestore security rules (development examples)

The repo root file [`firestore.rules`](../firestore.rules) matches the rules below. Copy either into **Firebase Console** → **Firestore** → **Rules** → **Publish** (rules apply to **all** clients, including `localhost`; there is no separate “local” permission).

These rules are for **development / MVP** only. Replace with **Firebase Authentication**-backed checks (and least privilege) before production. See [Phase 9 in PHASE_PLAN.md](PHASE_PLAN.md).

## Phase 1 smoke test + Phase 2 collections

Allows read/write on:

- `phase1_smoke` — Phase 1 connection test (optional once you remove that feature)
- `products`, `sales`, `expenses` — MVP collections per [PHASE2_SCHEMA.md](PHASE2_SCHEMA.md)

All other paths are denied.

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

If you no longer use Phase 1 smoke tests, delete the `phase1_smoke` block and keep the rest.

## Tightening later

- Require `request.auth != null` and map users to roles (Owner / Worker).
- Validate field shapes with `request.resource.data` where practical.
- Prefer smaller `match` scopes over `if true` for each collection.
