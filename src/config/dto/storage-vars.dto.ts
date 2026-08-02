import { z } from 'zod';
import { csv } from './scalars.js';

export const StorageDriver = Object.freeze({
  LOCAL: 'local',
  S3: 's3',
} as const);
export type StorageDriver = (typeof StorageDriver)[keyof typeof StorageDriver];

/**
 * `local` is the default so a clean checkout can upload a file with nothing
 * installed: `@dunx/infra/files` selects the backend from the `StorageOptions`
 * subclass it is handed, and `LocalStorageOptions` is `Bun.file`/`Bun.write`
 * under a directory.
 *
 * `s3` is `Bun.S3Client`, so credentials resolve through Bun's own chain -
 * anything omitted here falls back to `AWS_ACCESS_KEY_ID` and friends. There is
 * no `@aws-sdk`.
 */
export const storageVarsSchema = z.object({
  STORAGE_DRIVER: z
    .enum([StorageDriver.LOCAL, StorageDriver.S3])
    .default(StorageDriver.LOCAL),
  STORAGE_LOCAL_ROOT: z.string().default('./data/uploads'),
  /** Prepended to every key, so one bucket can host several environments. */
  STORAGE_PREFIX: z.string().default(''),

  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  /** Set for MinIO or any other S3-compatible endpoint. */
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(10 * 1024 * 1024),
  UPLOAD_ALLOWED_TYPES: csv([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'text/csv',
    'application/pdf',
  ]),

  IMAGE_QUALITY: z.coerce.number().int().min(1).max(100).default(80),
  IMAGE_MAX_WIDTH: z.coerce.number().int().min(16).max(20_000).default(2048),
  IMAGE_THUMBNAIL_WIDTH: z.coerce.number().int().min(16).max(2000).default(256),
});
