import path from "path";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getStorageProvider } from "@/lib/storage";
import { gcsStorageService } from "@/lib/upload/gcsStorage";
import { EXT_MIME } from "@/lib/upload/types";

function isSafeImagePath(filePath: string): boolean {
  if (!filePath || filePath.includes("..")) return false;
  return filePath.startsWith("products/") || filePath.startsWith("uploads/products/");
}

/** Public read proxy for product images (same-origin fetch for clipboard copy on /whatsapp-post). */
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
      return new NextResponse(new Uint8Array(downloaded.buffer), {
        headers: {
          "Content-Type": downloaded.contentType,
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    if (!filePath.startsWith("uploads/products/")) {
      return NextResponse.json({ error: "Invalid path." }, { status: 400 });
    }
    const diskPath = path.join(process.cwd(), filePath);
    const buffer = await readFile(diskPath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = EXT_MIME[ext] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
}
