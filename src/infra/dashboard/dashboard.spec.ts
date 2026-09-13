import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { validateConfig } from '../../config/env.validation.js';
import { httpOptions } from '../../http.options.js';
import { bearer, signIn, signUp } from '../../test-support/session.js';
import { DASHBOARD_PATH } from './dashboard.module.js';

/**
 * The dashboard is the one surface that is **not** a discovered route, so nothing
 * in the route table or the OpenAPI document describes who may reach it. Its
 * `authorize` callback is the whole access control, and it runs ahead of
 * `SessionGuard` where no context exists yet - which is exactly the arrangement
 * that is easy to get wrong and impossible to notice.
 *
 * The NestJS template put `HtmlSessionAuthMiddleware` in front of Bull Board for
 * the same reason. This is that check, asserted.
 */
const DB_PATH = `./.tmp/dashboard-spec-${crypto.randomUUID()}.db`;

const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: DB_PATH,
  QUEUE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

let server: TestServer;
let adminToken = '';
let userToken = '';

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });
  adminToken = await signIn(server, 'admin@local.dev', 'admin-password');
  ({ token: userToken } = await signUp(
    server,
    'dash-user@local.dev',
    'Dash-user-password-1!',
  ));
});

afterAll(async () => {
  await server.close();
});

describe(`GET ${DASHBOARD_PATH}`, () => {
  /**
   * 404 rather than 401 or 403, and that is the point: a prober cannot learn the
   * mount exists. Asserting the code rather than just "not 200" is what keeps
   * that property from being quietly traded away.
   */
  test('an anonymous request cannot tell the mount exists', async () => {
    const response = await server.request(DASHBOARD_PATH.slice(1));
    expect(response.status).toBe(404);
  });

  test('a signed-in non-admin is refused the same way', async () => {
    const response = await server.request(DASHBOARD_PATH.slice(1), {
      headers: bearer(userToken),
    });
    expect(response.status).toBe(404);
  });

  test('an admin gets the page', async () => {
    const response = await server.request(DASHBOARD_PATH.slice(1), {
      headers: bearer(adminToken),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  /**
   * Every panel has a JSON sibling, and they are reached directly by the page's
   * own polling - so they carry the same guard rather than inheriting it from the
   * HTML route.
   */
  test('the panel JSON is guarded too', async () => {
    const path = `${DASHBOARD_PATH.slice(1)}/api/queues`;
    expect((await server.request(path)).status).toBe(404);

    const allowed = await server.request(path, { headers: bearer(adminToken) });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      queues: expect.arrayContaining(['media', 'notifications']),
    });
  });
});
