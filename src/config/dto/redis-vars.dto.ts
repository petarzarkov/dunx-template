import { z } from 'zod';

/**
 * Redis is optional everywhere it appears. Absent, the cache reports itself
 * degraded, the throttler stops throttling, the queue answers 503 and the
 * websocket relay fans out locally - the app still boots and still exits 0.
 *
 * That is why there is no `REDIS_HOST`/`REDIS_PORT`/`REDIS_DB` triple as in the
 * NestJS template: `Bun.RedisClient` takes a URL, and one absent URL is a much
 * clearer "there is no Redis" than four fields with working defaults.
 */
export const redisVarsSchema = z.object({
  REDIS_URL: z.string().optional(),

  /**
   * How long a connect attempt waits before failing. Deliberately short: a
   * degraded route has to answer, and answering slowly is worse than answering
   * 503.
   */
  REDIS_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(50)
    .max(30_000)
    .default(500),

  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),

  /**
   * Namespaces every counter key. Two deployments sharing one Redis need two
   * values, or one would spend the other's budget - and a test run needs its own,
   * or it inherits the last run's counters.
   */
  THROTTLE_PREFIX: z.string().default('dunx-template'),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(20),
  THROTTLE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),

  QUEUE_PREFIX: z.string().default('dunx-template'),
  QUEUE_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
  QUEUE_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(5000),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(3),
  QUEUE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(100),
  QUEUE_RATE_LIMIT_DURATION_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(1000),
  QUEUE_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(600_000)
    .default(120_000),

  /**
   * The one broker channel every websocket topic is relayed on. Two deployments
   * sharing a Redis need two different values, or each would fan out the other's
   * frames.
   */
  WS_RELAY_CHANNEL: z.string().default('dunx-template:ws'),
});
