"use client";

import { getAuthClient } from "@/lib/firebase";

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

export async function uploadProductImage(file: File): Promise<UploadedProductImage> {
  const token = await getBearerToken();
  const formData = new FormData();
  formData.set("file", file);
  const res = await fetch("/api/products/image/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  const data = (await res.json()) as UploadedProductImage & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not upload image.");
  }
  return data;
}

export async function getSignedProductImageUrl(filePath: string): Promise<string> {
  const token = await getBearerToken();
  const res = await fetch("/api/products/image/sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path: filePath }),
  });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? "Could not load image URL.");
  }
  return data.url;
}

export async function deleteProductImageByPath(filePath: string): Promise<boolean> {
  const token = await getBearerToken();
  const res = await fetch("/api/products/image/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path: filePath }),
  });
  const data = (await res.json()) as { deleted?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Could not delete image.");
  }
  return Boolean(data.deleted);
}
