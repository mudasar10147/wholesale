# Phase 1 — Firebase Console (manual steps)

Do these once per environment (local + production uses the same project or separate projects).

**If a step does not match your screen:** Firebase changes labels and grouping in the left sidebar (e.g. **Build** vs top-level product links). Use the **direct links** below once you know your **project ID** (see Project settings).

---

## 1. Create or open a project

1. Open [Firebase Console](https://console.firebase.google.com).
2. **Add project** (or select an existing project) and complete the wizard.

---

## 2. Enable Firestore

**Ways to open Cloud Firestore (pick one):**

- **Sidebar:** Look for **Firestore** or **Firestore Database**. It may sit under an expandable **Build** section, or appear as its own item—wording varies by console version and region.
- **Direct URL (replace `YOUR_PROJECT_ID`):**  
  `https://console.firebase.google.com/project/YOUR_PROJECT_ID/firestore`

Then:

1. If the database is not created yet, click **Create database**.
2. Choose a **location** (cannot be changed later for that database).
3. **Security rules for new databases:** you may see **Start in production mode** or **Start in test mode** (test mode allows open access for a limited time). Either is fine for first setup if you will **publish the rules in section 4** before relying on the app.

Official reference: [Manage Cloud Firestore in the console](https://firebase.google.com/docs/firestore/using-console) (uses paths like `/firestore/data`, `/firestore/rules`).

---

## 3. Register a web app and copy config

**Ways to open Project settings:**

- Click the **gear** next to **Project overview** → **Project settings**, **or**
- Click your **project name** in the top bar and choose **Project settings**.

Then:

1. Scroll to **Your apps** (or **General** tab).
2. If there is no web app yet: **Add app** → **Web** ( **`</>`** icon).
3. Register (nickname e.g. `wholesale-web`; App Hosting optional).
4. Copy the `firebaseConfig` values into **`.env.local`** (see [`.env.example`](../.env.example) in the repo root). Never commit `.env.local`.

---

## 4. Firestore security rules (Phase 1 smoke test)

The app writes to the **`phase1_smoke`** collection for connection testing. Without Firebase Authentication, you need rules that allow that collection only (development-style).

**Open the Rules editor:**

- In the Firestore area, open the **Rules** tab, **or** use (replace `YOUR_PROJECT_ID`):  
  `https://console.firebase.google.com/project/YOUR_PROJECT_ID/firestore/rules`

Example (Phase 1 only—**replace with stricter rules before production**):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /phase1_smoke/{docId} {
      allow read, write: if true;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Click **Publish** after editing.

If you used **test mode** when creating the database, rules may already allow temporary open access—still plan to move to explicit rules (or Auth-based rules) before production.

For **Phase 2** collections (`products`, `sales`, `expenses`), use the combined dev rules in [FIREBASE_RULES.md](FIREBASE_RULES.md) and publish those instead of the Phase 1–only block above when you start writing real data.

---

## 5. Vercel

In the Vercel project: **Settings** → **Environment Variables** → add the same `NEXT_PUBLIC_FIREBASE_*` keys as in `.env.local` for **Production** (and **Preview** if you want previews to talk to Firebase). Redeploy after saving.

---

## 6. Verify

1. Run `npm run dev` locally with `.env.local` filled.
2. Open the home page: the Firestore status line should show success.
3. Open **Firestore** → **Data** tab, or:  
   `https://console.firebase.google.com/project/YOUR_PROJECT_ID/firestore/data`  
   Confirm a document under **`phase1_smoke`**.

---

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| No **Build** menu | Use the **direct Firestore URL** in section 2 with your project ID. |
| Only see **Datastore** or Google Cloud | Use **Firebase** console links above, not only Google Cloud Console (Firestore is there too but paths differ). |
| **permission-denied** on localhost or production | Firestore rules are **per Firebase project**, not per URL. Publish the **full MVP rules** in [FIREBASE_RULES.md](FIREBASE_RULES.md) (or copy [`firestore.rules`](../firestore.rules) from the repo root)—Phase 1–only rules allow `phase1_smoke` only and **deny** `products` / `sales` / `expenses`. Also confirm `NEXT_PUBLIC_FIREBASE_PROJECT_ID` in `.env.local` matches the project where you published rules. |
| Cannot find **Web** app | **Project settings** → scroll to **Your apps** → **Add app** → **`</>`**. |
