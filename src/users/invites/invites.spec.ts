import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { validateConfig } from '../../config/env.validation.js';
import { httpOptions } from '../../http.options.js';
import { bearer, signIn, signUp } from '../../test-support/session.js';
import type { SanitizedUser } from '../dto/user.dto.js';
import { InvitesRepository } from './repos/invites.repository.js';
import { InviteStatus } from './schema/invite.schema.js';
import type { Invite } from './dto/invite.dto.js';

/**
 * The invite flow is the one place this app creates an account for somebody who
 * has no session, so the code is the entire authorisation and most of what is
 * worth asserting is what happens when it is wrong.
 */
const DB_PATH = `./.tmp/invites-spec-${crypto.randomUUID()}.db`;

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
let repo: InvitesRepository;
let adminToken = '';
let userToken = '';

const asAdmin = () => bearer(adminToken);

const invite = (email: string, role = 'user') =>
  server.json<Invite>('api/invites', {
    method: 'POST',
    headers: asAdmin(),
    json: { email, role },
  });

const accept = (inviteCode: string, password: string, name?: string) =>
  server.json<SanitizedUser>('api/invites/accept', {
    method: 'POST',
    json:
      name === undefined
        ? { inviteCode, password }
        : { inviteCode, password, name },
  });

/** The code never leaves the server through a route, so read it from the table. */
const codeFor = (email: string): string => {
  const row = repo.findByEmail(email);
  if (row === undefined) throw new Error(`no invite for ${email}`);
  return row.inviteCode;
};

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });
  repo = server.app.get(InvitesRepository);
  adminToken = await signIn(server, 'admin@local.dev', 'admin-password');
  ({ token: userToken } = await signUp(
    server,
    'plain@local.dev',
    'Plain-password-1!',
  ));
}, 30_000);

afterAll(async () => {
  await server.close();
});

describe('issuing invitations', () => {
  test('an admin invites an address and it comes back pending', async () => {
    const { status, body } = await invite('ada@example.com');
    expect(status).toBe(201);
    expect(body).toMatchObject({
      email: 'ada@example.com',
      role: 'user',
      status: InviteStatus.PENDING,
    });
  });

  /**
   * The credential must not travel on a route an admin can read, or one leaked
   * list response is every pending account.
   */
  test('neither the create nor the list response carries the code', async () => {
    const { body } = await invite('grace@example.com');
    expect(body).not.toHaveProperty('inviteCode');

    const listed = await server.json<Invite[]>('api/invites', {
      headers: asAdmin(),
    });
    expect(listed.body.length).toBeGreaterThan(0);
    for (const row of listed.body) expect(row).not.toHaveProperty('inviteCode');
  });

  test('a non-admin cannot invite or list', async () => {
    const created = await server.json('api/invites', {
      method: 'POST',
      headers: bearer(userToken),
      json: { email: 'nope@example.com' },
    });
    expect(created.status).toBe(403);
    expect(
      (await server.json('api/invites', { headers: bearer(userToken) })).status,
    ).toBe(403);
  });

  test('inviting an address that already has an account is a 409', async () => {
    const { status } = await invite('plain@local.dev');
    expect(status).toBe(409);
  });

  /**
   * `email` is unique, so re-inviting has to reuse the row. The previous code
   * stops working, which is the intended reading of "send them another invite".
   */
  test('a second invite to the same address replaces the first code', async () => {
    await invite('twice@example.com');
    const first = codeFor('twice@example.com');

    await invite('twice@example.com');
    const second = codeFor('twice@example.com');

    expect(second).not.toBe(first);
    expect(
      repo.list().filter((r) => r.email === 'twice@example.com'),
    ).toHaveLength(1);

    const stale = await accept(first, 'Stale-password-1!');
    expect(stale.status).toBe(403);
  });

  test('an admin can revoke a pending invitation', async () => {
    const { body } = await invite('revoked@example.com');
    const code = codeFor('revoked@example.com');

    const deleted = await server.request(`api/invites/${body.id}`, {
      method: 'DELETE',
      headers: asAdmin(),
    });
    expect(deleted.status).toBe(204);
    expect((await accept(code, 'Revoked-password-1!')).status).toBe(403);
  });
});

describe('redeeming an invitation', () => {
  test('a valid code creates an account that can sign in', async () => {
    await invite('linus@example.com');
    const { status, body } = await accept(
      codeFor('linus@example.com'),
      'Linus-password-1!',
      'Linus T',
    );

    expect(status).toBe(201);
    expect(body).toMatchObject({ email: 'linus@example.com', name: 'Linus T' });

    // The credential is real, which is the point of going through better-auth's
    // own sign-up rather than inserting the row.
    const token = await signIn(
      server,
      'linus@example.com',
      'Linus-password-1!',
    );
    expect(token.length).toBeGreaterThan(0);
  });

  test('the invited role is applied, not the plugin default', async () => {
    await invite('boss@example.com', 'admin');
    const { body } = await accept(
      codeFor('boss@example.com'),
      'Boss-password-1!',
    );
    expect(body.role).toBe('admin');
  });

  test('a code cannot be redeemed twice', async () => {
    await invite('once@example.com');
    const code = codeFor('once@example.com');

    expect((await accept(code, 'Once-password-1!')).status).toBe(201);
    expect((await accept(code, 'Once-password-1!')).status).toBe(403);
  });

  test('an expired code is refused and the row is marked expired', async () => {
    const { body } = await invite('late@example.com');
    const code = codeFor('late@example.com');

    repo.upsert({
      id: body.id,
      email: 'late@example.com',
      inviteCode: code,
      role: 'user',
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() - 1000),
    });

    expect((await accept(code, 'Late-password-1!')).status).toBe(403);
    expect(repo.findByEmail('late@example.com')?.status).toBe(
      InviteStatus.EXPIRED,
    );
  });

  /**
   * Every refusal is the same 403 with the same wording. A distinct "expired" or
   * "already used" would let someone probe which codes exist.
   */
  test('an unknown code is refused indistinguishably', async () => {
    const unknown = await server.json<{ message: string }>(
      'api/invites/accept',
      {
        method: 'POST',
        json: { inviteCode: 'f'.repeat(64), password: 'Unknown-password-1!' },
      },
    );
    expect(unknown.status).toBe(403);

    await invite('probe@example.com');
    const spent = codeFor('probe@example.com');
    await accept(spent, 'Probe-password-1!');
    const reused = await server.json<{ message: string }>(
      'api/invites/accept',
      {
        method: 'POST',
        json: { inviteCode: spent, password: 'Probe-password-1!' },
      },
    );

    // Same status and the same words. An "expired" that read differently from
    // an "already used" would be a probe for which codes exist.
    expect(reused.status).toBe(unknown.status);
    expect(reused.body.message).toBe(unknown.body.message);
    expect(unknown.body.message).toBe('Invalid invite');
  });

  test('the accept route needs no session, but still validates the password', async () => {
    await invite('weak@example.com');
    const { status } = await accept(codeFor('weak@example.com'), 'password');
    expect(status).toBe(400);
  });
});
