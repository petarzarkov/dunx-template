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
 * There is no `isGlobal` because dunx has no module encapsulation: every
 * provider is visible everywhere, so a config module is global by construction.
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
