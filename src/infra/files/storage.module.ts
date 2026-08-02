import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DynamicModule } from '@dunx/core';
import {
  FilesModule,
  LocalStorageOptions,
  S3StorageOptions,
  type StorageOptions,
} from '@dunx/infra/files';
import { AppConfigService } from '../../config/app.config.service.js';
import { StorageDriver } from '../../config/dto/storage-vars.dto.js';

/**
 * Backend selection is one `StorageOptions` subclass, not a branch in the app:
 * `FilesModule` binds `Storage` by asking the options object to `create()` it, so
 * every consumer injects the abstract `Storage` and swapping a directory for a
 * bucket is this factory and nothing else.
 *
 * `forRootAsync` because the local root has to exist before `LocalStorageOptions`
 * names it, and creating it is async - which is exactly the case a zero-argument
 * `forRoot` cannot serve.
 *
 * S3 credentials are deliberately incomplete here: anything omitted falls through
 * to Bun's own resolution (`S3_BUCKET`/`AWS_BUCKET`, `AWS_ACCESS_KEY_ID`, ...),
 * because `Bun.S3Client` already does that and restating it would be a second,
 * staler copy.
 */
export class StorageModule {
  static forRoot(): DynamicModule {
    return {
      module: StorageModule,
      imports: [
        FilesModule.forRootAsync({
          useFactory: async (
            config: AppConfigService,
          ): Promise<StorageOptions> => {
            const storage = config.get('storage');

            if (storage.driver === StorageDriver.S3) {
              return new S3StorageOptions(
                {
                  ...(storage.bucket === undefined
                    ? {}
                    : { bucket: storage.bucket }),
                  ...(storage.region === undefined
                    ? {}
                    : { region: storage.region }),
                  ...(storage.endpoint === undefined
                    ? {}
                    : { endpoint: storage.endpoint }),
                  ...(storage.accessKeyId === undefined
                    ? {}
                    : { accessKeyId: storage.accessKeyId }),
                  ...(storage.secretAccessKey === undefined
                    ? {}
                    : { secretAccessKey: storage.secretAccessKey }),
                },
                storage.prefix,
              );
            }

            const root = resolve(storage.localRoot);
            await mkdir(root, { recursive: true });
            return new LocalStorageOptions(root);
          },
          inject: [AppConfigService] as const,
        }),
      ],
    };
  }
}
