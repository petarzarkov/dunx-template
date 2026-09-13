import { Logger } from '@dunx/core';
import { CacheStore } from '@dunx/infra/cache';
import { isConnectionError } from '@dunx/infra/redis';

export interface CacheReachability {
  readonly reachable: boolean;
  /** Why not, when the last attempt failed. */
  readonly note?: string | undefined;
}

/**
 * Any `CacheStore`, with an unreachable backend turned into a miss.
 *
 * This is the one thing the framework's `Cache` deliberately does not do: a
 * `RedisCacheStore` whose server is gone throws out of `get`, and `Cache.wrap`
 * lets that through to the caller. For a library that is the honest default -
 * swallowing a store failure hides a broken deployment.
 *
 * For **this** app it is the wrong default, and the difference is a promise the
 * README makes: every area whose service is absent reports that it is skipping
 * and the app serves anyway, and CI asserts a healthy boot with nothing running
 * at all. A cache is the clearest case of that: the value can always be computed
 * again, so an unreachable one costs latency and nothing else.
 *
 * Putting it at the **store** rather than in a wrapper around `Cache` is what
 * keeps the rest of the app on the framework's own API. `Cache.wrap`'s
 * single-flight, `TieredCacheStore` and `CacheMetrics` all work unchanged,
 * because from above this is simply a store that misses a lot.
 *
 * Only a **connection** error degrades. A serialisation failure or a bad command
 * is this app's bug and still throws, which is why `isConnectionError` does the
 * deciding rather than a bare `catch`.
 */
export class DegradingCacheStore extends CacheStore {
  #note: string | undefined;
  #warned = false;

  constructor(
    private readonly inner: CacheStore,
    private readonly logger: Logger,
  ) {
    super();
  }

  /**
   * What the last real operation saw. Cheap, and `undefined` until something has
   * been tried - which is why the health probe calls {@link probe} rather than
   * reading this on a process that has served nothing yet.
   */
  get reachability(): CacheReachability {
    return this.#note === undefined
      ? { reachable: true }
      : { reachable: false, note: this.#note };
  }

  /**
   * Touches the backend and reports what happened.
   *
   * A read rather than a `PING`: a backend that answers a ping and fails every
   * read is not up, and this is the same call path the cache itself uses. The
   * key is never written, so a miss is the expected answer and costs one
   * round trip.
   */
  async probe(): Promise<CacheReachability> {
    await this.get('__health__');
    return this.reachability;
  }

  async get<V = unknown>(key: string): Promise<V | undefined> {
    try {
      const value = await this.inner.get<V>(key);
      this.#recover();
      return value;
    } catch (error) {
      this.#degrade(error);
      return undefined;
    }
  }

  async set<V>(key: string, value: V, ttl: number): Promise<void> {
    try {
      await this.inner.set(key, value, ttl);
      this.#recover();
    } catch (error) {
      this.#degrade(error);
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      const removed = await this.inner.del(key);
      this.#recover();
      return removed;
    } catch (error) {
      this.#degrade(error);
      return false;
    }
  }

  /** Rethrows anything that is not the backend being unreachable. */
  #degrade(error: unknown): void {
    if (!isConnectionError(error)) throw error;
    this.#note = error instanceof Error ? error.message : String(error);
    // Once per outage, not once per request: an unreachable cache is touched on
    // every cached route and would otherwise be the loudest thing in the log.
    if (this.#warned) return;
    this.#warned = true;
    this.logger.warn('cache unreachable, serving every read live', {
      reason: this.#note,
    });
  }

  #recover(): void {
    if (this.#note === undefined) return;
    this.#note = undefined;
    this.#warned = false;
    this.logger.info('cache reachable again');
  }
}
