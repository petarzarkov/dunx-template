import { Auth, rolesOf } from '@dunx/auth';
import { DashboardModule } from '@dunx/dashboard';
import type { DynamicModule } from '@dunx/core';
import { RequestMetrics } from '@dunx/http';
import { CacheMetrics } from '@dunx/infra/cache';
import { JobPublisher } from '@dunx/infra/queue';
import { RedisConnection } from '@dunx/infra/redis';
import type { BunRequest } from 'bun';
import { AccountsModule } from '../../auth/auth.module.js';
import { AppConfigService } from '../../config/app.config.service.js';
import { QUEUES } from '../../notifications/events/events.js';
import { UserRole } from '../../users/schema/user.schema.js';

/** Where the page answers. Not a route, so `setGlobalPrefix` does not move it. */
export const DASHBOARD_PATH = '/api/_dunx';

/**
 * The ops page: routes, providers, gateways, redis, config, runtime and the real
 * Bull Board over `@bull-board/bun`.
 *
 * This is the row MAPPING.md spent the most words on. `@bull-board/express` was
 * mounted at `/api/queues` in the NestJS template; `@dunx/queue-dashboard` ported
 * it and was then deleted, on the reasoning that a queue-only dashboard is the
 * wrong unit for a framework. `@dunx/dashboard` is the unit that was meant, and it
 * shipped in 3.3.x, so the page is back and the framework owns it.
 *
 * `authorize` receives the raw request, because the middleware runs **ahead of
 * `SessionGuard`** and there is no context to read yet. That is also what makes
 * this the replacement for `HtmlSessionAuthMiddleware`: the NestJS template put a
 * session cookie check in front of Bull Board, the docs and Scalar, and this is
 * the same check in the same place.
 *
 * A refused request gets 404 rather than 403, so an unauthenticated prober cannot
 * learn that the mount exists.
 */
export class AppDashboardModule {
  static forRoot(): DynamicModule {
    return DashboardModule.forRootAsync({
      /**
       * A dynamic module is its own scope, so the factory sees only what this
       * module imports. Config, the publisher and Redis are `global: true` from
       * `foundation()`; `Auth` is not, and `AccountsModule` is what re-exports it.
       * Importing it *here* is the fix - importing it beside this one in
       * `AppModule` reaches the app's scope, not this factory's.
       */
      imports: [AccountsModule],
      useFactory: (
        auth: Auth,
        publisher: JobPublisher,
        redis: RedisConnection,
        config: AppConfigService,
        cacheStats: CacheMetrics,
        stats: RequestMetrics,
      ) => ({
        path: DASHBOARD_PATH,
        title: `${config.get('app').name} ops`,
        queues: publisher,
        /**
         * The web process publishes to both queues but opens a `Queue` lazily, so
         * one that has never been published to would be missing from the board.
         */
        queueNames: Object.values(QUEUES),
        redis,
        // `CacheModule.forRoot(..., { metrics: true })` is what fills this.
        cacheStats,
        // Needs `metrics: true` on HttpFactory.create to have anything in it.
        stats,
        config: config,
        openApiPath: `/${config.get('app').prefix}/${config.get('docs').path}`,
        // The app's own front page, so bull-board's header is not a dead end.
        homeHref: '/',
        /**
         * Retry and drain from the board, which is the whole reason an operator
         * opens it. Everything else on the page is read-only regardless.
         */
        commands: true,
        authorize: async (req: BunRequest): Promise<boolean> => {
          const principal = await auth.api.getSession({ headers: req.headers });
          return (
            principal !== null &&
            rolesOf(principal.user).includes(UserRole.ADMIN)
          );
        },
      }),
      inject: [
        Auth,
        JobPublisher,
        RedisConnection,
        AppConfigService,
        CacheMetrics,
        RequestMetrics,
      ] as const,
    });
  }
}
