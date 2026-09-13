import type { DynamicModule } from '@dunx/core';
import { RedisModule } from '@dunx/infra/redis';
import { AppConfigService } from '../../config/app.config.service.js';
import { CacheService } from './services/cache.service.js';

/**
 * Registered unconditionally, and that is the whole convention: `Bun.RedisClient`
 * connects lazily, so nothing is dialled here and an unavailable cache cannot stop
 * the process from booting. What degrades is the *route*, never the graph.
 *
 * `maxRetries: 0` is not impatience. Measured on Bun 1.3.14, a client that failed
 * to connect with `maxRetries > 0` keeps a retry timer alive past `close()` and the
 * process never exits; with `0` it exits cleanly. `eager` is left at its default of
 * `false` for the same reason - finding out at startup is the opposite of the point.
 *
 * `global: true` for the same reason as `DatabaseModule`: one client, built once by
 * `foundation()`, read by auth, notifications, the throttler and the health probe.
 *
 * `ThrottleGuard` used to live here and now does not. It is app-level middleware -
 * `httpOptions.middleware` lists it - so it belongs to the module that lists it, and
 * it also injects `CurrentUser`, which would have made this infra module import the
 * auth feature that imports it back.
 */
export class RedisCacheModule {
  static forRoot(): DynamicModule {
    const redis = RedisModule.forRootAsync({
      useFactory: (config: AppConfigService) => {
        // Destructured first: `exactOptionalPropertyTypes` will not let a
        // `string | undefined` reach a `url?: string`, even inside the branch
        // that has already ruled `undefined` out.
        const { url, connectTimeoutMs } = config.get('redis');
        return {
          ...(url === undefined ? {} : { url }),
          connectionTimeout: connectTimeoutMs,
          maxRetries: 0,
        };
      },
      inject: [AppConfigService] as const,
    });

    return {
      module: RedisCacheModule,
      global: true,
      imports: [redis],
      providers: [CacheService],
      exports: [redis, CacheService],
    };
  }
}
