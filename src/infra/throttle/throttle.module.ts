import { Logger, type DynamicModule } from '@dunx/core';
import {
  ClientAddress,
  MemoryThrottleStore,
  RedisThrottleStore,
  ThrottleModule,
} from '@dunx/http';
import { RedisConnection } from '@dunx/infra/redis';
import { AccountsModule } from '../../auth/auth.module.js';
import { CurrentUser } from '../../auth/services/current-user.service.js';
import { AppConfigService } from '../../config/app.config.service.js';
import { CacheStoreModule } from '../cache/cache.module.js';
import { DegradingCacheStore } from '@dunx/infra/cache';

/**
 * The rate limiter.
 *
 * This replaced a hand-rolled guard that did `INCR` then `EXPIRE` and **failed
 * open** when Redis was gone - which kept the app serving, and also meant a
 * deployment with a broken Redis had no rate limiting at all and said nothing
 * about it. The framework's store seam is the better answer: with no Redis the
 * counter is in memory, so the budget is per process rather than absent.
 *
 * The store is chosen once, at boot, by asking whether Redis actually answers -
 * reusing `DegradingCacheStore.probe()` rather than adding a second definition
 * of "is Redis reachable". A connection that comes back later keeps counting in
 * memory until a restart, which is the honest trade for not re-probing on every
 * request.
 *
 * **The prefix has no default upstream and an empty one throws.** That is
 * deliberate there: a scaffolded app inheriting a template's prefix puts two
 * applications on one namespace, each spending the other's budget.
 */
export class AppThrottleModule {
  static forRoot(): DynamicModule {
    return ThrottleModule.forRootAsync({
      /**
       * A dynamic module is its own scope. `CurrentUser` comes from
       * `AccountsModule` and the probe from `CacheStoreModule`, so both are
       * imported here rather than beside this one.
       */
      imports: [AccountsModule, CacheStoreModule],
      useFactory: async (
        config: AppConfigService,
        redis: RedisConnection,
        address: ClientAddress,
        caller: CurrentUser,
        probe: DegradingCacheStore,
        logger: Logger,
      ) => {
        const { prefix, limit, windowSeconds } = config.get('throttle');
        const reachable = await probe.probe();

        logger.info(
          reachable
            ? 'rate limit counting in redis, shared by every replica'
            : 'rate limit counting in memory: redis is unreachable, so the ' +
                'budget is per process',
        );

        return {
          limit,
          windowSeconds,
          prefix,
          store: reachable
            ? new RedisThrottleStore(redis)
            : new MemoryThrottleStore(),
          /**
           * An authenticated caller is limited by user id and an anonymous one
           * by address. Only the guard ahead of this one knows which, which is
           * why the package takes it as an option rather than reading it - and
           * why `@dunx/http` does not depend on `@dunx/auth`.
           */
          subject: (req: Bun.BunRequest) =>
            caller.optional()?.id ?? address.of(req),
        };
      },
      inject: [
        AppConfigService,
        RedisConnection,
        ClientAddress,
        CurrentUser,
        DegradingCacheStore,
        Logger,
      ] as const,
    });
  }
}
