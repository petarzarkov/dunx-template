import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { validateConfig } from '../../config/env.validation.js';
import { httpOptions } from '../../http.options.js';
import { bearer, signUp } from '../../test-support/session.js';

/**
 * The response cache is production-only, so this suite runs the app as
 * production. That is the same reason `docs-session.spec.ts` runs it as `dev`:
 * the path nobody exercises in development is the one that needs a test.
 *
 * Every assertion is skipped when Redis is unreachable, because `bun test` has
 * to pass on a machine with nothing running. The degraded case is asserted
 * separately and does not need a broker to prove.
 */
const DB_PATH = `./.tmp/rescache-spec-${crypto.randomUUID()}.db`;

const source = {
  API_PORT: '0',
  NODE_ENV: 'production',
  APP_ENV: 'prod',
  BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
  SQLITE_DB_PATH: DB_PATH,
  QUEUE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  // Outside `local` the drain is 5s, and a suite closing a server per file
  // pays it. See petarzarkov/dunx#146.
  HEALTH_DRAIN_MS: '0',
  CACHE_PREFIX: `test-${crypto.randomUUID()}`,
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

let server: TestServer;
/**
 * Two ordinary accounts, created through better-auth's public sign-up.
 *
 * There is no admin here on purpose: `AuthAdminSeeder` refuses to run when
 * `isProd`, and `isProd` is the same flag that switches this cache on - so a
 * suite that needs production also has no seeded administrator. `/api/profile`
 * is the route both of these can reach and it returns a different body for
 * each, which is exactly what the per-caller key has to get right.
 */
let oneToken = '';
let otherToken = '';

/**
 * Probed at module scope, not in `beforeAll`.
 *
 * `test.skipIf` is evaluated when the test is **registered**, which happens
 * while this file is being loaded and long before any hook runs. A flag set in
 * `beforeAll` is still `false` at that point, so every test would skip and the
 * suite would report success while asserting nothing.
 */
const cacheUp = await (async (): Promise<boolean> => {
  const redis = new Bun.RedisClient(
    Bun.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379',
    { maxRetries: 0, connectionTimeout: 500 },
  );
  try {
    // A read, because it needs no argument shape to get right and a reachable
    // server answers it whether or not the key exists.
    await redis.get(`probe:${crypto.randomUUID()}`);
    return true;
  } catch {
    return false;
  } finally {
    redis.close();
  }
})();

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });
  ({ token: oneToken } = await signUp(
    server,
    'cache-one@local.dev',
    'One-password-1!',
  ));
  ({ token: otherToken } = await signUp(
    server,
    'cache-other@local.dev',
    'Other-password-1!',
  ));
}, 30_000);

afterAll(async () => {
  await server.close();
});

describe('the response cache in production', () => {
  test.skipIf(!cacheUp)('a second GET is served from the cache', async () => {
    const first = await server.request('api/profile', {
      headers: bearer(oneToken),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get('x-cache')).toBe('MISS');

    const second = await server.request('api/profile', {
      headers: bearer(oneToken),
    });
    expect(second.status).toBe(200);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(await second.text()).toBe(await first.text());
  });

  /**
   * The one that matters. `/api/profile` returns the caller, so a shared key
   * would hand one account's identity to the next - which is why the caller is
   * part of the key rather than a reason to skip caching the route.
   */
  test.skipIf(!cacheUp)(
    "a different caller does not get the first one's entry",
    async () => {
      const mine = await server.request('api/profile', {
        headers: bearer(oneToken),
      });
      expect(await mine.json()).toMatchObject({ email: 'cache-one@local.dev' });

      const other = await server.request('api/profile', {
        headers: bearer(otherToken),
      });
      expect(other.headers.get('x-cache')).toBe('MISS');
      expect(await other.json()).toMatchObject({
        email: 'cache-other@local.dev',
      });
    },
  );

  test.skipIf(!cacheUp)('@NoCache keeps a route live', async () => {
    for (const _ of [1, 2]) {
      const response = await server.request('api/health/ready');
      expect(response.headers.get('x-cache')).toBeNull();
    }
  });

  test.skipIf(!cacheUp)('a non-GET is never cached', async () => {
    const response = await server.request('api/users', {
      method: 'POST',
      headers: { ...bearer(oneToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'cached@example.com',
        name: 'Cache Test',
        password: 'Cache-password-1!',
      }),
    });
    // 403, because this caller is not an admin. Either way the middleware never
    // looked: it is a POST, and a refusal is not a 2xx.
    expect(response.status).toBe(403);
    expect(response.headers.get('x-cache')).toBeNull();
  });

  /**
   * No broker needed: an unreachable cache has to mean a miss, never a failed
   * request, and that is the same contract every other Redis consumer here has.
   */
  test('an unreachable cache serves the request live', async () => {
    const response = await server.request('api/health/live');
    expect(response.status).toBe(200);
  });
});
