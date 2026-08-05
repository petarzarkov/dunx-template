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
import { ThrottleGuard } from './infra/redis/guards/throttle.guard.js';
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
 * Every module in this list is **`global: true`**, and that is a decision rather
 * than a shortcut. There is one database, one Redis client, one bucket, one image
 * pipeline and one queue connection per process; `foundation()` builds each exactly
 * once, and a feature module cannot construct its own without opening a second
 * connection. What stays private is still private - each of them exports a named
 * list, not its whole scope. Feature modules import each other normally.
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
 * than overriding them, so declaring both registers every import twice and boot warns
 * that one module is being seen from two places:
 *
 *   Module "AppModule" imports ConfigService from both "ConfigModule" and
 *   "ConfigModule". The last import wins, so these are two separate instances.
 *
 * Decorate or configure, never both. A module that takes **no** options should be
 * decorated instead, as `AccountsModule` and `AuditModule` are: a class is one
 * reference however many modules import it, and a factory returning a fresh object
 * per call is a fresh scope per call.
 */
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ...foundation(options),
        QueuesModule.forRoot(),
        // After DatabaseModule, so better-auth reuses the connection it opened.
        AccountsModule,
        NotificationsModule.forRoot({ publisher: 'socket' }),
        HealthModule,
        UsersModule,
        FilesFeatureModule.forRoot(),
        AuditModule,
      ],
      /**
       * The two **app-level** middlewares, declared by the module that lists them
       * in `httpOptions.middleware`. Both inject across features - `CurrentUser`
       * from `AccountsModule`, `DatabaseBootstrap` from `DatabaseModule` - and the
       * root is the one scope that imports both.
       *
       * Neither moved into a feature module, and that is the honest answer rather
       * than a missing step:
       *
       *  - `ThrottleGuard` limits every route, tuned per route by `@Throttle`
       *    metadata. That is the global-guard-plus-metadata shape, and splitting it
       *    per feature would mean a rate limiter each feature could forget.
       *  - `AuditContextMiddleware` looked like the strongest candidate, since only
       *    the `user` table is audited. But the writes to it include better-auth's
       *    own sign-up route, which is a controller inside `@dunx/auth`'s
       *    `AuthModule` rather than inside `AccountsModule`. Module middleware has
       *    no ancestor layer, so scoping this would silently stop stamping the actor
       *    there while the trigger still fired - with the *previous* request's id.
       *    Global is correct, and the reason is worth keeping.
       */
      providers: [AuditContextMiddleware, ThrottleGuard],
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
