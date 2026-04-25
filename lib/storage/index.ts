import { env } from "@/lib/config/env";
import type { StorageProvider } from "./interface";
import { LocalStorageProvider } from "./providers/local";
import { GcsStorageProvider } from "./providers/gcs";
import { isGCSConfigured } from "@/lib/upload/gcsClient";

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (provider) return provider;

  const explicitProvider = env.GCS_BUCKET_NAME && env.GCS_PROJECT_ID ? "gcs" : "local";

  if (explicitProvider === "gcs" && isGCSConfigured()) {
    provider = new GcsStorageProvider();
    return provider;
  }

  provider = new LocalStorageProvider();
  return provider;
}

