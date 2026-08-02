import type { DynamicModule } from '@dunx/core';
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
 * `Storage` and `Images` come from `StorageModule` and `ImagesConfigModule`, which
 * the root imports - the container is flat, so there is nothing to re-export and
 * nothing to import twice.
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
        : { controllers: [FilesController] }),
    };
  }
}
