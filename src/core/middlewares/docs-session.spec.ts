import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { validateConfig } from '../../config/env.validation.js';
import { httpOptions } from '../../http.options.js';

/**
 * The docs gate only engages outside `local`, so this suite runs the app as
 * `dev`. That is the whole reason it is worth a test: the default developer
 * experience never exercises this path, so a regression here is invisible until
 * a deployed environment is serving its own route table to anyone who asks.
 */
const DB_PATH = `./.tmp/docs-spec-${crypto.randomUUID()}.db`;

const base = {
  API_PORT: '0',
  SQLITE_DB_PATH: DB_PATH,
  QUEUE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

const gated = {
  ...base,
  APP_ENV: 'dev',
  BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
};

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source: gated, logLevel: 'fatal' })],
    prefix: 'api',
    ...httpOptions(validateConfig(gated)),
    requestLogging: false,
  });
});

afterAll(async () => {
  await server.close();
});

describe('the documentation pages outside local', () => {
  test.each([
    ['api/docs', 'Swagger'],
    ['api/openapi.json', 'the document itself'],
    ['api/public', 'Scalar'],
  ])('%s needs a session', async (path) => {
    const response = await server.request(path);
    expect(response.status).toBe(401);
    // A browser has a cookie and no way to send a bearer token, so the refusal
    // is a form rather than a dead end.
    expect(await response.text()).toContain('These docs need a session');
  });

  /**
   * The explorers link their own assets from under their mount. Gating the page
   * and serving its script anonymously would be pointless; gating the page and
   * 401ing its script would be broken. Both are covered by the prefix match.
   */
  test('an explorer asset is gated with its page', async () => {
    const response = await server.request('api/public/standalone.js');
    expect(response.status).toBe(401);
  });

  test('signing in through the form redirects back, and then it opens', async () => {
    const form = new FormData();
    form.set('email', 'admin@local.dev');
    form.set('password', 'admin-password');

    const posted = await server.request('api/docs', {
      method: 'POST',
      body: form,
      redirect: 'manual',
    });
    expect(posted.status).toBe(302);
    expect(posted.headers.get('location')).toBe('/api/docs');

    const cookie = posted.headers.getSetCookie().join('; ');
    expect(cookie).not.toBe('');

    /**
     * No longer refused, which is what this middleware decides. It is not a 200:
     * the explorer is mounted by `OpenApiModule`, and this harness builds
     * `AppModule` alone, so the request now falls through to a real 404. That
     * the page renders is `openapi.spec.ts`'s assertion, over a root that has
     * the module in it.
     */
    const opened = await server.request('api/docs', { headers: { cookie } });
    expect(opened.status).not.toBe(401);
  });

  test('bad credentials get the form back, not a redirect', async () => {
    const form = new FormData();
    form.set('email', 'admin@local.dev');
    form.set('password', 'not-the-password');

    const posted = await server.request('api/docs', {
      method: 'POST',
      body: form,
      redirect: 'manual',
    });
    expect(posted.status).toBe(401);
    expect(await posted.text()).toContain('Invalid credentials');
  });
});
