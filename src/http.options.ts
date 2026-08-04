import { SessionGuard } from '@dunx/auth';
import { RedisRelay, type HttpOptions } from '@dunx/http';
import { QueueDashboardMiddleware } from '@dunx/queue-dashboard';
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
    /**
     * Outermost first, after the built-in request logger. A guard is middleware
     * that throws, so ordering is the only thing that decides which runs first.
     *
     * **`QueueDashboardMiddleware` leads, ahead of `SessionGuard`, and that is
     * load-bearing.** Behind the guard, an anonymous request for `/queues` gets a
     * 401 - which tells an unauthenticated caller there is something at that path
     * worth authenticating for, and the whole point of the package answering 404
     * is not to. Measured: with it registered last, both anonymous and
     * bad-session requests came back 401 rather than 404.
     *
     * Putting it first is safe because its `authorize` asks better-auth for the
     * session itself rather than reading the `AuthContext` that `SessionGuard`
     * writes - see queue-dashboard.module.ts. It also means the board's paths do
     * not pay for the throttler or the audit stamp, which is what the package
     * intends by taking a function rather than a list of guards.
     *
     * `SessionGuard` then leads the rest, because everything after it wants to
     * know who is calling: it runs the remainder of the chain inside
     * `AuthContext`, so the throttler can count per user and the audit stamp can
     * name one.
     */
    middleware: [
      QueueDashboardMiddleware,
      SessionGuard,
      ThrottleGuard,
      AuditContextMiddleware,
    ],
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
