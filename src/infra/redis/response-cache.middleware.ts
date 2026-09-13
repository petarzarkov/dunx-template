import { Logger } from '@dunx/core';
import {
  type Middleware,
  type Next,
  type RouteContext,
  UNMATCHED,
} from '@dunx/http';
import type { BunRequest } from 'bun';
import { CurrentUser } from '../../auth/services/current-user.service.js';
import { AppConfigService } from '../../config/app.config.service.js';
import { NO_CACHE } from '../../core/decorators/no-cache.decorator.js';
import { Cache } from '@dunx/infra/cache';

/** What is stored, so a replay can reproduce the response rather than guess it. */
interface CachedResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

/**
 * Caches successful `GET` responses in Redis, keyed per caller.
 *
 * This is the NestJS template's `HttpCacheInterceptor`, which subclassed
 * `CacheInterceptor` from `@nestjs/cache-manager` to override `trackBy`. The
 * behaviour is the same and so are its two rules: production only, and the key
 * includes the caller so one user's response is never served to another.
 *
 * **Production only, deliberately.** A cache in development turns an edit into a
 * mystery, and the one thing worse than no cache is one nobody remembers is on.
 *
 * **It never fails a request.** A store that is down means a cache miss and a
 * warning, which is the same contract every other Redis consumer here has.
 */
export class ResponseCacheMiddleware implements Middleware {
  readonly #enabled: boolean;
  readonly #prefix: string;

  constructor(
    private readonly cache: Cache,
    private readonly caller: CurrentUser,
    private readonly logger: Logger,
    config: AppConfigService,
  ) {
    this.#enabled = config.get('isProd');
    this.#prefix = `${config.get('redis').prefix}:http`;
  }

  async handle(
    req: BunRequest,
    ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    if (
      !this.#enabled ||
      req.method !== 'GET' ||
      ctx.get(UNMATCHED) === true ||
      ctx.get(NO_CACHE) === true
    ) {
      return next();
    }

    const key = this.#key(req);
    const hit = await this.#read(key);
    if (hit !== undefined) {
      return new Response(hit.body, {
        status: hit.status,
        headers: { 'content-type': hit.contentType, 'x-cache': 'HIT' },
      });
    }

    const response = await next();
    // Only 2xx. Caching a 404 or a 403 means a later fix, or a later grant, is
    // invisible until the entry expires.
    if (response.status < 200 || response.status > 299) return response;

    /**
     * The body is read here, which is why the clone is not optional: a `Response`
     * body is a one-shot stream and returning the one that was drained would give
     * the caller nothing.
     */
    const copy = response.clone();
    const body = await copy.text();
    await this.#write(key, {
      status: response.status,
      contentType:
        response.headers.get('content-type') ??
        'application/json; charset=utf-8',
      body,
    });

    response.headers.set('x-cache', 'MISS');
    return response;
  }

  /**
   * The caller is part of the key, not a reason to skip. Every route behind
   * `SessionGuard` can return a different body per user, and a shared key would
   * serve one user's data to the next.
   */
  #key(req: BunRequest): string {
    const { pathname, search } = new URL(req.url);
    const who = this.caller.optional()?.id ?? 'anonymous';
    return `${this.#prefix}:${who}:${pathname}${search}`;
  }

  /**
   * No try/catch, and that is the point of `DegradingCacheStore`: an unreachable
   * backend is a miss at the store rather than an exception every caller has to
   * catch. This used to carry its own degrade-or-rethrow, and one copy of that
   * rule is enough.
   */
  #read(key: string): Promise<CachedResponse | undefined> {
    return this.cache.get<CachedResponse>(key);
  }

  #write(key: string, value: CachedResponse): Promise<void> {
    return this.cache.set(key, value);
  }
}
