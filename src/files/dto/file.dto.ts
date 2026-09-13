import type { RouteSchemas } from '@dunx/http';
import { z } from 'zod';
import { paginatedOf, pageOptionsSchema } from '../../core/pagination.dto.js';

export const FileMetadata = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    key: z.string(),
    name: z.string(),
    mimeType: z.string(),
    size: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    thumbnailKey: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({
    id: 'FileMetadata',
    title: 'An uploaded object, without its bytes',
  });

export type FileMetadata = z.infer<typeof FileMetadata>;

export const PaginatedFiles = paginatedOf(FileMetadata, 'PaginatedFiles');

export const FileIdParams = z.object({ fileId: z.uuid() });

/**
 * A multipart upload. dunx parses `multipart/form-data` with `req.formData()` and
 * hands the handler the grouped fields, so a `File` arrives as a `File` and the
 * schema that validates it is an ordinary zod schema - there is no `FilesInterceptor`,
 * no multer, and no `@UploadedFiles()` parameter decorator.
 *
 * `z.instanceof(File)` rather than `z.file()`: the latter is a zod-4 type whose JSON
 * Schema conversion is `{ type: 'string', format: 'binary' }` only in some versions,
 * and this one is unambiguous at runtime, which is what actually guards the handler.
 */
export const UploadBody = z.object({
  file: z.instanceof(File),
  /** Groups objects under one prefix, e.g. `avatars`. Slashes are rejected. */
  context: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .default('uploads'),
});

export type UploadBody = z.infer<typeof UploadBody>;

/** What a presigned link answers with. Shared so the response can name it. */
export const FileLink = z
  .object({ url: z.string(), expiresIn: z.number().int() })
  .meta({ id: 'FileLink', title: 'A time-limited link to an object' });

export const uploadFile = {
  body: UploadBody,
  status: 201,
  response: { 201: FileMetadata },
} as const satisfies RouteSchemas;

export const listFiles = {
  query: pageOptionsSchema.extend({ mine: z.stringbool().optional() }),
  response: { 200: PaginatedFiles },
} as const satisfies RouteSchemas;

export const oneFile = {
  params: FileIdParams,
  response: { 200: FileMetadata },
} as const satisfies RouteSchemas;

/**
 * The same params as `oneFile` and deliberately not shared with it. A download
 * streams a `Response` and a delete answers 204, so neither has a body to
 * declare, and reusing a schema that names `FileMetadata` would document one.
 */
export const downloadFile = {
  params: FileIdParams,
} as const satisfies RouteSchemas;

export const deleteFile = {
  params: FileIdParams,
} as const satisfies RouteSchemas;

export const linkFile = {
  params: FileIdParams,
  query: z.object({
    expiresIn: z.coerce.number().int().min(10).max(86_400).default(300),
  }),
  response: { 200: FileLink },
} as const satisfies RouteSchemas;
