import {
  ConfigModule,
  type ConfigSource,
  type DynamicModule,
} from '@dunx/core';
import { AppConfigService } from './app.config.service.js';
import { validateConfig } from './env.validation.js';

export interface AppConfigModuleOptions {
  /** Overrides `Bun.env`. Tests pass a literal instead of mutating the process. */
  readonly source?: ConfigSource;
}

/**
 * There is no `isGlobal` to pass on: `ConfigModule.forRoot` is already
 * `global: true` and exports `ConfigService` and `AppConfigService`, so every
 * module reads config without importing anything. `ConfigInput` - the raw
 * environment - stays private to it, which is the boundary that matters here.
 *
 * This wrapper therefore needs no `exports` of its own. It exists to keep
 * `validateConfig` and `AppConfigService` paired in one place.
 */
export class AppConfigModule {
  static forRoot(options: AppConfigModuleOptions = {}): DynamicModule {
    return {
      module: AppConfigModule,
      imports: [
        ConfigModule.forRoot({
          validate: validateConfig,
          as: AppConfigService,
          ...(options.source === undefined ? {} : { source: options.source }),
        }),
      ],
    };
  }
}
