import { Logger } from '@dunx/core';
import { Storage } from '@dunx/infra/files';
import { JobHandler } from '@dunx/infra/queue';
import type { Job } from 'bullmq';
import {
  JOBS,
  QUEUES,
  type FileThumbnailJob,
} from '../../notifications/events/events.js';
import { FilesRepository } from '../repos/files.repository.js';
import { ThumbnailsService } from '../services/thumbnails.service.js';

export interface ThumbnailResult {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

/**
 * The one job in this app that does real work: decode the original, resize it,
 * re-encode it as WebP and write it back beside the source.
 *
 * It injects the very same `ThumbnailsService` and `Storage` the HTTP routes use -
 * one wiring, two entrypoints - which is the point of a job handler being an
 * ordinary provider. The NestJS template's equivalent ran in a forked
 * `job.processor.ts` that bootstrapped a second `JobModule` by hand, because a Nest
 * worker has no container of its own.
 */
export class MediaJobs {
  constructor(
    private readonly storage: Storage,
    private readonly thumbnails: ThumbnailsService,
    private readonly repo: FilesRepository,
    private readonly logger: Logger,
  ) {}

  @JobHandler({ queue: QUEUES.MEDIA, name: JOBS.FILE_THUMBNAIL })
  async thumbnail(job: Job<FileThumbnailJob>): Promise<ThumbnailResult> {
    const { fileId, key, width } = job.data;

    const source = await this.storage.readBytes(key);
    const encoded = await this.thumbnails.render(source, width);
    const thumbnailKey = `${key}.thumb.webp`;

    await this.storage.write(thumbnailKey, encoded.bytes);
    this.repo.update(fileId, { thumbnailKey });

    const result: ThumbnailResult = {
      key: thumbnailKey,
      width: encoded.width,
      height: encoded.height,
      bytes: encoded.bytes.byteLength,
    };
    this.logger.info('thumbnail rendered', { fileId, ...result });
    return result;
  }
}
