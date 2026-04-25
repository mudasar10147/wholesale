import { NextResponse } from "next/server";
import { saveFile } from "@/lib/upload/saveFile";
import { verifyRequestAuth } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const { uid } = await verifyRequestAuth(request, true);
    const formData = await request.formData();
    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: "Please choose an image file." }, { status: 400 });
    }

    const saved = await saveFile(fileEntry, {
      category: "products",
      ownerId: uid,
      prefix: "product-image",
    });

    return NextResponse.json({
      fileName: saved.fileName,
      path: saved.path,
      url: saved.url,
      mimeType: saved.mimeType,
      size: saved.size,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload image.";
    const status = /allowed|token|Missing|not allowed/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
