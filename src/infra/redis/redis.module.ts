import type { DynamicModule } from '@dunx/core';
import { RedisModule } from '@dunx/infra/redis';
import { AppConfigService } from '../../config/app.config.service.js';
import { CacheService } from './services/cache.service.js';
import { ThrottleGuard } from './guards/throttle.guard.js';

/**
 * Registered unconditionally, and that is the whole convention: `Bun.RedisClient`
 * connects lazily, so nothing is dialled here and an unavailable cache cannot stop
 * the process from booting. What degrades is the *route*, never the graph.
 *
 * `maxRetries: 0` is not impatience. Measured on Bun 1.3.14, a client that failed
 * to connect with `maxRetries > 0` keeps a retry timer alive past `close()` and the
 * process never exits; with `0` it exits cleanly. `eager` is left at its default of
 * `false` for the same reason - finding out at startup is the opposite of the point.
 */
export class RedisCacheModule {
  static forRoot(): DynamicModule {
    return {
      module: RedisCacheModule,
      imports: [
        RedisModule.forRootAsync({
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
        }),
      ],
      providers: [CacheService, ThrottleGuard],
    };
  }
}
