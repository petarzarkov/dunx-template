import { Logger } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import {
  FileNotFoundError,
  PathTraversalError,
  Storage,
  UnsupportedOperationError,
} from '@dunx/infra/files';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { AppConfigService } from '../../config/app.config.service.js';
import { JOBS, QUEUES } from '../../notifications/events/events.js';
import type { Page } from '@dunx/infra/pagination';
import type { FileMetadata, UploadBody } from '../dto/file.dto.js';
import type { FileRow } from '../schema/file.schema.js';
import {
  FilesRepository,
  type ListFilesFilters,
} from '../repos/files.repository.js';
import { ThumbnailsService } from './thumbnails.service.js';

const present = (row: FileRow): FileMetadata => ({
  id: row.id,
  userId: row.userId,
  key: row.key,
  name: row.name,
  mimeType: row.mimeType,
  size: row.size,
  width: row.width,
  height: row.height,
  thumbnailKey: row.thumbnailKey,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export class FilesService {
  constructor(
    private readonly storage: Storage,
    private readonly repo: FilesRepository,
    private readonly thumbnails: ThumbnailsService,
    private readonly publisher: JobPublisher,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  async list(filters: ListFilesFilters): Promise<Page<FileMetadata>> {
    const page = await this.repo.list(filters);
    return { data: page.data.map(present), meta: page.meta };
  }

  row(id: string): FileRow {
    const row = this.repo.findById(id);
    if (row === undefined) {
      throw new HttpError(HttpStatusCode.NOT_FOUND, `No file with id ${id}`);
    }
    return row;
  }

  metadata(id: string): FileMetadata {
    return present(this.row(id));
  }

  /**
   * Writes the bytes, then the row. In that order deliberately: an object with no
   * row is a leak a sweep can find, while a row with no object is a 404 every
   * client sees.
   */
  async upload(userId: string, input: UploadBody): Promise<FileMetadata> {
    const { file, context } = input;
    const limits = this.config.get('storage');

    if (file.size > limits.maxBytes) {
      throw new HttpError(
        HttpStatusCode.PAYLOAD_TOO_LARGE,
        `File is ${file.size} bytes, the limit is ${limits.maxBytes}`,
      );
    }
    if (!limits.allowedTypes.includes(file.type)) {
      throw new HttpError(
        HttpStatusCode.UNSUPPORTED_MEDIA_TYPE,
        `Content type "${file.type}" is not accepted. Allowed: ${limits.allowedTypes.join(', ')}`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const dimensions = await this.thumbnails.dimensions(bytes);
    const key = this.key(userId, context, file.name);

    await this.write(key, bytes);

    const row = this.repo.create({
      userId,
      key,
      name: file.name,
      mimeType: file.type,
      size: bytes.byteLength,
      ...(dimensions === undefined
        ? {}
        : { width: dimensions.width, height: dimensions.height }),
    });

    // Rendering a thumbnail is the part that does not belong on the request:
    // it decodes and re-encodes, and the caller does not need to wait for it.
    // An unreachable queue is not a failed upload, so the enqueue degrades.
    if (dimensions !== undefined) await this.enqueueThumbnail(row);

    this.logger.info('file uploaded', {
      fileId: row.id,
      key,
      size: row.size,
      hasDimensions: dimensions !== undefined,
    });
    return present(row);
  }

  async download(id: string): Promise<Response> {
    const row = this.row(id);
    const stream = await this.read(row.key);
    return new Response(stream, {
      headers: {
        'content-type': row.mimeType,
        'content-length': String(row.size),
        'content-disposition': `attachment; filename="${encodeURIComponent(row.name)}"`,
      },
    });
  }

  /**
   * A presigned URL, so the client transfers bytes without proxying them through
   * this app. `LocalStorage` cannot sign anything and says so with a 501 rather
   * than pretending.
   */
  link(id: string, expiresIn: number): { url: string; expiresIn: number } {
    const row = this.row(id);
    try {
      return { url: this.storage.presign(row.key, { expiresIn }), expiresIn };
    } catch (error) {
      throw new HttpError(
        HttpStatusCode.NOT_IMPLEMENTED,
        (error as Error).message,
      );
    }
  }

  async remove(id: string): Promise<void> {
    const row = this.row(id);
    await this.delete(row.key);
    if (row.thumbnailKey !== null) await this.delete(row.thumbnailKey);
    this.repo.deleteById(id);
    this.logger.warn('file deleted', { fileId: id, key: row.key });
  }

  /** `users/<id>/<context>/<uuid>.<ext>` - opaque, and never the client's path. */
  private key(userId: string, context: string, name: string): string {
    const dot = name.lastIndexOf('.');
    const extension = dot === -1 ? '' : name.slice(dot).toLowerCase();
    return `users/${userId}/${context}/${crypto.randomUUID()}${extension}`;
  }

  private async enqueueThumbnail(row: FileRow): Promise<void> {
    try {
      await this.publisher.publish(QUEUES.MEDIA, JOBS.FILE_THUMBNAIL, {
        fileId: row.id,
        key: row.key,
        width: this.config.get('images').thumbnailWidth,
      });
    } catch (error) {
      this.logger.warn('thumbnail not queued, the queue is unreachable', {
        fileId: row.id,
        reason: (error as Error).message,
      });
    }
  }

  private async write(key: string, bytes: Uint8Array): Promise<void> {
    try {
      await this.storage.write(key, bytes);
    } catch (error) {
      throw this.storageError(error, `Could not store "${key}"`);
    }
  }

  private async read(key: string): Promise<ReadableStream<Uint8Array>> {
    try {
      return await this.storage.readStream(key);
    } catch (error) {
      throw this.storageError(error, `Could not read "${key}"`);
    }
  }

  private async delete(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      throw this.storageError(error, `Could not delete "${key}"`);
    }
  }

  /**
   * A key that escapes the root is the caller's fault; a bucket that will not
   * answer is not. `@dunx/infra/files` raises a typed error for each of the three
   * conditions it can distinguish, and everything else is a 503 - "the store is not
   * reachable" is the only thing an unrecognised throw from a storage backend can
   * mean, and it is the same contract the cache and queue routes keep.
   */
  private storageError(error: unknown, context: string): HttpError {
    if (error instanceof HttpError) return error;
    if (error instanceof PathTraversalError) {
      return new HttpError(HttpStatusCode.BAD_REQUEST, error.message);
    }
    if (error instanceof FileNotFoundError) {
      return new HttpError(HttpStatusCode.NOT_FOUND, error.message);
    }
    if (error instanceof UnsupportedOperationError) {
      return new HttpError(HttpStatusCode.NOT_IMPLEMENTED, error.message);
    }
    return new HttpError(
      HttpStatusCode.SERVICE_UNAVAILABLE,
      `${context}: ${(error as Error).message}`,
    );
  }
}
