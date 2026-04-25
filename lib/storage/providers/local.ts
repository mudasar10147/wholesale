import path from "path";
import { mkdir, writeFile, rm } from "fs/promises";
import type { StorageProvider, UploadInput, UploadResult } from "../interface";
import { EXT_MIME, UPLOAD_ALLOWED_TYPES, UPLOAD_MAX_BYTES } from "@/lib/upload/types";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  async upload(input: UploadInput): Promise<UploadResult> {
    const { file, category, ownerId, prefix } = input;

    if (file.size > UPLOAD_MAX_BYTES) {
      throw new Error(`${prefix}: file exceeds the 10 MB limit`);
    }

    const ext = path.extname(file.name).toLowerCase();
    const mimeType = file.type || EXT_MIME[ext] || "";

    if (!UPLOAD_ALLOWED_TYPES.includes(mimeType as (typeof UPLOAD_ALLOWED_TYPES)[number])) {
      throw new Error(`${prefix}: unsupported file type "${mimeType || "unknown"}"`);
    }

    const fileName = `${prefix}-${Date.now()}${ext || ".bin"}`;
    const diskDir = path.join(process.cwd(), "uploads", category, ownerId);
    await mkdir(diskDir, { recursive: true });
    await writeFile(path.join(diskDir, fileName), Buffer.from(await file.arrayBuffer()));

    return {
      fileName: file.name,
      path: path.join("uploads", category, ownerId, fileName),
      url: `/uploads/${category}/${ownerId}/${fileName}`,
      mimeType,
      size: file.size,
    };
  }

  async delete(filePath: string): Promise<boolean> {
    try {
      await rm(path.join(process.cwd(), filePath), { force: true });
      return true;
    } catch {
      return false;
    }
  }
}

