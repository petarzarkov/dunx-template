import { SessionGuard } from '@dunx/auth';
import { DashboardMiddleware } from '@dunx/dashboard';
import { ThrottleGuard } from '@dunx/http';
import { RedisRelay, type HttpOptions } from '@dunx/http';
import { HEALTH_ROUTES } from './constants.js';
import type { AppConfig } from './config/env.validation.js';
import { errorMapper } from './core/errors/error-mapper.js';
import { AuditContextMiddleware } from './core/middlewares/audit-context.middleware.js';
import { ResponseCacheMiddleware } from './infra/redis/response-cache.middleware.js';

/** `csrf` takes a bare origin, so a configured `https://app.example/` is normalized. */
const trustedOrigins = (origin: string): string[] => {
  const parsed = URL.parse(origin)?.origin;
  return parsed === undefined || parsed === 'null' ? [] : [parsed];
};

/**
 * The `HttpOptions` in one place, because they have to be passed to
 * `HttpFactory.create` **and** to `@dunx/testing`'s `createTestServer` -
 * neither reads them off the container, and the harness inherits nothing from
 * the production entrypoint. A suite that forgets them gets a server with no
 * guards and no error mapper, which still boots and still answers, so the
 * omission is silent.
 */
export const httpOptions = (config: AppConfig): HttpOptions => {
  const prefix = `/${config.app.prefix}`;
  return {
    /**
     * Outermost first, after the built-in request logger. `SessionGuard` leads
     * because everything after it wants to know who is calling: it runs the rest of
     * the chain inside `AuthContext`, so the throttler can count per user and the
     * audit stamp can name one. A guard is middleware that throws, so ordering is the
     * only thing that decides which runs first.
     */
    middleware: [
      /**
       * Ahead of `SessionGuard`, which is a requirement rather than a preference:
       * the dashboard does its own `authorize` against better-auth, and behind the
       * guard its polling would also be counted by `ThrottleGuard` against one
       * key, since an unmatched path has no controller or handler to key on.
       */
      DashboardMiddleware,
      SessionGuard,
      ThrottleGuard,
      /**
       * After `SessionGuard`, because the cache key includes the caller and only
       * the guard ahead of it knows who that is. Before `AuditContextMiddleware`,
       * because a served hit ran no handler and therefore wrote nothing to audit.
       */
      ResponseCacheMiddleware,
      AuditContextMiddleware,
    ],
    onError: errorMapper,
    /**
     * A path that matched nothing answers **404**, not the session guard's 401.
     *
     * `@dunx/http` defaults to `'guarded'`, which gives the miss no route metadata
     * so a global guard refuses it - on the reasoning that a 404 on a miss while
     * every real path answers 401 tells a prober which paths exist. That default is
     * deliberate upstream and this opts out of it, for two reasons:
     *
     *  - **It is actively misleading.** `GET /api/queue` - a typo for `/api/queues` -
     *    answered `401 UNAUTHENTICATED`, which says "log in" when the truth is "no
     *    such route". That cost real debugging time.
     *  - **It puts a session lookup on every miss.** `SessionGuard` calls
     *    better-auth's `getSession` before it can refuse, so each unmatched request
     *    costs a database round trip. Anyone spraying random paths gets that
     *    amplification for free, which is a worse exposure than the enumeration the
     *    default is protecting against - this API's route table is in a public
     *    OpenAPI document at `/api/docs` anyway.
     *
     * The miss is still logged and still gets a request id: the fallback runs the
     * global middleware either way, which is the whole reason it exists.
     */
    /**
     * Per-route request counts and timings, folded into the entry the request
     * logger already builds - about 35 ns. `@dunx/dashboard` renders them, and
     * without this its stats panel has nothing in it.
     */
    metrics: true,
    /**
     * `nosniff`, `DENY` framing, `no-referrer` and HSTS on every response, the
     * 404 and mapped errors included. The CSP is off unless asked for, and this
     * asks for the strict one: same-origin scripts and styles only. The chat
     * page at `/` keeps both in `public/` so it needs no exception, and Swagger,
     * Scalar and the dashboard send a policy of their own, which wins.
     */
    securityHeaders: { contentSecurityPolicy: true },
    /**
     * A cross-site `POST`, `PATCH` or `DELETE` from a browser is refused with a
     * 403, judged from `Sec-Fetch-Site` and `Origin`, with no token to thread
     * through a form. better-auth's cookie session is what makes this matter. A
     * non-browser client sends neither header and is unaffected. The configured
     * CORS origin is trusted, since it is the one other site allowed to call with
     * credentials; `*` trusts none.
     */
    csrf: { trustedOrigins: trustedOrigins(config.cors.origin) },
    /**
     * A weak `ETag` on every value a `GET` handler returns, and a 304 with no
     * body when `If-None-Match` already has it. A handler returning its own
     * `Response` is compared only against an `ETag` it set itself, and a hit
     * `ResponseCacheMiddleware` serves never reaches a handler, so is untagged.
     */
    etag: true,
    notFound: 'public',
    requestLogging: {
      requestBody: config.log.requestBody,
      responseBody: config.log.responseBody,
      ignore: [
        `${prefix}/${HEALTH_ROUTES.LIVENESS}`,
        `${prefix}/${HEALTH_ROUTES.READINESS}`,
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
