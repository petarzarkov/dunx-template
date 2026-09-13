import { Logger } from '@dunx/core';
import {
  ClientAddress,
  HttpError,
  HttpStatusCode,
  type Middleware,
  type Next,
  type RouteContext,
} from '@dunx/http';
import type { BunRequest } from 'bun';
import { CurrentUser } from '../../../auth/services/current-user.service.js';
import { AppConfigService } from '../../../config/app.config.service.js';
import { THROTTLE } from '../../../core/decorators/throttle.decorator.js';
import { RedisConnection } from '@dunx/infra/redis';

/**
 * A fixed-window rate limit, one Redis key per caller and route.
 *
 * `INCR` then `EXPIRE` on the call that created the key, which is what makes the
 * window start at the first hit rather than sliding forever. Two round trips
 * instead of the NestJS template's Lua script: `Bun.RedisClient` pipelines
 * automatically, and the second command is only issued on the first hit of a
 * window.
 *
 * **Fails open.** With no Redis there is no counter, and refusing every request
 * because the rate limiter is down would turn a degraded cache into an outage. It
 * warns once per process instead, so the gap is visible without one line per
 * request.
 *
 * Ordered after `SessionGuard` deliberately: an authenticated caller is limited by
 * user id, an anonymous one by client address, and only the guard ahead of this one
 * knows which.
 */
export class ThrottleGuard implements Middleware {
  #warned = false;

  constructor(
    private readonly redis: RedisConnection,
    private readonly caller: CurrentUser,
    private readonly address: ClientAddress,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  async handle(
    req: BunRequest,
    ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    const throttle = this.config.get('throttle');
    const limit = ctx.get(THROTTLE) ?? throttle;
    const key = `${throttle.prefix}:throttle:${ctx.controller}:${ctx.handler}:${this.subject(req)}`;

    const used = await this.count(key, limit.windowSeconds);
    if (used === undefined) return next();

    if (used > limit.limit) {
      throw new HttpError(
        HttpStatusCode.TOO_MANY_REQUESTS,
        `Rate limit exceeded: ${limit.limit} requests per ${limit.windowSeconds}s`,
      );
    }
    return next();
  }

  /** `undefined` when the counter could not be reached, which means "allow". */
  async #incr(key: string, windowSeconds: number): Promise<number | undefined> {
    const used = await this.redis.incr(key);
    if (used === 1) await this.redis.expire(key, windowSeconds);
    return used;
  }

  private async count(
    key: string,
    windowSeconds: number,
  ): Promise<number | undefined> {
    try {
      return await this.#incr(key, windowSeconds);
    } catch (error) {
      if (!this.#warned) {
        this.#warned = true;
        this.logger.warn(
          'the rate limiter is unreachable, requests are not being counted',
          { reason: (error as Error).message },
        );
      }
      return undefined;
    }
  }

  private subject(req: BunRequest): string {
    return this.caller.optional()?.id ?? this.address.of(req) ?? 'anonymous';
  }
}
