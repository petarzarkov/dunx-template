import {
  AmqpIndicator,
  HealthIndicator,
  StorageIndicator,
  type ProbeResult,
} from '@dunx/http';
import { JobPublisher } from '@dunx/infra/queue';
import type { QueueName } from '../../notifications/events/events.js';
import { DegradingCacheStore } from '@dunx/infra/cache';

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
      const counted = await Promise.all(
        this.queues.map(async (queue) => {
          const { waiting, active, failed } = await this.publisher
            .queue(queue)
            .getJobCounts();
          return [
            queue,
            { waiting: waiting ?? 0, active: active ?? 0, failed: failed ?? 0 },
          ] as const;
        }),
      );

      /**
       * `data` alongside `detail`, which is what 3.9.1 added for exactly this.
       * The counts used to be flattened into "notifications 12w/0a/0f" - one
       * line an operator can read and nothing else can, so an alert rule or a
       * scrape had to parse a format nothing promised to keep. Now `detail` is
       * still that sentence and `data` carries the numbers.
       */
      return {
        state: 'up',
        detail: counted
          .map(([q, c]) => `${q} ${c.waiting}w/${c.active}a/${c.failed}f`)
          .join(', '),
        data: Object.fromEntries(counted),
      };
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
    const reachable = await this.store.probe();
    return reachable
      ? { state: 'up' }
      : { state: 'down', detail: 'unreachable' };
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

/**
 * `AmqpIndicator`, made non-critical, for the reason the queue one is: a broker
 * this app announces to and does not read from is not something to shed traffic
 * over. A subscriber that misses an event is the subscriber's problem to notice.
 */
export class DegradableAmqpIndicator extends AmqpIndicator {
  override readonly critical = false;
}
