/**
 * Server-only file saving utility.
 * Saves an uploaded File to disk or GCS (when configured) and returns storable metadata.
 *
 * Disk:  {cwd}/uploads/{category}/{ownerId}/{prefix}-{timestamp}{ext}
 * GCS:   {category}/{ownerId}/{prefix}-{timestamp}{ext} in bucket
 *
 * Usage:
 *   import { saveFile } from '@/lib/upload/saveFile'
 *   const meta = await saveFile(file, { category: 'manufacturers', ownerId: userId, prefix: 'business-license' })
 */
import path from 'path'
import { writeFile, mkdir } from 'fs/promises'
import { isGCSConfigured } from './gcsClient'
import { gcsStorageService } from './gcsStorage'
import type { SavedFile, SaveFileOptions } from './types'
import { getStorageProvider } from '@/lib/storage'
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_ALLOWED_TYPES,
  EXT_MIME,
} from './types'

export { UPLOAD_MAX_BYTES, UPLOAD_ALLOWED_TYPES }
export type { SavedFile, SaveFileOptions }

export async function saveFile(file: File, opts: SaveFileOptions): Promise<SavedFile> {
  // Prefer the new storage provider abstraction for reusable starter behavior.
  const provider = getStorageProvider()
  if (provider.name !== 'gcs' || (isGCSConfigured() && gcsStorageService.isAvailable())) {
    try {
      const uploaded = await provider.upload({
        file,
        category: opts.category,
        ownerId: opts.ownerId,
        prefix: opts.prefix,
      })
      return uploaded
    } catch (err) {
      console.warn('[saveFile] provider upload failed, trying legacy flow:', err instanceof Error ? err.message : err)
    }
  }

  if (isGCSConfigured() && gcsStorageService.isAvailable()) {
    try {
      return await gcsStorageService.uploadFileForApp(file, opts)
    } catch (err) {
      console.warn('[saveFile] GCS upload failed, falling back to local disk:', err instanceof Error ? err.message : err)
    }
  }

  const { category, ownerId, prefix } = opts
  const apiBase = opts.apiBase ?? `/api/${category}/documents`

  if (file.size > UPLOAD_MAX_BYTES) {
    throw new Error(`${prefix}: file exceeds the 10 MB limit`)
  }

  const ext = path.extname(file.name).toLowerCase()
  const mimeType = file.type || EXT_MIME[ext] || ''

  if (!UPLOAD_ALLOWED_TYPES.includes(mimeType as (typeof UPLOAD_ALLOWED_TYPES)[number])) {
    throw new Error(
      `${prefix}: must be a JPEG, PNG, WebP, HEIC, HEIF, or PDF (received "${mimeType || 'unknown type'}")`
    )
  }

  const fileName = `${prefix}-${Date.now()}${ext || '.bin'}`
  const dir = path.join(process.cwd(), 'uploads', category, ownerId)

  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, fileName), Buffer.from(await file.arrayBuffer()))

  return {
    fileName: file.name,
    path: path.join('uploads', category, ownerId, fileName),
    url: `${apiBase}/${ownerId}/${prefix}`,
    mimeType,
    size: file.size,
  }
}
