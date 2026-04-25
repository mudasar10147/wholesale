import { NextResponse } from "next/server";
import { getStorageProvider } from "@/lib/storage";
import { gcsStorageService } from "@/lib/upload/gcsStorage";
import { verifyRequestAuth } from "@/lib/server/auth";

type SignBody = {
  path?: string;
};

function isSafeImagePath(filePath: string): boolean {
  if (!filePath || filePath.includes("..")) return false;
  return filePath.startsWith("products/") || filePath.startsWith("uploads/products/");
}

export async function POST(request: Request) {
  try {
    await verifyRequestAuth(request, false);
    const body = (await request.json()) as SignBody;
    const filePath = body.path?.trim() ?? "";
    if (!isSafeImagePath(filePath)) {
      return NextResponse.json({ error: "Invalid image path." }, { status: 400 });
    }

    const provider = getStorageProvider();
    if (provider.name === "gcs") {
      const signedUrl = await gcsStorageService.getSignedReadUrlByPath(filePath, 60);
      if (!signedUrl) {
        return NextResponse.json({ error: "Image not found." }, { status: 404 });
      }
      return NextResponse.json({ url: signedUrl });
    }

    const origin = new URL(request.url).origin;
    const localUrl = `${origin}/api/products/image/file?path=${encodeURIComponent(filePath)}`;
    return NextResponse.json({ url: localUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve image URL.";
    const status = /allowed|token|Missing/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
