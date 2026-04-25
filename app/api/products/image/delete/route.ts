import { NextResponse } from "next/server";
import { getStorageProvider } from "@/lib/storage";
import { verifyRequestAuth } from "@/lib/server/auth";

type DeleteBody = {
  path?: string;
};

function isSafeImagePath(filePath: string): boolean {
  if (!filePath || filePath.includes("..")) return false;
  return filePath.startsWith("products/") || filePath.startsWith("uploads/products/");
}

export async function POST(request: Request) {
  try {
    await verifyRequestAuth(request, true);
    const body = (await request.json()) as DeleteBody;
    const filePath = body.path?.trim() ?? "";
    if (!isSafeImagePath(filePath)) {
      return NextResponse.json({ error: "Invalid image path." }, { status: 400 });
    }
    const deleted = await getStorageProvider().delete(filePath);
    return NextResponse.json({ deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete image.";
    const status = /allowed|token|Missing/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
