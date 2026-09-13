import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Auth } from '@dunx/auth';
import { HttpFactory, type HttpApp } from '@dunx/http';
import { OpenApiModule } from '@dunx/openapi';
import { SwaggerRenderer } from '@dunx/openapi/swagger';
import { testRoot } from '@dunx/testing';
import { AppModule } from '../app.module.js';
import { AccountsModule } from './auth.module.js';
import { validateConfig } from '../config/env.validation.js';
import { AppConfigService } from '../config/app.config.service.js';
import { httpOptions } from '../http.options.js';
import { docsAuthorize } from './docs-authorize.js';

/**
 * The documentation gate, through the module that owns it.
 *
 * `createTestServer` cannot be used: the gate is `OpenApiModule`'s, and that
 * module has to wrap the root rather than sit inside it. This is the same
 * `testRoot` arrangement `openapi.spec.ts` uses, and the same one `main.ts`
 * builds in production - including `imports: [AccountsModule]`, which is the
 * only way the factory can close over the `Auth` the container owns.
 *
 * The app runs as `dev`, because the gate is open in `local` and a suite that
 * never leaves the default would assert nothing.
 */
const DB_PATH = `./.tmp/docs-authorize-${crypto.randomUUID()}.db`;

const source = {
  API_PORT: '0',
  APP_ENV: 'dev',
  BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
  SQLITE_DB_PATH: DB_PATH,
  QUEUE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  /**
   * 3.9.1 has `@dunx/testing` zero the shutdown drain, which is why the other
   * suites no longer set this. It cannot reach here: this suite builds through
   * `HttpFactory.create` rather than `createTestServer`, because the gate
   * belongs to `OpenApiModule` and that module has to wrap the root. So the
   * harness never sees the app and never gets to override anything.
   *
   * Without it the drain is 5s outside `local`, which is over Bun's default
   * hook timeout and surfaces as an `(unnamed)` failure naming no line.
   */
  HEALTH_DRAIN_MS: '0',
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

const config = validateConfig(source);
let app: HttpApp;
let base = '';
let cookie = '';

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers, redirect: 'manual' });

beforeAll(async () => {
  app = await HttpFactory.create(
    OpenApiModule.forRootAsync({
      root: testRoot([AppModule.forRoot({ source, logLevel: 'fatal' })]),
      renderer: new SwaggerRenderer(),
      imports: [AccountsModule],
      useFactory: (settings: AppConfigService, auth: Auth) => {
        const { env, prefix } = settings.get('app');
        const authorize = docsAuthorize(auth, env, prefix);
        return {
          title: 'dunx-template',
          version: '0.1.0',
          ...(authorize === undefined ? {} : { authorize }),
        };
      },
      inject: [AppConfigService, Auth] as const,
    }),
    { ...httpOptions(config), requestLogging: false },
  );
  app.setGlobalPrefix('api');
  base = await app.listen(0);

  // A real session, taken the way any browser would: better-auth's own endpoint
  // sets the cookie, and the gate reads it back off the raw request.
  const signedIn = await fetch(`${base}api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@local.dev',
      password: 'admin-password',
    }),
  });
  cookie = signedIn.headers.getSetCookie().join('; ');
}, 30_000);

afterAll(async () => {
  await app.shutdown();
});

describe('the documentation gate outside local', () => {
  test.each([
    ['api/docs', 'the page'],
    ['api/openapi.json', 'the document'],
  ])('%s needs a session', async (path) => {
    const response = await get(path);
    expect(response.status).toBe(401);
    // A form rather than a bare 404: the caller is a browser with a cookie and
    // no way to send a bearer token, which is what `AuthorizeDecision`
    // returning a `Response` is for.
    expect(await response.text()).toContain('These docs need a session');
  });

  /**
   * The reason this moved out of a middleware. The explorer serves its own
   * assets from under its mount, and the module knows those paths where an app
   * restating them by hand does not.
   */
  test('the explorer assets are gated with the page', async () => {
    const page = await get('api/docs', { cookie });
    expect(page.status).toBe(200);

    const asset = [...(await page.text()).matchAll(/src="([^"]+)"/g)]
      .map(([, href]) => href ?? '')
      .find((href) => href.startsWith('/api/docs/'));
    expect(asset).toBeDefined();

    expect((await get(asset?.slice(1) ?? '')).status).toBe(401);
    expect((await get(asset?.slice(1) ?? '', { cookie })).status).toBe(200);
  });

  test('a session opens the page and the document', async () => {
    expect((await get('api/docs', { cookie })).status).toBe(200);

    const document = await get('api/openapi.json', { cookie });
    expect(document.status).toBe(200);
    expect(await document.json()).toMatchObject({ openapi: '3.1.0' });
  });

  test('the form signs in against better-auth rather than a route of its own', async () => {
    const body = await (await get('api/docs')).text();
    // There is no server-side POST handler any more, so the form has to name
    // the real endpoint. A stale path here is a form that silently never works.
    expect(body).toContain('/api/auth/sign-in/email');
  });
});
