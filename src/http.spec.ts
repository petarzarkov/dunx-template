import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from './app.module.js';
import { validateConfig } from './config/env.validation.js';
import { httpOptions } from './http.options.js';
import { bearer, signIn } from './test-support/session.js';
import type { SanitizedUser } from './users/dto/user.dto.js';

/**
 * What `httpOptions` turns on for every route, and `@Idempotent()` on the two
 * creates, asserted through the real server rather than the option object.
 */
let server: TestServer;
let adminToken: string;

const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  CORS_ORIGIN: 'https://app.example',
  THROTTLE_LIMIT: '10000',
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

const newUser = (email: string) => ({
  email,
  name: 'Idempotent',
  password: 'A-strong-password-1',
});

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });
  adminToken = await signIn(server, 'admin@local.dev', 'admin-password');
}, 30_000);

afterAll(async () => {
  await server.close();
});

describe('security headers', () => {
  test('a JSON response carries the strict policy', async () => {
    const response = await server.request('api/health/live');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  test('so does a 404', async () => {
    const response = await server.request('api/no-such-route');
    expect(response.status).toBe(404);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('CSRF by Fetch Metadata', () => {
  test('a cross-site browser POST is refused before it reaches the route', async () => {
    const { status } = await server.json('api/users', {
      method: 'POST',
      headers: {
        ...bearer(adminToken),
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example',
      },
      json: newUser('csrf@local.dev'),
    });
    expect(status).toBe(403);
  });

  test('the configured CORS origin is trusted', async () => {
    const { status } = await server.json('api/users', {
      method: 'POST',
      headers: {
        ...bearer(adminToken),
        'sec-fetch-site': 'cross-site',
        origin: 'https://app.example',
      },
      json: newUser('trusted-origin@local.dev'),
    });
    expect(status).toBe(201);
  });
});

describe('ETag', () => {
  test('a GET value is tagged, and the tag earns a 304 with no body', async () => {
    const first = await server.request('api/profile', {
      headers: bearer(adminToken),
    });
    const etag = first.headers.get('etag');
    expect(etag).toStartWith('W/"');

    const again = await server.request('api/profile', {
      headers: { ...bearer(adminToken), 'if-none-match': etag ?? '' },
    });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
  });
});

describe('Idempotency-Key on POST /api/users', () => {
  test('a retry with the same key replays the first 201 instead of a 409', async () => {
    const key = crypto.randomUUID();
    const send = () =>
      server.json<SanitizedUser>('api/users', {
        method: 'POST',
        headers: { ...bearer(adminToken), 'idempotency-key': key },
        json: newUser('replayed@local.dev'),
      });

    const first = await send();
    const retry = await send();
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
  });

  test('the same key on a different body is refused', async () => {
    const key = crypto.randomUUID();
    const send = (email: string) =>
      server.json('api/users', {
        method: 'POST',
        headers: { ...bearer(adminToken), 'idempotency-key': key },
        json: newUser(email),
      });

    expect((await send('reused-a@local.dev')).status).toBe(201);
    expect((await send('reused-b@local.dev')).status).toBe(422);
  });

  test('without a key the route behaves as it always did', async () => {
    const body = newUser('unkeyed@local.dev');
    const first = await server.json('api/users', {
      method: 'POST',
      headers: bearer(adminToken),
      json: body,
    });
    const second = await server.json('api/users', {
      method: 'POST',
      headers: bearer(adminToken),
      json: body,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });
});
