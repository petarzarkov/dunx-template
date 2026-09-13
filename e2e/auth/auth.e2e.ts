import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import { APP_DIR, drain, getTestContext, serverEnv } from '../setup/context.js';
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
let workerOutput: () => string = () => '';

beforeAll(async () => {
  if (!queueUp) return;

  /**
   * The round trip needs something to consume the job, and a worker is its own
   * container in its own process - which is the whole point of the test.
   *
   * `serverEnv()` rather than `process.env`: the two processes have to agree on
   * the queue prefix, the relay channel and the broker, and the defaults that
   * make them agree live in the setup file rather than the environment.
   */
  worker = Bun.spawn(['bun', 'src/worker.ts'], {
    cwd: APP_DIR,
    env: serverEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Drained, or the pipe fills and blocks the child. It is also the only way to
  // find out why a worker that failed to boot never consumed anything.
  const out = drain(worker.stdout as ReadableStream<Uint8Array> | undefined);
  const err = drain(worker.stderr as ReadableStream<Uint8Array> | undefined);
  workerOutput = () => `${out()}${err()}`;

  await Bun.sleep(2500);
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

      /**
       * Every address this test created, matched against rather than the last
       * one, because the trigger is retried below.
       *
       * Matching on content at all is because the queue outlives the process
       * that filled it: a rerun against the same broker delivers a leftover
       * notification for somebody else's job first.
       */
      const mine = new Set<string>();
      const notification = frame(socket, 'notification', {
        timeoutMs: 25_000,
        where: (received) => {
          const email = (received.data as { payload?: { email?: string } })
            .payload?.email;
          return email !== undefined && mine.has(email);
        },
      });

      /**
       * Published more than once, spaced out.
       *
       * The web node subscribes to the relay channel at boot with
       * `maxRetries: 0`, and recovers from a failed subscribe on a bounded
       * timer - so a single publish can land in the gap and reach nobody. One
       * retry is the difference between asserting the round trip and asserting
       * that the relay happened to be warm.
       */
      const publish = async (): Promise<void> => {
        const email = `roundtrip-${crypto.randomUUID()}@example.com`;
        mine.add(email);
        const created = await api.post<User>('users', {
          email,
          name: 'Round Trip',
          password: 'Roundtrip-password-1!',
        });
        expect(created.status).toBe(201);
      };

      await publish();
      const retry = setInterval(() => void publish(), 6000);

      // Without the worker's own output a timeout here says only "no frame",
      // which is the one thing already known.
      const received = await notification
        .catch((error: Error) => {
          throw new Error(
            `${error.message}\nworker output:\n${workerOutput()}`,
          );
        })
        .finally(() => {
          clearInterval(retry);
        });

      expect(received.data).toMatchObject({ event: 'user.registered' });
      expect(
        mine.has(
          (received.data as { payload: { email: string } }).payload.email,
        ),
      ).toBe(true);

      socket.close();
    },
    30_000,
  );
});
