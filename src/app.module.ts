import type { ConfigSource, DynamicModule, ModuleRef } from '@dunx/core';
import { LoggerModule } from '@dunx/infra/logger';
import { AccountsModule } from './auth/auth.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AppConfigModule } from './config/app.config.module.js';
import { AppConfigService } from './config/app.config.service.js';
import { AuditContextMiddleware } from './core/middlewares/audit-context.middleware.js';
import { FilesFeatureModule } from './files/files.module.js';
import { DatabaseModule } from './infra/db/database.module.js';
import { StorageModule } from './infra/files/storage.module.js';
import { HealthModule } from './infra/health/health.module.js';
import { ImagesConfigModule } from './infra/images/images.module.js';
import { QueuesModule } from './infra/queue/queue.module.js';
import { RedisCacheModule } from './infra/redis/redis.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { UsersModule } from './users/users.module.js';

export interface AppModuleOptions {
  /** Overrides `Bun.env`. Suites pass a literal rather than mutating the process. */
  readonly source?: ConfigSource;
  /** `fatal` in tests, so a suite does not print one JSON line per assertion. */
  readonly logLevel?: 'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
}

/**
 * Everything shared by the web process and the worker: config, logging, the
 * database, storage, images, Redis and the queue's publish side.
 *
 * Import order is construction order, and shutdown runs in reverse. Config comes
 * first because everything else reads it, then logging, then the database, whose
 * connection therefore closes last.
 *
 * **Nothing here is conditional on a service being reachable.** Every connection is
 * lazy, so an absent Redis or an unreachable bucket cannot stop the graph from
 * building - what degrades is the route that needs it.
 *
 * There is no `exports` list and no `@Global()`: the container is flat, so a
 * provider registered anywhere is visible everywhere.
 */
const foundation = (options: AppModuleOptions): readonly ModuleRef[] => [
  AppConfigModule.forRoot(
    options.source === undefined ? {} : { source: options.source },
  ),
  options.logLevel === undefined
    ? LoggerModule.forRootAsync(
        {
          useFactory: (config: AppConfigService) => {
            const app = config.get('app');
            const log = config.get('log');
            return {
              name: app.name,
              version: app.version,
              env: app.env,
              level: log.level,
              isDevelopment: app.nodeEnv !== 'production',
              maskFields: [...log.maskFields],
              filterEvents: [...log.filterEvents],
            };
          },
          inject: [AppConfigService] as const,
        },
        { captureGlobalErrors: true },
      )
    : LoggerModule.forRoot({ level: options.logLevel }),
  DatabaseModule.forRoot(),
  RedisCacheModule.forRoot(),
  StorageModule.forRoot(),
  ImagesConfigModule.forRoot(),
];

/**
 * The web process's graph.
 *
 * **Undecorated, with a static factory** - the same shape every configurable module
 * in dunx uses, `DbModule.forRoot()` and `QueueModule.forRootAsync()` included. It
 * must not *also* carry `@Module`: `resolveRef` in `@dunx/core` concatenates a
 * `DynamicModule`'s options with any decorator metadata on the class it names rather
 * than overriding them, so declaring both registers every import twice and boot dies
 * naming the same module on both sides of a duplicate binding:
 *
 *   AppError: Duplicate binding for ConfigInput: bound by module "ConfigModule"
 *   and module "ConfigModule". The container is flat - one binding per token.
 *
 * Decorate or configure, never both.
 */
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ...foundation(options),
        QueuesModule.forRoot(),
        // After DatabaseModule, so better-auth reuses the connection it opened.
        AccountsModule.forRoot(),
        NotificationsModule.forRoot({ publisher: 'socket' }),
        HealthModule,
        UsersModule,
        FilesFeatureModule.forRoot(),
        AuditModule,
      ],
      providers: [AuditContextMiddleware],
    };
  }
}

/**
 * The consuming half. A worker is its own container: it builds only what a handler
 * needs, has no HTTP server and therefore no `PubSub`, which is why the events
 * publisher is the relay one here.
 *
 * `QueuesModule` without its controller, because there are no routes to serve, and
 * no `AccountsModule` because a job has no caller.
 */
export class WorkerModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ...foundation(options),
        QueuesModule.forRoot({ controllers: false }),
        NotificationsModule.forRoot({ publisher: 'relay' }),
        FilesFeatureModule.forRoot({ controllers: false }),
      ],
    };
  }
}
