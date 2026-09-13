import {
  HealthIndicator,
  StorageIndicator,
  type ProbeResult,
} from '@dunx/http';
import { JobPublisher } from '@dunx/infra/queue';
import { DegradingCacheStore } from '../cache/degrading-store.js';
import type { QueueName } from '../../notifications/events/events.js';

/**
 * The queue, which the framework ships no indicator for because it ships no
 * opinion about bullmq.
 *
 * `getJobCounts` rather than a ping: a broker that answers PING while the queue
 * is unreadable is not useful to know about, and this is the same call the
 * dashboard's board makes.
 *
 * **Not critical.** A worker that cannot be reached means jobs queue up, and
 * queued is the state a queue exists to have. Shedding traffic from the web
 * process would turn a delayed email into an outage.
 */
export class QueueIndicator extends HealthIndicator {
  readonly name = 'queue';
  override readonly critical = false;

  constructor(
    private readonly publisher: JobPublisher,
    private readonly queues: readonly QueueName[],
  ) {
    super();
  }

  async check(): Promise<ProbeResult> {
    try {
      const counts = await Promise.all(
        this.queues.map(async (queue) => {
          const { waiting, active, failed } = await this.publisher
            .queue(queue)
            .getJobCounts();
          return `${queue} ${waiting ?? 0}w/${active ?? 0}a/${failed ?? 0}f`;
        }),
      );
      return { state: 'up', detail: counts.join(', ') };
    } catch (error) {
      return {
        state: 'down',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * The cache, asked the way the cache itself asks.
 *
 * `RedisIndicator` would answer for the same server, and would answer `up` for a
 * Redis that accepts a PING and fails every read. This goes down the store the
 * app actually uses.
 *
 * **Not critical**, for the reason the whole degradation story exists: a value
 * that can be recomputed is not a reason to shed traffic.
 */
export class CacheIndicator extends HealthIndicator {
  readonly name = 'cache';
  override readonly critical = false;

  constructor(private readonly store: DegradingCacheStore) {
    super();
  }

  async check(): Promise<ProbeResult> {
    const { reachable, note } = await this.store.probe();
    return reachable
      ? { state: 'up' }
      : { state: 'down', detail: note ?? 'unreachable' };
  }
}

/**
 * `StorageIndicator`, made non-critical.
 *
 * It ships critical, which is right for an app whose every response reads an
 * object. Here uploads and downloads need the bucket and nothing else does, so
 * an unreachable one is a broken feature rather than a reason to shed traffic
 * from the whole service - which is the judgement the old controller made when
 * it reported storage under `degraded`.
 *
 * A subclass rather than a constructor flag, because `critical` is a property on
 * the contract rather than an option on this indicator.
 */
export class DegradableStorageIndicator extends StorageIndicator {
  override readonly critical = false;
}
