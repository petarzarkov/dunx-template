import { Logger, type DynamicModule } from '@dunx/core';
import {
  IdempotencyModule,
  MemoryIdempotencyStore,
  RedisIdempotencyStore,
} from '@dunx/http';
import { DegradingCacheStore } from '@dunx/infra/cache';
import { RedisConnection } from '@dunx/infra/redis';
import { AccountsModule } from '../../auth/auth.module.js';
import { CurrentUser } from '../../auth/services/current-user.service.js';
import { AppConfigService } from '../../config/app.config.service.js';
import { CacheStoreModule } from '../cache/cache.module.js';

/**
 * `Idempotency-Key` for the routes marked `@Idempotent()`. A client that retries
 * a create after a dropped response sends the same key and gets the first
 * response replayed, rather than a second user or a second invite email.
 *
 * The store is chosen at boot the way `AppThrottleModule` chooses its own, from
 * the same probe. The guard fails closed, so a Redis store with no Redis would
 * refuse every keyed request; in memory, a retry that lands on another replica
 * runs again, which is the documented trade.
 *
 * Keys are scoped per caller: two users sending the same key never see each
 * other's response. The guard runs after `SessionGuard`, so the caller is known.
 */
export class AppIdempotencyModule {
  static forRoot(): DynamicModule {
    return IdempotencyModule.forRootAsync({
      imports: [AccountsModule, CacheStoreModule],
      useFactory: async (
        config: AppConfigService,
        redis: RedisConnection,
        caller: CurrentUser,
        probe: DegradingCacheStore,
        logger: Logger,
      ) => {
        const reachable = await probe.probe();
        logger.info(
          reachable
            ? 'idempotency keys kept in redis, shared by every replica'
            : 'idempotency keys kept in memory: redis is unreachable, so a ' +
                'retry on another replica runs again',
        );
        return {
          prefix: config.get('app').name,
          store: reachable
            ? new RedisIdempotencyStore(redis)
            : new MemoryIdempotencyStore(),
          subject: () => caller.optional()?.id,
        };
      },
      inject: [
        AppConfigService,
        RedisConnection,
        CurrentUser,
        DegradingCacheStore,
        Logger,
      ] as const,
    });
  }
}
