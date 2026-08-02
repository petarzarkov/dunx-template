import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  banned: boolean;
}

describe('users against a live server', () => {
  test('the guard rejects an anonymous caller', async () => {
    const { api } = getTestContext();
    const { status } = await api.as(undefined).json('users');
    expect(status).toBe(401);
  });

  test('a created user has a real credential and can sign in', async () => {
    const { api } = getTestContext();
    const email = `signin-${crypto.randomUUID()}@example.com`;

    const created = await api.post<User>('users', {
      email,
      name: 'Sign In',
      password: 'an-e2e-password',
    });
    expect(created.status).toBe(201);

    const response = await api.as(undefined).raw('auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'an-e2e-password' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-auth-token')).not.toBeNull();
  });

  test('create, read, patch and delete round-trip through a real file', async () => {
    const { api, db } = getTestContext();
    const email = `e2e-${crypto.randomUUID()}@example.com`;

    const created = await api.post<User>('users', {
      email,
      name: 'Round Trip',
      password: 'an-e2e-password',
    });
    expect(created.status).toBe(201);

    const read = await api.json<User>(`users/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.email).toBe(email);

    const patched = await api.json<User>(`users/${created.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Patched' }),
    });
    expect(patched.body.name).toBe('Patched');

    // Three audit rows so far, all written by the triggers rather than by code:
    // the INSERT from better-auth's sign-up, the UPDATE that applies the role, and
    // the UPDATE from the PATCH.
    const before = db.countAuditRows(created.body.id);
    expect(before).toBe(3);

    const deleted = await api.raw(`users/${created.body.id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(204);
    expect(db.countAuditRows(created.body.id)).toBe(before + 1);
  });

  test('validation rejects a bad body with the issue list', async () => {
    const { api } = getTestContext();
    const { status, body } = await api.post<{
      message: string;
      issues: { path: string }[];
    }>('users', { email: 'nope', name: '', password: 'x' });
    expect(status).toBe(400);
    expect(body.message).toBe('Invalid body');
    expect(body.issues.length).toBeGreaterThan(0);
  });

  test('the OpenAPI document is served and parses', async () => {
    const { api } = getTestContext();
    const { status, body } = await api.json<{ openapi: string }>(
      'openapi.json',
    );
    expect(status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
  });

  test('the explorer page is served as HTML', async () => {
    const { api } = getTestContext();
    const response = await api.raw('docs');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });
});
