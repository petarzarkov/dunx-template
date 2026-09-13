import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import { getTestContext } from '../setup/context.js';
import { frame, open } from '../utils/ws-client.js';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface Caller {
  id: string;
  email: string;
  roles: string[];
}

const APP_DIR = new URL('../..', import.meta.url).pathname;

/**
 * Whether a broker is reachable, probed at **module scope**.
 *
 * `test.skipIf` is evaluated when a test is registered, which happens while this
 * file is loaded and before any hook runs - so a flag set in `beforeAll` is
 * still `false` there and every guarded test would skip while the suite reported
 * success. That is why this cannot ask the app through `getTestContext`, which
 * only exists after the preload's own hook.
 */
const queueUp = await (async (): Promise<boolean> => {
  const redis = new Bun.RedisClient(
    Bun.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379',
    { maxRetries: 0, connectionTimeout: 500 },
  );
  try {
    await redis.get(`e2e-probe:${crypto.randomUUID()}`);
    return true;
  } catch {
    return false;
  } finally {
    redis.close();
  }
})();

let worker: Subprocess | undefined;

beforeAll(async () => {
  if (queueUp) {
    // The round trip below needs something to consume the job. A worker is its
    // own container in its own process, which is the whole point of the test.
    worker = Bun.spawn(['bun', 'src/worker.ts'], {
      cwd: APP_DIR,
      env: { ...process.env, LOG_LEVEL: 'fatal' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await Bun.sleep(2500);
  }
}, 30_000);

afterAll(() => {
  worker?.kill();
});

describe('authentication against a live server', () => {
  test('a valid credential returns a session token', async () => {
    const { api } = getTestContext();
    const response = await api.as(undefined).raw('auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@e2e-test.com',
        password: 'e2e-admin-password',
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-auth-token')).not.toBeNull();
  });

  test('a wrong password is refused', async () => {
    const { api } = getTestContext();
    const response = await api.as(undefined).raw('auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@e2e-test.com',
        password: 'not-the-password',
      }),
    });
    expect(response.status).toBe(401);
  });

  test('the profile route reports the session the guard resolved', async () => {
    const { api, adminId } = getTestContext();
    const { status, body } = await api.json<Caller>('profile');
    expect(status).toBe(200);
    expect(body.id).toBe(adminId);
    expect(body.roles).toContain('admin');
  });

  test('an unauthenticated caller gets 401, and a public route still answers', async () => {
    const { api } = getTestContext();
    expect((await api.as(undefined).json('profile')).status).toBe(401);

    const anonymous = await api
      .as(undefined)
      .json<{ caller: string | null }>('profile/anonymous');
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.caller).toBeNull();
  });

  /**
   * The test the port dropped, and the one worth having: signing out has to
   * actually invalidate the token, not just clear a cookie the test client does
   * not have. With `secondaryStorage` configured the live session is in Redis
   * and the table is the durable record, so a sign-out that only deleted one of
   * the two would still answer 200 here and leave the token working.
   */
  test('signing out invalidates the token it was issued for', async () => {
    const { api } = getTestContext();
    const email = `signout-${crypto.randomUUID()}@example.com`;
    const password = 'Signout-password-1!';

    const created = await api.post<User>('users', {
      email,
      name: 'Sign Out',
      password,
    });
    expect(created.status).toBe(201);

    const signedIn = await api.as(undefined).raw('auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const token = signedIn.headers.get('set-auth-token');
    expect(token).not.toBeNull();

    const session = api.as(token ?? '');
    expect((await session.json('profile')).status).toBe(200);

    const out = await session.raw('auth/sign-out', { method: 'POST' });
    expect(out.ok).toBe(true);

    expect((await session.json('profile')).status).toBe(401);
  });

  test('a registered account can sign in immediately', async () => {
    const { api } = getTestContext();
    const email = `register-${crypto.randomUUID()}@example.com`;

    const registered = await api.as(undefined).raw('auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: 'Register-password-1!',
        name: 'Registered',
      }),
    });
    expect(registered.ok).toBe(true);

    const signedIn = await api.as(undefined).raw('auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'Register-password-1!' }),
    });
    expect(signedIn.status).toBe(200);
  });
});

/**
 * The single most valuable end-to-end assertion in this repo, and the other one
 * the port dropped.
 *
 * It crosses every process boundary the app has in one test: an HTTP request in
 * the web process writes a row and publishes a job, a **worker in a second
 * process** consumes it, and the frame it publishes comes back to a websocket
 * held by the first. Each half is tested on its own elsewhere; only this proves
 * they are connected.
 *
 * The worker has no `PubSub` - `WorkerFactory` builds a container with no server
 * in it - so the frame travels over the relay channel, which is the path that
 * has no unit test at all.
 */
describe('a job published by the web process reaches a socket', () => {
  test.skipIf(!queueUp)(
    'creating a user notifies the admin room from the worker',
    async () => {
      const { api, origin, adminToken } = getTestContext();

      const socket = await open(origin, adminToken);
      await frame(socket, 'connected');

      const email = `roundtrip-${crypto.randomUUID()}@example.com`;

      /**
       * Listening before the write, or the notification races the upgrade, and
       * matching on **this** email: the queue outlives the process that filled
       * it, so a rerun against the same broker delivers leftovers first.
       */
      const notification = frame(socket, 'notification', {
        timeoutMs: 20_000,
        where: (received) =>
          (received.data as { payload?: { email?: string } }).payload?.email ===
          email,
      });

      const created = await api.post<User>('users', {
        email,
        name: 'Round Trip',
        password: 'Roundtrip-password-1!',
      });
      expect(created.status).toBe(201);

      const received = await notification;
      expect(received.data).toMatchObject({
        event: 'user.registered',
        payload: { email },
      });

      socket.close();
    },
    30_000,
  );
});
