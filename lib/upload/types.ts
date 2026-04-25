/**
 * Shared types and constants for upload (disk and GCS).
 * Used by saveFile.ts and gcsStorage.ts to avoid circular deps.
 */

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
export const UPLOAD_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const

export const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
}

export interface SavedFile {
  fileName: string // original filename from the browser
  path: string // storage path (disk path or GCS object path)
  url: string // URL to retrieve the file (API route or signed/public URL)
  mimeType: string
  size: number // bytes
}

export interface SaveFileOptions {
  category: string // e.g. 'plates', 'manufacturers', 'manufacturer-production'
  ownerId: string // userId or similar
  prefix: string // e.g. 'personal-id', 'business-license'
  apiBase?: string // API URL base when using app proxy (default: /api/{category}/documents)
}
