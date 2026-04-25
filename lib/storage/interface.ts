export interface UploadInput {
  file: File;
  category: string;
  ownerId: string;
  prefix: string;
}

export interface UploadResult {
  fileName: string;
  path: string;
  url: string;
  mimeType: string;
  size: number;
}

export interface StorageProvider {
  readonly name: string;
  upload(input: UploadInput): Promise<UploadResult>;
  delete(path: string): Promise<boolean>;
}

