import { SessionGuard } from '@dunx/auth';
import { RedisRelay, type HttpOptions } from '@dunx/http';
import { SERVICE_ROUTES } from './constants.js';
import type { AppConfig } from './config/env.validation.js';
import { errorMapper } from './core/errors/error-mapper.js';
import { AuditContextMiddleware } from './core/middlewares/audit-context.middleware.js';
import { ThrottleGuard } from './infra/redis/guards/throttle.guard.js';

/**
 * The `HttpOptions` in one place, because they have to be passed to
 * `HttpFactory.create` **and** to `@dunx/testing`'s `createTestServer` -
 * neither reads them off the container, and the harness inherits nothing from
 * the production entrypoint. A suite that forgets them gets a server with no
 * guards and no error mapper, which still boots and still answers, so the
 * omission is silent.
 */
export const httpOptions = (config: AppConfig): HttpOptions => {
  const servicePath = `/${config.app.prefix}/${SERVICE_ROUTES.BASE}`;
  return {
    // Outermost first, after the built-in request logger. `SessionGuard` leads
    // because everything after it wants to know who is calling: it runs the rest
    // of the chain inside `AuthContext`, so the throttler can count per user and
    // the audit stamp can name one. A guard is middleware that throws, so
    // ordering is the only thing that decides which runs first.
    middleware: [SessionGuard, ThrottleGuard, AuditContextMiddleware],
    onError: errorMapper,
    requestLogging: {
      requestBody: config.log.requestBody,
      responseBody: config.log.responseBody,
      ignore: [
        `${servicePath}/${SERVICE_ROUTES.LIVENESS}`,
        `${servicePath}/${SERVICE_ROUTES.HEALTH}`,
      ],
    },
    websocket: { idleTimeout: 60 },
    /**
     * Multi-node websocket fan-out, on `Bun.RedisClient` and therefore on no
     * dependency at all - this is what `@socket.io/redis-adapter` was for.
     *
     * Always configured, never conditional: with no Redis it degrades to exactly
     * the single-process behaviour, warns once, retries the subscribe on a bounded
     * unref'd timer, and the app still boots. `maxRetries: 0` is what lets the
     * process still exit.
     *
     * It cannot read the validated config out of the container for the same reason
     * the port cannot: `HttpFactory.create` is the call that builds the container,
     * so nothing can be injected into its own options.
     */
    relay: new RedisRelay({
      ...(config.redis.url === undefined ? {} : { url: config.redis.url }),
      connectionTimeout: config.redis.connectTimeoutMs,
      maxRetries: 0,
    }),
    relayChannel: config.ws.relayChannel,
  };
};
