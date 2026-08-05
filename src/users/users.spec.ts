import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../app.module.js';
import { validateConfig } from '../config/env.validation.js';
import { httpOptions } from '../http.options.js';
import { bearer, signIn, signUp } from '../test-support/session.js';
import type { Page } from '@dunx/infra/pagination';
import type { AuditLogEntry } from '../audit/dto/audit-log.dto.js';
import type { SanitizedUser } from './dto/user.dto.js';

/**
 * The whole graph behind a real `Bun.serve` on port 0, against a real in-memory
 * SQLite - migrations, triggers, Better Auth and all. `:memory:` means every table
 * is created from scratch on each run, so this covers the boot path too.
 *
 * `prefix` is `createTestServer`'s `setGlobalPrefix`, applied before `listen()` so
 * the client's URLs carry it, and so better-auth's `basePath` of `/api/auth` is the
 * URL its handler actually answers on.
 */
let server: TestServer;
let adminToken: string;
let admin: SanitizedUser;

const asAdmin = (): Record<string, string> => bearer(adminToken);

const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  // The throttler is exercised in its own suite; a shared window here would make
  // every other assertion depend on how many ran before it.
  THROTTLE_LIMIT: '10000',
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

const create = (
  email: string,
  name: string,
  extra: Record<string, unknown> = {},
) =>
  server.json<SanitizedUser>('api/users', {
    method: 'POST',
    headers: asAdmin(),
    json: { email, name, password: 'a-strong-password', ...extra },
  });

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    // The harness inherits nothing from src/main.ts, so the production options
    // have to be handed over explicitly or the suite tests a server with no
    // guards and no error mapper.
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });

  // `AuthAdminSeeder` created this at `onInit`, through better-auth's own sign-up,
  // so it has a credential and can actually sign in.
  adminToken = await signIn(server, 'admin@local.dev', 'admin-password');
  admin = (await server
    .json<SanitizedUser>('api/profile', {
      headers: asAdmin(),
    })
    .then((r) => r.body)) as unknown as SanitizedUser;
});

afterAll(async () => {
  await server.close();
});

describe('GET /api/service/*', () => {
  test('liveness needs no credential', async () => {
    const { status, body } = await server.json<{ uptimeSeconds: number }>(
      'api/service/up',
    );
    expect(status).toBe(200);
    expect(body.uptimeSeconds).toBeGreaterThan(0);
  });

  test('readiness reports the database up and never fails on a missing service', async () => {
    const { status, body } = await server.json<{
      status: string;
      info: Record<string, { status: string }>;
      degraded: Record<string, { status: string }>;
    }>('api/service/health');

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.info['db']?.status).toBe('up');
    expect(body.info['storage']?.status).toBe('up');
    expect(body.info['images']?.status).toBe('up');
    // Redis may or may not be running. Either way the probe passes: a degraded
    // area is reported, not failed.
    expect(
      body.info['cache']?.status ?? body.degraded['cache']?.status,
    ).toBeDefined();
  });

  test('config reports the build', async () => {
    const { status, body } = await server.json<{ name: string; env: string }>(
      'api/service/config',
    );
    expect(status).toBe(200);
    expect(body.name).toBe('dunx-template');
  });
});

describe('SessionGuard', () => {
  test('an unauthenticated call is a 401', async () => {
    const { status, body } = await server.json<{ message: string }>(
      'api/users',
    );
    expect(status).toBe(401);
    expect(body.message).toBe('UNAUTHENTICATED');
  });

  test('a forged bearer token is a 401', async () => {
    const { status } = await server.json('api/users', {
      headers: bearer('not-a-real-session-token'),
    });
    expect(status).toBe(401);
  });

  test('better-auth own endpoints are @Public(), so sign-in is reachable', async () => {
    const response = await server.request('api/auth/sign-in/email', {
      method: 'POST',
      json: { email: 'admin@local.dev', password: 'wrong-password' },
    });
    // Reached the handler and was refused by better-auth, not by the guard.
    expect(response.status).toBe(401);
    expect(response.headers.get('set-auth-token')).toBeNull();
  });

  test('@Public() on a route skips the session lookup entirely', async () => {
    const { status, body } = await server.json<{ caller: string | null }>(
      'api/profile/anonymous',
    );
    expect(status).toBe(200);
    expect(body.caller).toBeNull();
  });

  test('a user role cannot reach an admin-only route', async () => {
    const plain = await signUp(server, 'plain@example.com', 'a-password-123');

    const { status, body } = await server.json<{ message: string }>(
      'api/users',
      {
        method: 'POST',
        headers: bearer(plain.token),
        json: {
          email: 'other@example.com',
          name: 'Other',
          password: 'a-password-123',
        },
      },
    );
    expect(status).toBe(403);
    expect(body.message).toBe('Requires one of: admin');
  });

  test('the caller reaches a service through AuthContext, not a parameter', async () => {
    const { status, body } = await server.json<{
      email: string;
      roles: string[];
    }>('api/profile', { headers: asAdmin() });

    expect(status).toBe(200);
    expect(body.email).toBe('admin@local.dev');
    expect(body.roles).toContain('admin');
  });
});

describe('users CRUD', () => {
  test('POST creates a signed-in-able user at 201 and PATCH updates', async () => {
    const created = await create('grace@example.com', 'Grace Hopper');
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('user');

    // The credential is real: the created user can sign in.
    const token = await signIn(
      server,
      'grace@example.com',
      'a-strong-password',
    );
    expect(token.length).toBeGreaterThan(0);

    const patched = await server.json<SanitizedUser>(
      `api/users/${created.body.id}`,
      { method: 'PATCH', headers: asAdmin(), json: { name: 'Grace M Hopper' } },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Grace M Hopper');
  });

  test('a bad body is a 400 carrying the zod issues', async () => {
    const { status, body } = await server.json<{
      message: string;
      issues: { path: string }[];
    }>('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'not-an-email', name: 'x', password: 'short' },
    });
    expect(status).toBe(400);
    expect(body.message).toBe('Invalid body');
    expect(body.issues.map((i) => i.path).sort()).toEqual([
      'email',
      'name',
      'password',
    ]);
  });

  test('a duplicate email is a 409', async () => {
    const { status } = await create('grace@example.com', 'Impostor');
    expect(status).toBe(409);
  });

  test('ban and unban flip the flag', async () => {
    const target = await create('ban-me@example.com', 'Ban Me');

    const banned = await server.json<SanitizedUser>(
      `api/users/${target.body.id}/ban`,
      { method: 'POST', headers: asAdmin() },
    );
    expect(banned.body.banned).toBe(true);

    const unbanned = await server.json<SanitizedUser>(
      `api/users/${target.body.id}/unban`,
      { method: 'POST', headers: asAdmin() },
    );
    expect(unbanned.body.banned).toBe(false);
  });

  test('banning yourself is a 403', async () => {
    const { status, body } = await server.json<{ message: string }>(
      `api/users/${admin.id}/ban`,
      { method: 'POST', headers: asAdmin() },
    );
    expect(status).toBe(403);
    expect(body.message).toBe('You cannot ban your own account');
  });

  test('DELETE returns 204 with no body', async () => {
    const target = await create('delete-me@example.com', 'Delete Me');

    const response = await server.request(`api/users/${target.body.id}`, {
      method: 'DELETE',
      headers: asAdmin(),
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');

    const gone = await server.json(`api/users/${target.body.id}`, {
      headers: asAdmin(),
    });
    expect(gone.status).toBe(404);
  });

  test('a non-uuid path param is a 400 from the params schema', async () => {
    const { status, body } = await server.json<{ message: string }>(
      'api/users/not-a-uuid',
      { headers: asAdmin() },
    );
    expect(status).toBe(400);
    expect(body.message).toBe('Invalid params');
  });
});

describe('keyset pagination', () => {
  beforeAll(async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      await create(`page-${n}@example.com`, `Page ${n}`);
    }
  });

  test('walks forward with a cursor and never repeats a row', async () => {
    const first = await server.json<Page<SanitizedUser>>('api/users?take=2', {
      headers: asAdmin(),
    });
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.hasNextPage).toBe(true);
    expect(first.body.meta.hasPreviousPage).toBe(false);

    const cursor = first.body.meta.nextCursor;
    expect(cursor).not.toBeNull();

    const second = await server.json<Page<SanitizedUser>>(
      `api/users?take=2&cursor=${encodeURIComponent(cursor as string)}`,
      { headers: asAdmin() },
    );
    const firstIds = first.body.data.map((u) => u.id);
    const secondIds = second.body.data.map((u) => u.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    expect(second.body.meta.hasPreviousPage).toBe(true);
  });

  test('a garbage cursor is a 400', async () => {
    const { status, body } = await server.json<{ message: string }>(
      'api/users?cursor=garbage',
      { headers: asAdmin() },
    );
    expect(status).toBe(400);
    // The framework's wording, not this app's: `CursorError` is raised by
    // `@dunx/infra/pagination` and the error mapper passes its message through.
    expect(body.message).toBe('Invalid pagination cursor.');
  });

  test('take is clamped by the schema', async () => {
    const { status, body } = await server.json<{
      issues: { path: string }[];
    }>('api/users?take=999', { headers: asAdmin() });
    expect(status).toBe(400);
    expect(body.issues[0]?.path).toBe('take');
  });

  test('search filters on email and name', async () => {
    await create('findable@example.com', 'Zzyzx Unique');

    const byName = await server.json<Page<SanitizedUser>>(
      'api/users?search=Zzyzx',
      { headers: asAdmin() },
    );
    expect(byName.body.data).toHaveLength(1);
    expect(byName.body.data[0]?.email).toBe('findable@example.com');

    const byEmail = await server.json<Page<SanitizedUser>>(
      'api/users?search=findable',
      { headers: asAdmin() },
    );
    expect(byEmail.body.data).toHaveLength(1);
  });
});

describe('audit trail written by SQLite triggers', () => {
  test('an insert through the API produces an INSERT row attributed to the session', async () => {
    const created = await create('audited@example.com', 'Audited');

    const { status, body } = await server.json<Page<AuditLogEntry>>(
      `api/audit-logs?entityId=${created.body.id}&action=INSERT`,
      { headers: asAdmin() },
    );
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);

    const entry = body.data[0];
    expect(entry?.entityName).toBe('User');
    // The actor is the authenticated caller, resolved by `SessionGuard` and
    // stamped by `AuditContextMiddleware` - not a header the client supplied.
    expect(entry?.actorId).toBe(admin.id);
    expect(entry?.oldValues).toBeNull();
    expect(entry?.newValues).toEqual({
      email: 'audited@example.com',
      name: 'Audited',
      role: 'user',
      banned: false,
    });
  });

  test('a ban produces an UPDATE row with both snapshots', async () => {
    const created = await create('update-audit@example.com', 'Updated');
    await server.json(`api/users/${created.body.id}/ban`, {
      method: 'POST',
      headers: asAdmin(),
    });

    const { body } = await server.json<Page<AuditLogEntry>>(
      `api/audit-logs?entityId=${created.body.id}&action=UPDATE`,
      { headers: asAdmin() },
    );
    const ban = body.data.find((e) => e.newValues?.['banned'] === true);
    expect(ban).toBeDefined();
    expect(ban?.oldValues?.['banned']).toBe(false);
  });

  test('a delete produces a DELETE row', async () => {
    const created = await create('delete-audit@example.com', 'Deleted');
    await server.request(`api/users/${created.body.id}`, {
      method: 'DELETE',
      headers: asAdmin(),
    });

    const { body } = await server.json<Page<AuditLogEntry>>(
      `api/audit-logs?entityId=${created.body.id}&action=DELETE`,
      { headers: asAdmin() },
    );
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.newValues).toBeNull();
  });
});

describe('routing', () => {
  test('an unmatched path is the framework 404 through the middleware chain', async () => {
    const { status, body } = await server.json<{ status: number }>(
      'api/nothing-here',
      { headers: asAdmin() },
    );
    expect(status).toBe(404);
    expect(body.status).toBe(404);
  });

  test('an unmatched method on a matched path is a 404, not a 405', async () => {
    const response = await server.request('api/service/up', {
      method: 'PUT',
      headers: asAdmin(),
    });
    expect(response.status).toBe(404);
  });

  /**
   * This was a KNOWN GAP and is now closed by configuration, so the test is
   * inverted rather than deleted.
   *
   * `Bun.serve({ routes })` answers a miss itself, so `listen()` installs one
   * `fetch` fallback that puts the global middleware in front of a 404 - which is
   * what gets an unmatched path logged and given a request id. The middleware
   * includes `SessionGuard`, and a path that matched no route carries no route
   * metadata, so there was no `@Public()` for the guard to read: an anonymous
   * request for a path that did not exist was answered 401 rather than 404.
   *
   * The note used to say this was "arguably better, since it stops an anonymous
   * caller probing which paths exist", and that there was "no way to keep the
   * logging without also authenticating the miss". The second half was wrong -
   * `HttpOptions.notFound: 'public'` reports the miss as `@Public()` and keeps the
   * log line and the request id - and the first half does not hold for this app,
   * whose route table is published at `/api/docs`. It also charged a better-auth
   * session lookup to every unmatched request.
   *
   * See http.options.ts. A miss is a 404 here, as it is in NestJS.
   */
  test('an anonymous request for a missing path is a 404', async () => {
    const { status, body } = await server.json<{ error: string }>(
      'api/nothing-here',
    );
    expect(status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
  });
});
