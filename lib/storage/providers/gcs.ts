import type { StorageProvider, UploadInput, UploadResult } from "../interface";
import { gcsStorageService } from "@/lib/upload/gcsStorage";

export class GcsStorageProvider implements StorageProvider {
  readonly name = "gcs";

  async upload(input: UploadInput): Promise<UploadResult> {
    const result = await gcsStorageService.uploadFileForApp(input.file, {
      category: input.category,
      ownerId: input.ownerId,
      prefix: input.prefix,
    });

    return {
      fileName: result.fileName,
      path: result.path,
      url: result.url,
      mimeType: result.mimeType,
      size: result.size,
    };
  }

  async delete(filePath: string): Promise<boolean> {
    return gcsStorageService.deleteByPath(filePath);
  }
}

