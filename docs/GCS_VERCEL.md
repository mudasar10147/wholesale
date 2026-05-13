# Google Cloud Storage on Vercel (service account JSON)

This app uses `@google-cloud/storage` with `getGCSClient()` in `lib/upload/gcsClient.ts`.

- **Local:** You can use `GOOGLE_APPLICATION_CREDENTIALS` pointing at a downloaded key file and omit `GCS_SERVICE_ACCOUNT_JSON`.
- **Vercel (serverless):** There is no stable path to a key file. Set **`GCS_SERVICE_ACCOUNT_JSON`** to the **entire** service account JSON as a single environment variable (Sensitive in Vercel). The client is built with `new Storage({ projectId, credentials: { client_email, private_key } })` after `JSON.parse`.

## 1. GCP: bucket and service account

1. In [Google Cloud Console](https://console.cloud.google.com/), pick the project whose ID you will use as **`GCS_PROJECT_ID`**.
2. Enable **Cloud Storage API** for that project.
3. Create or choose a bucket; its name is **`GCS_BUCKET_NAME`**.
4. Create a **service account** (IAM & Admin → Service accounts → Create). Give it a clear name, e.g. `vercel-wholesale-gcs`.
5. Grant the account access to the bucket, e.g. **Storage Object Admin** on that bucket (or a narrower custom role if you prefer).
6. Open the service account → **Keys** → **Add key** → **JSON**. Download the file once. It contains `type`, `project_id`, `private_key`, `client_email`, etc.

Treat this file like a password. Do not commit it.

## 2. Vercel: environment variables

In the Vercel project: **Settings → Environment Variables**.

Add for **Production** (and **Preview** / **Development** if you want uploads there too):

| Name | Sensitive | Value |
|------|-----------|--------|
| `GCS_PROJECT_ID` | No | GCP project id (string, e.g. `my-project-123`). |
| `GCS_BUCKET_NAME` | No | Bucket name only (no `gs://`). |
| `GCS_SERVICE_ACCOUNT_JSON` | **Yes** | Full contents of the downloaded JSON file. |

**Pasting the JSON**

- Prefer **one line** (minified) to avoid copy/paste line-break issues: e.g. `jq -c . your-key.json` and paste the output.
- The `private_key` field often contains `\n` escape sequences inside the string; that is valid JSON and the code normalizes newlines for the Node client.
- Do **not** prefix this variable with `NEXT_PUBLIC_` — it must never be exposed to the browser.

Redeploy after saving variables (Vercel → Deployments → Redeploy, or push a commit).

## 3. Optional: local parity with production

In `.env.local` you can set the same three variables instead of `GOOGLE_APPLICATION_CREDENTIALS`. Keep `.env.local` out of git (it usually is via `.gitignore`).

## 4. Alternative (not implemented here): `/tmp` + `GOOGLE_APPLICATION_CREDENTIALS`

Some teams write the JSON to a temp file at cold start and set `GOOGLE_APPLICATION_CREDENTIALS` to that path. It works on Vercel’s ephemeral filesystem but adds file IO and lifecycle handling; passing `credentials` to `Storage` is simpler for this repo.

## 5. Smoke test

With `.env.local` configured, from the repo root:

```bash
npm run test:gcs
```

`scripts/test-gcs-upload.mjs` mirrors the app: it uses **`GCS_SERVICE_ACCOUNT_JSON`** when set (same shape as Vercel), otherwise **`GOOGLE_APPLICATION_CREDENTIALS`** and `new Storage({ projectId })` with ADC. Put JSON on **one line** in `.env.local` so the simple line parser can read it (`jq -c . key.json` → paste after `GCS_SERVICE_ACCOUNT_JSON=`).
