import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { appModule } from '../app.module.js';
import { validateConfig } from '../config/env.validation.js';
import { httpOptions } from '../http.options.js';
import { ACTOR_HEADER } from '../constants.js';
import type { Page } from '../core/pagination/page-options.dto.js';
import type { AuditLogEntry } from '../audit/dto/audit-log.dto.js';
import type { SanitizedUser } from './dto/user.dto.js';

/**
 * The whole graph behind a real `Bun.serve` on port 0, against a real in-memory
 * SQLite. `:memory:` means the drizzle-kit migrations and the audit triggers are
 * applied from scratch on every run, so this covers the boot path too.
 *
 * `prefix` is `createTestServer`'s `setGlobalPrefix`, applied before `listen()`
 * so the client's URLs carry it.
 */
let server: TestServer;
let admin: SanitizedUser;

const asAdmin = (): Record<string, string> => ({ [ACTOR_HEADER]: admin.id });

const source = { API_PORT: '0', SQLITE_DB_PATH: ':memory:' };

beforeAll(async () => {
  server = await createTestServer({
    modules: [appModule({ source, logLevel: 'fatal' })],
    prefix: 'api',
    // The harness inherits nothing from src/main.ts, so the production options
    // have to be handed over explicitly or the suite tests a server with no
    // guards and no error mapper.
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });

  // The very first user cannot come through the guarded route, because the guard
  // needs an existing admin to authorise it. Seed it the way scripts/seed.ts does.
  const { UsersRepository } = await import('./repos/users.repository.js');
  const created = server.app.get(UsersRepository).create({
    email: 'admin@local.dev',
    name: 'Admin',
    role: 'admin',
  });
  admin = { ...created, createdAt: '', updatedAt: '' } as SanitizedUser;
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

  test('readiness reports the database up', async () => {
    const { status, body } = await server.json<{
      status: string;
      info: Record<string, { status: string }>;
    }>('api/service/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.info['db']?.status).toBe('up');
  });

  test('config reports the build', async () => {
    const { status, body } = await server.json<{ name: string; env: string }>(
      'api/service/config',
    );
    expect(status).toBe(200);
    expect(body.name).toBe('dunx-template');
  });
});

describe('the guard', () => {
  test('an unauthenticated call is a 401', async () => {
    const { status, body } = await server.json<{ message: string }>(
      'api/users',
    );
    expect(status).toBe(401);
    expect(body.message).toBe('UNAUTHENTICATED');
  });

  test('an unknown actor is a 401', async () => {
    const { status } = await server.json('api/users', {
      headers: { [ACTOR_HEADER]: crypto.randomUUID() },
    });
    expect(status).toBe(401);
  });

  test('a user role cannot reach an admin-only route', async () => {
    const { body: plain } = await server.json<SanitizedUser>('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'plain@example.com', name: 'Plain' },
    });

    const { status, body } = await server.json<{ message: string }>(
      'api/users',
      {
        method: 'POST',
        headers: { [ACTOR_HEADER]: plain.id },
        json: { email: 'other@example.com', name: 'Other' },
      },
    );
    expect(status).toBe(403);
    expect(body.message).toBe('Requires one of: admin');
  });
});

describe('users CRUD', () => {
  test('POST creates at 201 and PATCH updates', async () => {
    const created = await server.json<SanitizedUser>('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'grace@example.com', name: 'Grace Hopper' },
    });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('user');

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
      json: { email: 'not-an-email', name: 'x' },
    });
    expect(status).toBe(400);
    expect(body.message).toBe('Invalid body');
    expect(body.issues.map((i) => i.path).sort()).toEqual(['email', 'name']);
  });

  test('a duplicate email is a 409', async () => {
    const { status } = await server.json('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'grace@example.com', name: 'Impostor' },
    });
    expect(status).toBe(409);
  });

  test('ban and unban flip the flag', async () => {
    const target = await server.json<SanitizedUser>('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'ban-me@example.com', name: 'Ban Me' },
    });

    const banned = await server.json<SanitizedUser>(
      `api/users/${target.body.id}/ban`,
      { method: 'POST', headers: asAdmin() },
    );
    expect(banned.body.banned).toBe(true);

    // A banned actor is rejected by the guard even with the right role.
    const rejected = await server.json(`api/users`, {
      headers: { [ACTOR_HEADER]: target.body.id },
    });
    expect(rejected.status).toBe(401);

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
    const target = await server.json<SanitizedUser>('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'delete-me@example.com', name: 'Delete Me' },
    });

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
      await server.json('api/users', {
        method: 'POST',
        headers: asAdmin(),
        json: { email: `page-${n}@example.com`, name: `Page ${n}` },
      });
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
    expect(body.message).toBe('Invalid pagination cursor');
  });

  test('take is clamped by the schema', async () => {
    const { status, body } = await server.json<{
      issues: { path: string }[];
    }>('api/users?take=999', { headers: asAdmin() });
    expect(status).toBe(400);
    expect(body.issues[0]?.path).toBe('take');
  });

  test('search filters on email and name', async () => {
    await server.json('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'findable@example.com', name: 'Zzyzx Unique' },
    });

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
  test('an insert through the API produces an INSERT row', async () => {
    const created = await server.json<SanitizedUser>('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'audited@example.com', name: 'Audited' },
    });

    const { status, body } = await server.json<Page<AuditLogEntry>>(
      `api/audit-logs?entityId=${created.body.id}`,
      { headers: asAdmin() },
    );
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);

    const entry = body.data[0];
    expect(entry?.action).toBe('INSERT');
    expect(entry?.entityName).toBe('User');
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
    const created = await server.json<SanitizedUser>('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'update-audit@example.com', name: 'Updated' },
    });
    await server.json(`api/users/${created.body.id}/ban`, {
      method: 'POST',
      headers: asAdmin(),
    });

    const { body } = await server.json<Page<AuditLogEntry>>(
      `api/audit-logs?entityId=${created.body.id}&action=UPDATE`,
      { headers: asAdmin() },
    );
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.oldValues?.['banned']).toBe(false);
    expect(body.data[0]?.newValues?.['banned']).toBe(true);
  });

  test('a delete produces a DELETE row', async () => {
    const created = await server.json<SanitizedUser>('api/users', {
      method: 'POST',
      headers: asAdmin(),
      json: { email: 'delete-audit@example.com', name: 'Deleted' },
    });
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
    );
    expect(status).toBe(404);
    expect(body.status).toBe(404);
  });

  test('an unmatched method on a matched path is a 404, not a 405', async () => {
    const response = await server.request('api/service/up', { method: 'PUT' });
    expect(response.status).toBe(404);
  });
});
