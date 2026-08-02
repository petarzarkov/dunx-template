import type { DynamicModule } from '@dunx/core';
import { QueueModule } from '@dunx/infra/queue';
import { AppConfigService } from '../../config/app.config.service.js';
import { QueuesController } from './queues.controller.js';

export interface QueueModuleOptions {
  /** `false` in the worker process, which has no HTTP routes. */
  readonly controllers?: boolean;
}

/**
 * `QueueModule.forRoot` binds the **publish** side only - `QueueOptions`,
 * `QueueConnection` and `JobPublisher` - so importing it never opens a worker and a
 * web process cannot start consuming by accident. The consuming half is
 * `WorkerFactory`, in src/worker.ts.
 *
 * Imported by both processes, which is the whole shape of a queue: they agree on
 * this module and on nothing else.
 */
export class QueuesModule {
  static forRoot(options: QueueModuleOptions = {}): DynamicModule {
    return {
      module: QueuesModule,
      imports: [
        QueueModule.forRootAsync({
          useFactory: (config: AppConfigService) => {
            const { url, connectTimeoutMs } = config.get('redis');
            const queue = config.get('queue');
            return {
              ...(url === undefined ? {} : { url }),
              prefix: queue.prefix,
              // `maxRetries: 0` is what makes an enqueue against a down Redis
              // answer in milliseconds instead of hanging, and what lets the
              // process exit. It is also `@dunx/infra/queue`'s own default; it is
              // spelled out because `connectionTimeout` next to it is not.
              connection: {
                connectionTimeout: connectTimeoutMs,
                maxRetries: 0,
              },
              defaultJobOptions: {
                attempts: queue.maxRetries,
                backoff: { type: 'exponential', delay: queue.retryDelayMs },
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 500 },
              },
              worker: {
                concurrency: queue.concurrency,
                limiter: {
                  max: queue.rateLimitMax,
                  duration: queue.rateLimitDurationMs,
                },
              },
              // Not a bullmq feature: bullmq's `lockDuration` answers "did the
              // worker die", not "is this handler stuck".
              jobTimeoutMs: queue.jobTimeoutMs,
            };
          },
          inject: [AppConfigService] as const,
        }),
      ],
      ...(options.controllers === false
        ? {}
        : { controllers: [QueuesController] }),
    };
  }
}
