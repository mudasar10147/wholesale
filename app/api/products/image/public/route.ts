import path from "path";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getStorageProvider } from "@/lib/storage";
import { gcsStorageService } from "@/lib/upload/gcsStorage";
import { EXT_MIME } from "@/lib/upload/types";

export const runtime = "nodejs";

/**
 * Stored objects are written once under a unique timestamped name and never rewritten,
 * so a response for a given `path` is valid forever. `immutable` stops browsers and the
 * CDN from revalidating, and `s-maxage` keeps the edge copy for the same year — this
 * route previously advertised `max-age=300`, which meant every product photo was pulled
 * out of GCS again several times an hour.
 */
const IMMUTABLE_CACHE = "public, max-age=31536000, s-maxage=31536000, immutable";

function isSafeImagePath(filePath: string): boolean {
  if (!filePath || filePath.includes("..")) return false;
  return filePath.startsWith("products/") || filePath.startsWith("uploads/products/");
}

function imageResponse(buffer: Buffer, contentType: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": IMMUTABLE_CACHE,
    },
  });
}

/**
 * Public read proxy for product images.
 *
 * Two jobs: it gives the social planner's "Copy image" a same-origin fetch (a signed GCS
 * URL is cross-origin and the clipboard read fails), and it gives `next/image` a stable,
 * optimisable `src`. The optimiser derives and caches each rendered width from this, so
 * in steady state this handler runs roughly once per image per size — not once per view.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path")?.trim() ?? "";
    if (!isSafeImagePath(filePath)) {
      return NextResponse.json({ error: "Invalid image path." }, { status: 400 });
    }

    const provider = getStorageProvider();
    if (provider.name === "gcs") {
      const downloaded = await gcsStorageService.downloadByPath(filePath);
      if (!downloaded) {
        return NextResponse.json({ error: "Image not found." }, { status: 404 });
      }
      return imageResponse(downloaded.buffer, downloaded.contentType);
    }

    if (!filePath.startsWith("uploads/products/")) {
      return NextResponse.json({ error: "Invalid path." }, { status: 400 });
    }
    const diskPath = path.join(process.cwd(), filePath);
    const buffer = await readFile(diskPath);
    const ext = path.extname(filePath).toLowerCase();
    return imageResponse(buffer, EXT_MIME[ext] ?? "application/octet-stream");
  } catch {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
}
