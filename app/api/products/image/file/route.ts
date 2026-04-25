import path from "path";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { EXT_MIME } from "@/lib/upload/types";

function normalizeLocalPath(rawPath: string | null): string | null {
  if (!rawPath) return null;
  const input = rawPath.trim();
  if (!input || input.includes("..")) return null;
  if (!input.startsWith("uploads/products/")) return null;
  return input;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filePath = normalizeLocalPath(url.searchParams.get("path"));
    if (!filePath) {
      return NextResponse.json({ error: "Invalid path." }, { status: 400 });
    }
    const diskPath = path.join(process.cwd(), filePath);
    const buffer = await readFile(diskPath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = EXT_MIME[ext] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
}
