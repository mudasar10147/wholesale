import { Storage } from '@google-cloud/storage';
import { getGCSClient, getGCSBucketName, isGCSConfigured } from './gcsClient';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { logger } from '../utils/logger';
import type { SaveFileOptions, SavedFile } from './types';
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_ALLOWED_TYPES,
  EXT_MIME,
} from './types';

// Web API File type (from FormData / multipart)
type WebFile = File;

/** Path types: profile (user), logo/content (brand). Video reserved for later. */
export type GCSPathType = 'profile' | 'logo' | 'content' | 'video';

export interface GCSUploadResult {
  success: boolean;
  url?: string | undefined;
  filename?: string | undefined;
  size?: number | undefined;
  error?: string | undefined;
}

export interface GCSUploadOptions {
  maxSize?: number | undefined;
  allowedTypes?: string[] | undefined;
  quality?: number | undefined;
}

/** Extracted path info for deletion; either user-scoped or brand-scoped. */
export interface GCSPathInfo {
  userId?: string;
  orgId?: string;
  brandId?: string;
  type: GCSPathType;
  filename: string;
}

/**
 * GCS Storage Service — Social Media Content Manager
 *
 * Bucket layout (User → Organization → Brand → Content):
 *   users/{userId}/profile/   — User avatar
 *   organizations/{orgId}/brands/{brandId}/logo/   — Brand logo
 *   organizations/{orgId}/brands/{brandId}/content/   — Post/content media (static images now)
 */
export class GCSStorageService {
  private storage: Storage | null;
  private bucketName: string | null;

  constructor() {
    this.storage = getGCSClient();
    this.bucketName = getGCSBucketName();
  }

  isAvailable(): boolean {
    return isGCSConfigured() && this.storage !== null && this.bucketName !== null;
  }

  generateFileName(originalName: string, prefixId: string): string {
    const ext = path.extname(originalName).toLowerCase() || '.bin';
    const uuid = uuidv4();
    const timestamp = Date.now();
    return `${prefixId}_${timestamp}_${uuid}${ext}`;
  }

  /** User-scoped path: profile only. */
  private getFilePath(userId: string, type: 'profile', filename: string): string {
    return `users/${userId}/profile/${filename}`;
  }

  /** Brand-scoped path: logo or content. */
  getFilePathForBrand(orgId: string, brandId: string, type: 'logo' | 'content', filename: string): string {
    return `organizations/${orgId}/brands/${brandId}/${type}/${filename}`;
  }

  /**
   * Protect A Plate path layout: {category}/{ownerId}/{filename}
   * e.g. plates/userId123/personal-id-1709123456789.pdf
   */
  private getAppFilePath(category: string, ownerId: string, filename: string): string {
    return `${category}/${ownerId}/${filename}`;
  }

  /**
   * Internal: upload buffer to GCS at objectPath, return read URL (signed or public).
   */
  private async uploadBufferToPath(
    buffer: Buffer,
    objectPath: string,
    contentType: string,
    meta?: { originalName?: string; uploadedBy?: string }
  ): Promise<{ url: string }> {
    const bucket = this.storage!.bucket(this.bucketName!);
    const gcsFile = bucket.file(objectPath);
    await gcsFile.save(buffer, {
      metadata: {
        contentType,
        cacheControl: 'public, max-age=31536000',
        metadata: {
          ...(meta?.originalName && { originalName: meta.originalName }),
          ...(meta?.uploadedBy && { uploadedBy: meta.uploadedBy }),
          uploadedAt: new Date().toISOString(),
        },
      },
    });
    const [exists] = await gcsFile.exists();
    if (!exists) {
      throw new Error('File upload verification failed: file does not exist after upload');
    }
    const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${objectPath}`;
    try {
      const [signedUrl] = await gcsFile.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
      });
      return { url: signedUrl };
    } catch {
      logger.debug('Using public URL (signed URL generation failed)', { publicUrl });
      return { url: publicUrl };
    }
  }

  /**
   * Upload a file for Protect A Plate: validates, uploads to GCS, returns SavedFile.
   * Path layout: {category}/{ownerId}/{prefix}-{timestamp}{ext}
   */
  async uploadFileForApp(file: File, opts: SaveFileOptions): Promise<SavedFile> {
    if (!this.isAvailable()) {
      throw new Error('GCS is not configured or unavailable');
    }
    const { category, ownerId, prefix } = opts;

    if (file.size > UPLOAD_MAX_BYTES) {
      throw new Error(`${prefix}: file exceeds the 10 MB limit`);
    }
    const ext = path.extname(file.name).toLowerCase();
    const mimeType = file.type || EXT_MIME[ext] || '';
    if (!UPLOAD_ALLOWED_TYPES.includes(mimeType as (typeof UPLOAD_ALLOWED_TYPES)[number])) {
      throw new Error(`${prefix}: must be a JPEG, PNG, WebP, or PDF (received "${mimeType || 'unknown type'}")`);
    }

    const filename = `${prefix}-${Date.now()}${ext || '.bin'}`;
    const objectPath = this.getAppFilePath(category, ownerId, filename);
    const buffer = Buffer.from(await file.arrayBuffer());

    const { url } = await this.uploadBufferToPath(buffer, objectPath, mimeType, {
      originalName: file.name,
      uploadedBy: ownerId,
    });

    logger.info('GCS app upload successful', { url: url.substring(0, 80), objectPath, size: file.size });

    return {
      fileName: file.name,
      path: objectPath,
      url,
      mimeType,
      size: file.size,
    };
  }

  /**
   * Delete an object from GCS by its storage path (e.g. plates/userId/personal-id-123.pdf).
   */
  async deleteByPath(gcsObjectPath: string): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.warn('GCS not available, cannot delete file');
      return false;
    }
    try {
      const bucket = this.storage!.bucket(this.bucketName!);
      const gcsFile = bucket.file(gcsObjectPath);
      const [exists] = await gcsFile.exists();
      if (!exists) return false;
      await gcsFile.delete();
      return true;
    } catch (error) {
      logger.error('GCS deleteByPath error', { err: error });
      return false;
    }
  }

  async getSignedReadUrlByPath(
    gcsObjectPath: string,
    expiresInMinutes: number = 60
  ): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      const bucket = this.storage!.bucket(this.bucketName!);
      const gcsFile = bucket.file(gcsObjectPath);
      const [exists] = await gcsFile.exists();
      if (!exists) return null;
      const [signedUrl] = await gcsFile.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      });
      return signedUrl;
    } catch (error) {
      logger.error('GCS getSignedReadUrlByPath error', { err: error });
      return null;
    }
  }

  async validateFile(file: WebFile, options: GCSUploadOptions): Promise<{ valid: boolean; error?: string }> {
    if (options.maxSize && file.size > options.maxSize) {
      return {
        valid: false,
        error: `File size exceeds limit of ${Math.round(options.maxSize / (1024 * 1024))}MB`,
      };
    }
    if (options.allowedTypes && !options.allowedTypes.includes(file.type)) {
      return {
        valid: false,
        error: `File type ${file.type} is not allowed. Allowed types: ${options.allowedTypes.join(', ')}`,
      };
    }
    return { valid: true };
  }

  async uploadFile(
    file: WebFile,
    userId: string,
    type: 'profile',
    options: GCSUploadOptions = {}
  ): Promise<GCSUploadResult> {
    if (!this.isAvailable()) {
      return { success: false, error: 'GCS is not configured or unavailable' };
    }

    try {
      const validation = await this.validateFile(file, options);
      if (!validation.valid) {
        return { success: false, error: validation.error ?? 'Validation failed' };
      }

      const filename = this.generateFileName(file.name, userId);
      const filePath = this.getFilePath(userId, 'profile', filename);
      const bucket = this.storage!.bucket(this.bucketName!);
      const gcsFile = bucket.file(filePath);

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      await gcsFile.save(buffer, {
        metadata: {
          contentType: file.type,
          cacheControl: 'public, max-age=31536000',
          metadata: {
            originalName: file.name,
            uploadedBy: userId,
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      const [exists] = await gcsFile.exists();
      if (!exists) {
        logger.error('File upload verification failed: file does not exist after upload');
        return { success: false, error: 'File upload verification failed' };
      }

      const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
      let finalUrl = publicUrl;
      try {
        const [signedUrl] = await gcsFile.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
        });
        finalUrl = signedUrl;
      } catch {
        logger.debug('Using public URL (signed URL generation failed)', { publicUrl });
      }

      logger.info('GCS upload successful', { url: finalUrl, filename, size: file.size, filePath });

      return {
        success: true,
        url: finalUrl,
        filename,
        size: file.size,
      };
    } catch (error) {
      let errorMessage: string = 'Failed to upload file to GCS';
      if (error instanceof Error) {
        errorMessage = error.message;
        if (error.message.includes('permission') || error.message.includes('access')) {
          errorMessage = 'GCS permission error: Check service account permissions and bucket IAM settings';
        } else if (error.message.includes('bucket')) {
          errorMessage = 'GCS bucket error: Check bucket name and existence';
        } else if (error.message.includes('credentials')) {
          errorMessage = 'GCS credentials error: Check service account key file';
        }
      }
      logger.error('GCS upload error', { err: error });
      return { success: false, error: errorMessage };
    }
  }

  async deleteFile(userId: string, type: 'profile', filename: string): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.warn('GCS not available, cannot delete file');
      return false;
    }

    try {
      const filePath = this.getFilePath(userId, 'profile', filename);
      const bucket = this.storage!.bucket(this.bucketName!);
      const gcsFile = bucket.file(filePath);

      const [exists] = await gcsFile.exists();
      if (!exists) {
        return false;
      }

      await gcsFile.delete();
      return true;
    } catch (error) {
      logger.error('GCS delete error', { err: error });
      return false;
    }
  }

  async deleteFileForBrand(orgId: string, brandId: string, type: 'logo' | 'content', filename: string): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.warn('GCS not available, cannot delete file');
      return false;
    }

    try {
      const filePath = this.getFilePathForBrand(orgId, brandId, type, filename);
      const bucket = this.storage!.bucket(this.bucketName!);
      const gcsFile = bucket.file(filePath);

      const [exists] = await gcsFile.exists();
      if (!exists) {
        return false;
      }

      await gcsFile.delete();
      return true;
    } catch (error) {
      logger.error('GCS delete error', { err: error });
      return false;
    }
  }

  extractFilename(url: string): string | null {
    try {
      const urlParts = url.split('/');
      const last = urlParts[urlParts.length - 1];
      return last ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Generate a signed URL for direct (client-side) upload — user profile.
   * Frontend PUTs the file to uploadUrl, then calls confirm with publicUrl.
   */
  async generateSignedUploadUrlForProfile(
    userId: string,
    filename: string,
    contentType: string,
    expiresInMinutes: number = 15
  ): Promise<{ uploadUrl: string; publicUrl: string } | null> {
    if (!this.isAvailable()) return null;
    try {
      const filePath = this.getFilePath(userId, 'profile', filename);
      const bucket = this.storage!.bucket(this.bucketName!);
      const gcsFile = bucket.file(filePath);
      const [uploadUrl] = await gcsFile.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + expiresInMinutes * 60 * 1000,
        contentType,
      });
      const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
      return { uploadUrl, publicUrl };
    } catch (error) {
      logger.error('GCS signed upload URL (profile) error', { err: error });
      return null;
    }
  }

  /**
   * Generate a signed URL for direct (client-side) upload — brand logo or content.
   */
  async generateSignedUploadUrlForBrand(
    orgId: string,
    brandId: string,
    type: 'logo' | 'content',
    filename: string,
    contentType: string,
    expiresInMinutes: number = 15
  ): Promise<{ uploadUrl: string; publicUrl: string } | null> {
    if (!this.isAvailable()) return null;
    try {
      const filePath = this.getFilePathForBrand(orgId, brandId, type, filename);
      const bucket = this.storage!.bucket(this.bucketName!);
      const gcsFile = bucket.file(filePath);
      const [uploadUrl] = await gcsFile.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + expiresInMinutes * 60 * 1000,
        contentType,
      });
      const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
      return { uploadUrl, publicUrl };
    } catch (error) {
      logger.error('GCS signed upload URL (brand) error', { err: error });
      return null;
    }
  }

  /** Parse GCS URL into path info for deletion. Handles user profile and brand logo/content. */
  extractPathInfo(url: string): GCSPathInfo | null {
    try {
      const userMatch = url.match(/users\/([^/]+)\/profile\/(.+)$/);
      if (userMatch && userMatch[1] !== undefined && userMatch[2] !== undefined) {
        return {
          userId: userMatch[1],
          type: 'profile',
          filename: userMatch[2],
        };
      }
      const brandMatch = url.match(/organizations\/([^/]+)\/brands\/([^/]+)\/(logo|content)\/(.+)$/);
      if (brandMatch && brandMatch[1] !== undefined && brandMatch[2] !== undefined && brandMatch[3] !== undefined && brandMatch[4] !== undefined) {
        return {
          orgId: brandMatch[1],
          brandId: brandMatch[2],
          type: brandMatch[3] as 'logo' | 'content',
          filename: brandMatch[4],
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    userId: string,
    type: 'profile',
    filename: string,
    contentType: string
  ): Promise<GCSUploadResult> {
    if (!this.isAvailable()) {
      return { success: false, error: 'GCS is not configured or unavailable' };
    }
    if (!buffer || buffer.length === 0) {
      return { success: false, error: 'Buffer is empty' };
    }

    try {
      const filePath = this.getFilePath(userId, 'profile', filename);
      const bucket = this.storage!.bucket(this.bucketName!);
      const gcsFile = bucket.file(filePath);

      await gcsFile.save(buffer, {
        metadata: {
          contentType,
          cacheControl: 'public, max-age=31536000',
          metadata: {
            uploadedBy: userId,
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      const [exists] = await gcsFile.exists();
      if (!exists) {
        logger.error('File upload verification failed: file does not exist after upload');
        return { success: false, error: 'File upload verification failed' };
      }

      const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
      let finalUrl = publicUrl;
      try {
        const [signedUrl] = await gcsFile.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
        });
        finalUrl = signedUrl;
      } catch {
        logger.debug('Using public URL (signed URL generation failed)', { publicUrl });
      }

      return {
        success: true,
        url: finalUrl,
        filename,
        size: buffer.length,
      };
    } catch (error) {
      let errorMessage: string = 'Failed to upload buffer to GCS';
      if (error instanceof Error) {
        errorMessage = error.message;
        if (error.message.includes('permission') || error.message.includes('access')) {
          errorMessage = 'GCS permission error: Check service account permissions and bucket IAM settings';
        } else if (error.message.includes('bucket')) {
          errorMessage = 'GCS bucket error: Check bucket name and existence';
        } else if (error.message.includes('credentials')) {
          errorMessage = 'GCS credentials error: Check service account key file';
        }
      }
      logger.error('GCS buffer upload error', { err: error });
      return { success: false, error: errorMessage };
    }
  }

  /** Upload buffer to brand-scoped path (logo or content). */
  async uploadBufferForBrand(
    buffer: Buffer,
    orgId: string,
    brandId: string,
    type: 'logo' | 'content',
    filename: string,
    contentType: string
  ): Promise<GCSUploadResult> {
    if (!this.isAvailable()) {
      return { success: false, error: 'GCS is not configured or unavailable' };
    }
    if (!buffer || buffer.length === 0) {
      return { success: false, error: 'Buffer is empty' };
    }

    try {
      const filePath = this.getFilePathForBrand(orgId, brandId, type, filename);
      const bucket = this.storage!.bucket(this.bucketName!);
      const gcsFile = bucket.file(filePath);

      await gcsFile.save(buffer, {
        metadata: {
          contentType,
          cacheControl: 'public, max-age=31536000',
          metadata: {
            organizationId: orgId,
            brandId,
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      const [exists] = await gcsFile.exists();
      if (!exists) {
        logger.error('File upload verification failed: file does not exist after upload');
        return { success: false, error: 'File upload verification failed' };
      }

      const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
      let finalUrl = publicUrl;
      try {
        const [signedUrl] = await gcsFile.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
        });
        finalUrl = signedUrl;
      } catch {
        logger.debug('Using public URL (signed URL generation failed)', { publicUrl });
      }

      logger.info('GCS brand upload successful', { url: finalUrl, filename, filePath });

      return {
        success: true,
        url: finalUrl,
        filename,
        size: buffer.length,
      };
    } catch (error) {
      let errorMessage: string = 'Failed to upload buffer to GCS';
      if (error instanceof Error) {
        errorMessage = error.message;
        if (error.message.includes('permission') || error.message.includes('access')) {
          errorMessage = 'GCS permission error: Check service account permissions and bucket IAM settings';
        } else if (error.message.includes('bucket')) {
          errorMessage = 'GCS bucket error: Check bucket name and existence';
        } else if (error.message.includes('credentials')) {
          errorMessage = 'GCS credentials error: Check service account key file';
        }
      }
      logger.error('GCS buffer upload error', { err: error });
      return { success: false, error: errorMessage };
    }
  }
}

export const gcsStorageService = new GCSStorageService();
