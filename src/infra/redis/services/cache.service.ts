import { Logger } from '@dunx/core';
import {
  isConnectionError,
  RedisConnection,
  RedisOptions,
} from '@dunx/infra/redis';
import { AppConfigService } from '../../../config/app.config.service.js';

export interface CacheStatus {
  readonly url: string;
  readonly reachable: boolean;
  readonly note?: string;
}

/**
 * A read-through cache over `Bun.RedisClient`, and the classifier the rest of the
 * app degrades on.
 *
 * The NestJS template used `cache-manager` with a `keyv`-over-`ioredis` adapter to
 * get `get`/`set`/`del` with a TTL. That is three dependencies for six commands
 * `Bun.RedisClient` already has, so there is no cache library here - which is Rule
 * 1's first half rather than an invented cache: nothing about expiry, eviction or
 * serialisation is being reimplemented, it is being asked for.
 */
export class CacheService {
  readonly #ttl: number;

  constructor(
    private readonly redis: RedisConnection,
    private readonly options: RedisOptions,
    config: AppConfigService,
    private readonly logger: Logger,
  ) {
    this.#ttl = config.get('redis').cacheTtlSeconds;
  }

  /** Whether a thrown value means "the cache is down" rather than "the call was wrong". */
  isDown(error: unknown): boolean {
    return isConnectionError(error);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), {
      ex: ttlSeconds ?? this.#ttl,
    });
  }

  async del(...keys: readonly string[]): Promise<number> {
    const [first, ...rest] = keys;
    if (first === undefined) return 0;
    return this.redis.del(first, ...rest);
  }

  /**
   * `compute` on a miss, cached on the way out. A cache that is down is a cache
   * miss, not a failure: the value is still computed and the caller never learns
   * the difference. That is the opposite decision from the cache *routes*, which
   * report 503 - reading through is transparent, and an endpoint whose whole
   * subject is the cache should not be.
   */
  async wrap<T>(
    key: string,
    compute: () => T | Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    try {
      const hit = await this.get<T>(key);
      if (hit !== undefined) return hit;
    } catch (error) {
      if (!this.isDown(error)) throw error;
      this.logger.debug('cache read skipped, the cache is unreachable', {
        key,
      });
      return compute();
    }

    const value = await compute();
    try {
      await this.set(key, value, ttlSeconds);
    } catch (error) {
      if (!this.isDown(error)) throw error;
    }
    return value;
  }

  /** Never throws: a status object is what a health endpoint can use. */
  async status(): Promise<CacheStatus> {
    try {
      await this.redis.ping();
      return { url: this.options.redactedUrl, reachable: true };
    } catch (error) {
      if (!this.isDown(error)) throw error;
      return {
        url: this.options.redactedUrl,
        reachable: false,
        note: `${(error as Error).message}. A cache that is not running must not fail the app.`,
      };
    }
  }
}
