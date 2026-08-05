import type { DynamicModule } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { FilesController } from './files.controller.js';
import { MediaJobs } from './handlers/media.jobs.js';
import { FilesRepository } from './repos/files.repository.js';
import { FilesService } from './services/files.service.js';
import { ThumbnailsService } from './services/thumbnails.service.js';

export interface FilesModuleOptions {
  /**
   * `false` in the worker. A controller is a provider like any other, so it would
   * be constructed there too - and `FilesController` injects `CurrentUser`, whose
   * `AuthContext` only exists in a process that mounted `AuthModule`.
   */
  readonly controllers?: boolean;
}

/**
 * `Storage`, `Images` and `JobPublisher` come from `StorageModule`,
 * `ImagesConfigModule` and `QueuesModule`, which are `global: true` - one of each
 * per process, built by `foundation()`, so there is nothing to import.
 *
 * `AccountsModule` is imported rather than global, because `CurrentUser` is a
 * feature's service and not infrastructure - and it is imported **only with the
 * controller**, because that is the one thing here that has a caller. The worker
 * takes `controllers: false` and must not pull better-auth in behind it.
 *
 * Nothing is exported. Uploads are reached over HTTP or through the queue, never
 * by another module calling `FilesService`.
 *
 * `MediaJobs` is here rather than in a worker-only module, because the worker
 * imports this same module and that is where its handler is discovered.
 */
export class FilesFeatureModule {
  static forRoot(options: FilesModuleOptions = {}): DynamicModule {
    return {
      module: FilesFeatureModule,
      providers: [FilesService, FilesRepository, ThumbnailsService, MediaJobs],
      ...(options.controllers === false
        ? {}
        : { imports: [AccountsModule], controllers: [FilesController] }),
    };
  }
}
