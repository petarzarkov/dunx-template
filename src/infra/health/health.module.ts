import { Module, type DynamicModule } from '@dunx/core';
import {
  DatabaseIndicator,
  HealthModule,
  MemoryIndicator,
  MemoryOptions,
} from '@dunx/http';
import { DbConnection } from '@dunx/infra/db';
import { Storage } from '@dunx/infra/files';
import { JobPublisher } from '@dunx/infra/queue';
import { AppConfigService } from '../../config/app.config.service.js';
import { QUEUES } from '../../notifications/events/events.js';
import { CacheStoreModule } from '../cache/cache.module.js';
import { DegradingCacheStore } from '../cache/degrading-store.js';
import { BuildInfoController } from './build-info.controller.js';
import {
  CacheIndicator,
  DegradableStorageIndicator,
  QueueIndicator,
} from './indicators.js';

/**
 * Liveness and readiness, on `@dunx/http`'s own registry.
 *
 * This replaced a hand-rolled controller that ran six checks and partitioned the
 * result into `info` and `degraded`. Two things made the trade worth it, and
 * neither is reproducible in app code:
 *
 *  - **Per-indicator timeouts.** A check that hangs used to hang the probe. A
 *    timed-out check is now `unknown`, which is not `down`: it has told you
 *    nothing, and that distinction is what decides whether traffic is shed.
 *  - **A drain phase.** `Readiness` implements `OnBeforeShutdown`, so readiness
 *    starts failing *before* the socket closes. Every `onShutdown` hook runs
 *    after `server.stop()` has resolved, so a probe answering from there answers
 *    on a closed port while the load balancer is still routing.
 *
 * `degraded` was a vocabulary, not a capability: `critical: false` is the same
 * idea, and it reports without gating readiness. The cache, the queue, storage
 * and memory are all non-critical here - each can be down while the service is
 * still worth sending requests to. The database is not.
 *
 * The route paths change with it, to `/live` and `/ready` under the module's own
 * `health` controller. Build information is not a health concern and keeps a
 * controller of its own.
 */
@Module({})
export class AppHealthModule {
  static forRoot(): DynamicModule {
    return {
      module: AppHealthModule,
      imports: [
        CacheStoreModule,
        HealthModule.forRootAsync({
          imports: [CacheStoreModule],
          useFactory: (
            db: DbConnection,
            storage: Storage,
            publisher: JobPublisher,
            cache: DegradingCacheStore,
            config: AppConfigService,
          ) => ({
            readiness: [
              // The one critical check. With no database there is nothing this
              // service can usefully answer.
              new DatabaseIndicator(db),
              new CacheIndicator(cache),
              new QueueIndicator(publisher, Object.values(QUEUES)),
              new DegradableStorageIndicator(storage),
              new MemoryIndicator(
                new MemoryOptions({
                  maxRssBytes: config.get('service').maxMemoryMb * 1024 * 1024,
                }),
              ),
            ],
            /**
             * How long readiness reports failing before shutdown continues, so a
             * load balancer notices and stops routing. Zero locally, because a
             * `bun run dev` restart and a suite closing one server per file both
             * pay it, and the second one turned every `afterAll` into a timeout.
             */
            drainDelayMs: config.get('service').drainMs,
          }),
          inject: [
            DbConnection,
            Storage,
            JobPublisher,
            DegradingCacheStore,
            AppConfigService,
          ] as const,
        }),
      ],
      controllers: [BuildInfoController],
    };
  }
}
