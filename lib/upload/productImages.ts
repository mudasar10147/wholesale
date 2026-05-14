"use client";

import { getAuthClient } from "@/lib/firebase";
import { maybeCompressProductImage, VERCEL_SAFE_UPLOAD_MAX_BYTES } from "@/lib/upload/compressImageForUpload";

export type UploadedProductImage = {
  fileName: string;
  path: string;
  url: string;
  mimeType: string;
  size: number;
};

async function getBearerToken(): Promise<string> {
  const user = getAuthClient().currentUser;
  if (!user) {
    throw new Error("Please sign in again.");
  }
  return user.getIdToken();
}

/**
 * Read JSON from an API response without using `Response.json()`.
 * Safari/WebKit often surfaces JSON parse failures as
 * "The string did not match the expected pattern" when the body is HTML or empty.
 */
async function readJsonApiResponse<T extends Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      res.ok
        ? "Empty response from server."
        : `Request failed (${res.status}). Empty response from server.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const hint = trimmed.slice(0, 200).replace(/\s+/g, " ");
    throw new Error(
      `Server returned invalid JSON (HTTP ${res.status}). This often means a proxy or error page returned HTML instead of an API response. Start of body: ${hint}${trimmed.length > 200 ? "…" : ""}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Server returned unexpected JSON (HTTP ${res.status}).`);
  }
  return parsed as T;
}

function apiUrl(path: string): string {
  if (typeof window === "undefined") {
    return path;
  }
  return new URL(path, window.location.origin).toString();
}

export async function uploadProductImage(file: File): Promise<UploadedProductImage> {
  const prepared = await maybeCompressProductImage(file);
  if (prepared.size > VERCEL_SAFE_UPLOAD_MAX_BYTES) {
    const mb = (prepared.size / (1024 * 1024)).toFixed(1);
    const hint =
      /^image\/(heic|heif)$/i.test(file.type) || /^image\/(heic|heif)$/i.test(prepared.type)
        ? " iPhone HEIC files often cannot be shrunk in the browser here—export as JPEG in Photos first, or use a smaller file."
        : " Try exporting a smaller JPEG or crop the photo.";
    throw new Error(
      `This image is still about ${mb} MB after compression. Hosting limits uploads to roughly 4.5 MB.${hint}`,
    );
  }

  const token = await getBearerToken();
  const formData = new FormData();
  formData.set("file", prepared);
  const res = await fetch(apiUrl("/api/products/image/upload"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  if (res.status === 413) {
    throw new Error(
      "Upload rejected: file too large for the server (HTTP 413). The image was compressed automatically; try a smaller original or export as JPEG.",
    );
  }
  const data = await readJsonApiResponse<UploadedProductImage & { error?: string }>(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" && data.error.length > 0
        ? data.error
        : `Could not upload image (${res.status}).`,
    );
  }
  if (
    typeof data.path !== "string" ||
    !data.path ||
    typeof data.url !== "string" ||
    !data.url ||
    typeof data.fileName !== "string" ||
    typeof data.mimeType !== "string" ||
    typeof data.size !== "number"
  ) {
    throw new Error("Upload succeeded but the server response was missing required fields.");
  }
  return {
    fileName: data.fileName,
    path: data.path,
    url: data.url,
    mimeType: data.mimeType,
    size: data.size,
  };
}

export async function getSignedProductImageUrl(filePath: string): Promise<string> {
  const token = await getBearerToken();
  const res = await fetch(apiUrl("/api/products/image/sign"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path: filePath }),
  });
  const data = await readJsonApiResponse<{ url?: string; error?: string }>(res);
  if (!res.ok || typeof data.url !== "string" || !data.url) {
    throw new Error(
      typeof data.error === "string" && data.error.length > 0
        ? data.error
        : "Could not load image URL.",
    );
  }
  return data.url;
}

export async function deleteProductImageByPath(filePath: string): Promise<boolean> {
  const token = await getBearerToken();
  const res = await fetch(apiUrl("/api/products/image/delete"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path: filePath }),
  });
  const data = await readJsonApiResponse<{ deleted?: boolean; error?: string }>(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" && data.error.length > 0
        ? data.error
        : "Could not delete image.",
    );
  }
  return Boolean(data.deleted);
}
