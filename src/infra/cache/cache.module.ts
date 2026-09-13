import { Logger, Module, provide, type DynamicModule } from '@dunx/core';
import {
  Cache,
  CacheMetrics,
  CacheModule,
  CacheOptions,
  MemoryCacheStore,
  RedisCacheStore,
  TieredCacheStore,
} from '@dunx/infra/cache';
import { RedisConnection } from '@dunx/infra/redis';
import { AppConfigService } from '../../config/app.config.service.js';
import { DegradingCacheStore } from './degrading-store.js';

/**
 * The L2 store on its own, so two things can reach it: `CacheModule`'s factory,
 * which puts it in the tier, and the health controller, which asks whether the
 * backend answered last time.
 *
 * A decorated class rather than a `forRoot()`, because a class is one reference
 * however many modules import it and a factory would build a second store - and
 * a second store means the health probe reports on one the cache is not using.
 */
@Module({
  providers: [
    provide(DegradingCacheStore, {
      useFactory: (redis: RedisConnection, logger: Logger) =>
        new DegradingCacheStore(new RedisCacheStore(redis), logger),
      inject: [RedisConnection, Logger],
    }),
  ],
  exports: [DegradingCacheStore],
})
export class CacheStoreModule {}

/**
 * The value cache: an in-process L1 in front of Redis.
 *
 * The app used to own a `CacheService` over `RedisConnection`. What that class
 * had that the framework's `Cache` does not is degradation, and that is the
 * whole of what stayed: `DegradingCacheStore` sits at the **store** seam, so
 * `Cache`, `wrap`'s single-flight, the tier and the metrics are all the
 * framework's.
 *
 * **L1 is not only a speed-up here, it is what makes degradation useful.** With
 * Redis gone the tier still answers from memory for this process, so a hot key
 * costs one recompute per node rather than one per request.
 *
 * The staleness window is `promoteTtl`: a `del` on one node leaves every other
 * node's L1 holding the old value until it expires. That is the price of having
 * no cross-process invalidation, and the reason it is short.
 */
export class AppCacheModule {
  static forRoot(): DynamicModule {
    return {
      module: AppCacheModule,
      global: true,
      imports: [
        CacheStoreModule,
        CacheModule.forRootAsync(
          {
            // A dynamic module is its own scope, so the store's module has to be
            // imported here rather than beside this one.
            imports: [CacheStoreModule],
            useFactory: (config: AppConfigService, l2: DegradingCacheStore) => {
              const { cacheTtlSeconds, prefix } = config.get('redis');
              return {
                store: new TieredCacheStore(new MemoryCacheStore(), l2, {
                  // Short: this is how long a node may serve a value another
                  // node has already deleted.
                  promoteTtl: 10_000,
                }),
                // The framework counts in milliseconds; the variable is named in
                // seconds because that is what a Redis TTL is.
                ttl: cacheTtlSeconds * 1000,
                prefix,
              };
            },
            inject: [AppConfigService, DegradingCacheStore] as const,
          },
          // Feeds the dashboard's cache panel, which was empty before.
          { metrics: true },
        ),
      ],
      exports: [Cache, CacheOptions, CacheMetrics, CacheStoreModule],
    };
  }
}
