import path from "node:path";
import { NextResponse } from "next/server";
import { saveFile } from "@/lib/upload/saveFile";
import { optimizeUploadedImageFile } from "@/lib/upload/imageProcessing";
import { EXT_MIME } from "@/lib/upload/types";
import { verifyRequestAuth } from "@/lib/server/auth";

/** sharp needs the Node runtime; the edge runtime cannot load its native binary. */
export const runtime = "nodejs";

function resolveMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = path.extname(file.name).toLowerCase();
  return EXT_MIME[ext] ?? "";
}

export async function POST(request: Request) {
  try {
    const { uid } = await verifyRequestAuth(request, true);
    const formData = await request.formData();
    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: "Please choose an image file." }, { status: 400 });
    }

    const mimeType = resolveMimeType(fileEntry);

    // Re-encode to a bounded WebP before it ever reaches storage, so every later read
    // is cheap. Originals are never stored — see lib/upload/imageProcessing.ts.
    const { file: prepared, result } = await optimizeUploadedImageFile(fileEntry, mimeType);

    // HEIC that sharp could not decode would be stored as-is and then fail to render in
    // every browser. Fail loudly at upload instead of writing an unviewable product photo.
    if (!result.optimized && /^image\/(heic|heif)$/i.test(mimeType)) {
      return NextResponse.json(
        {
          error:
            "This iPhone HEIC photo could not be converted. Open it in Photos and export as JPEG, then upload again.",
        },
        { status: 400 },
      );
    }

    const saved = await saveFile(prepared, {
      category: "products",
      ownerId: uid,
      prefix: "product-image",
    });

    return NextResponse.json({
      fileName: fileEntry.name,
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
