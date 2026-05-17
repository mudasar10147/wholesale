const DUMMY_IMAGE_PATH = "/wholesale_logo.png";

export function publicProductImageApiUrl(imagePath: string): string {
  return `/api/products/image/public?path=${encodeURIComponent(imagePath.trim())}`;
}

/** Prefer same-origin proxy (GCS path) so fetch + clipboard work on public pages. */
export function resolveProductImageSrc(imagePath?: string, imageUrl?: string): string {
  const path = imagePath?.trim();
  if (path) return publicProductImageApiUrl(path);
  const url = imageUrl?.trim();
  if (url) return url;
  return DUMMY_IMAGE_PATH;
}

export async function ensurePngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!png) throw new Error("Could not encode image.");
    return png;
  } finally {
    bitmap.close();
  }
}

export async function fetchImageBlob(src: string): Promise<Blob> {
  const absolute = src.startsWith("/") ? new URL(src, window.location.origin).href : src;
  const res = await fetch(absolute);
  if (!res.ok) throw new Error("Image fetch failed.");
  const blob = await res.blob();
  const type = blob.type.startsWith("image/")
    ? blob.type
    : res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  if (blob.type === type) return blob;
  return new Blob([await blob.arrayBuffer()], { type });
}

/** Fallback when cross-origin fetch is blocked but the bucket allows CORS on img. */
export function loadImageBlobViaCanvas(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable."));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image."))), "image/png");
    };
    img.onerror = () => reject(new Error("Image load failed."));
    img.src = src.startsWith("/") ? new URL(src, window.location.origin).href : src;
  });
}

export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard image copy is not supported in this browser.");
  }
  const png = await ensurePngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
