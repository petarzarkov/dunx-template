import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@dunx/testing';
import { appModule } from '../../app.module.js';
import { validateConfig } from '../../config/env.validation.js';
import { httpOptions } from '../../http.options.js';
import { signIn, signUp } from '../../test-support/session.js';
import { CLIENT_EVENTS, EVENTS, TOPICS, userTopic } from './events.js';
import { EventsPublisher } from './events.publisher.js';

/**
 * The gateway is served by the same `Bun.serve` call as the HTTP routes, so there
 * is no second port and no adapter: the upgrade is a native route in the same
 * table, and `@OnUpgrade` is the only place a connection can be refused.
 *
 * The socket authenticates with the same bearer token the HTTP routes take, which
 * is the whole of the socket auth story - `auth.api.getSession` reads the headers
 * of the upgrade request.
 */
let server: TestServer;
let adminToken: string;
let wsBase: string;

const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

interface Frame {
  event: string;
  data: unknown;
}

/** Opens a socket and resolves once it is open, or rejects on the refusal. */
const connect = (token?: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${wsBase}/ws`,
      token === undefined
        ? undefined
        : { headers: { authorization: `Bearer ${token}` } },
    );
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error('the upgrade was refused')),
      { once: true },
    );
  });

/** The next frame carrying `event`, or a rejection after `timeoutMs`. */
const nextFrame = (
  socket: WebSocket,
  event: string,
  timeoutMs = 4000,
): Promise<Frame> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no "${event}" frame within ${timeoutMs}ms`)),
      timeoutMs,
    );
    const listener = (message: MessageEvent): void => {
      const frame = JSON.parse(String(message.data)) as Frame;
      if (frame.event !== event) return;
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      resolve(frame);
    };
    socket.addEventListener('message', listener);
  });

beforeAll(async () => {
  server = await createTestServer({
    modules: [appModule({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });
  adminToken = await signIn(server, 'admin@local.dev', 'admin-password');
  // The gateway path is **not** under the global prefix: `setGlobalPrefix`
  // prefixes discovered controller routes, and a gateway is mounted at the path
  // `@Gateway()` names.
  wsBase = server.url.replace(/^http/, 'ws').replace(/\/$/, '');
});

afterAll(async () => {
  await server.close();
});

describe('the upgrade is the guard', () => {
  test('the gateway is mounted where @Gateway declared it', () => {
    expect(server.app.gatewayPaths).toEqual(['/ws']);
  });

  test('an anonymous upgrade is refused with a 401 and never becomes a socket', async () => {
    await expect(connect()).rejects.toThrow('the upgrade was refused');
  });

  test('a forged token is refused too', async () => {
    await expect(connect('not-a-real-token')).rejects.toThrow(
      'the upgrade was refused',
    );
  });

  test('a session opens the socket and the rooms come back on it', async () => {
    const socket = await connect(adminToken);
    const frame = await nextFrame(socket, EVENTS.CONNECTED);

    const data = frame.data as { email: string; rooms: string[] };
    expect(data.email).toBe('admin@local.dev');
    // An admin is in the admin room; a plain user is not.
    expect(data.rooms).toContain(TOPICS.ADMINS);
    expect(data.rooms).toContain(TOPICS.CHAT);
    socket.close();
  });

  test('a non-admin is not subscribed to the admin room', async () => {
    const plain = await signUp(
      server,
      'socket-user@example.com',
      'a-password-1',
    );
    const socket = await connect(plain.token);
    const frame = await nextFrame(socket, EVENTS.CONNECTED);

    const data = frame.data as { rooms: string[] };
    expect(data.rooms).not.toContain(TOPICS.ADMINS);
    expect(data.rooms).toContain(userTopic(plain.userId));
    socket.close();
  });
});

describe('messages and fan-out', () => {
  test('@OnMessage receives the decoded payload and replies under the same event', async () => {
    const socket = await connect(adminToken);
    await nextFrame(socket, EVENTS.CONNECTED);

    const reply = nextFrame(socket, CLIENT_EVENTS.CHAT_MESSAGE);
    socket.send(
      JSON.stringify({ event: CLIENT_EVENTS.CHAT_MESSAGE, data: 'hello' }),
    );

    expect((await reply).data).toEqual({ delivered: 1 });
    socket.close();
  });

  test('a chat message reaches every subscriber of the topic', async () => {
    const listener = await connect(adminToken);
    await nextFrame(listener, EVENTS.CONNECTED);
    const sender = await connect(adminToken);
    await nextFrame(sender, EVENTS.CONNECTED);

    const heard = nextFrame(listener, EVENTS.MESSAGE);
    sender.send(
      JSON.stringify({ event: CLIENT_EVENTS.CHAT_MESSAGE, data: 'broadcast' }),
    );

    expect((await heard).data).toMatchObject({
      from: 'admin@local.dev',
      text: 'broadcast',
    });
    listener.close();
    sender.close();
  });

  test('a bad payload is answered, not dropped', async () => {
    const socket = await connect(adminToken);
    await nextFrame(socket, EVENTS.CONNECTED);

    const reply = nextFrame(socket, CLIENT_EVENTS.CHAT_MESSAGE);
    socket.send(
      JSON.stringify({ event: CLIENT_EVENTS.CHAT_MESSAGE, data: 42 }),
    );

    expect((await reply).data).toMatchObject({ error: expect.any(String) });
    socket.close();
  });

  /**
   * A service with no socket of its own publishes through `EventsPublisher`, which
   * is bound to `PubSub` in a web process. This is the path a job handler takes in
   * the same process; in the worker the binding is the Redis relay instead, and
   * neither the handler nor this test knows the difference.
   */
  test('a service can publish to a topic without holding a socket', async () => {
    const socket = await connect(adminToken);
    await nextFrame(socket, EVENTS.CONNECTED);

    const heard = nextFrame(socket, EVENTS.NOTIFICATION);
    server.app
      .get(EventsPublisher)
      .publish(TOPICS.ADMINS, EVENTS.NOTIFICATION, { event: 'test', n: 1 });

    expect((await heard).data).toMatchObject({ event: 'test', n: 1 });
    socket.close();
  });
});
