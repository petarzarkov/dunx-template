import type { ConfigSource, DynamicModule } from '@dunx/core';
import { LoggerModule } from '@dunx/infra/logger';
import { AuditModule } from './audit/audit.module.js';
import { AppConfigModule } from './config/app.config.module.js';
import { AppConfigService } from './config/app.config.service.js';
import { AuditContextMiddleware } from './core/middlewares/audit-context.middleware.js';
import { RolesGuard } from './core/guards/roles.guard.js';
import { PaginationModule } from './core/pagination/pagination.module.js';
import { DatabaseModule } from './infra/db/database.module.js';
import { HealthModule } from './infra/health/health.module.js';
import { UsersModule } from './users/users.module.js';

export interface AppModuleOptions {
  /** Overrides `Bun.env`. Suites pass a literal rather than mutating the process. */
  readonly source?: ConfigSource;
  /** `fatal` in tests, so a suite does not print one JSON line per assertion. */
  readonly logLevel?: 'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
}

/**
 * Deliberately **not** decorated with `@Module`.
 *
 * A `DynamicModule` naming a class that also carries `@Module` metadata gets the
 * two option sets *unioned*, not overridden, so
 * `@Module({ imports: [ConfigModule.forRoot(prod)] })` plus a
 * `static forTest(): DynamicModule` returning `imports: [ConfigModule.forRoot(test)]`
 * registers `ConfigModule` twice. dunx's container is flat and one binding per
 * token, so that is a hard boot failure:
 *
 *   AppError: Duplicate binding for ConfigInput: bound by module "ConfigModule"
 *   and module "ConfigModule". The container is flat - one binding per token.
 *
 * A bare class plus one factory keeps a single import list and dodges it.
 */
export class AppModule {}

/**
 * Import order is construction order, and shutdown runs in reverse. Config comes
 * first because everything else reads it, then logging, then the database, whose
 * connection therefore closes last.
 *
 * There is no `exports` list and no `@Global()`: the container is flat, so a
 * provider registered anywhere is visible everywhere.
 */
export const appModule = (options: AppModuleOptions = {}): DynamicModule => ({
  module: AppModule,
  imports: [
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
    PaginationModule,
    HealthModule,
    UsersModule,
    AuditModule,
  ],
  providers: [AuditContextMiddleware, RolesGuard],
});
