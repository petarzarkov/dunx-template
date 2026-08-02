import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

interface Frame {
  event: string;
  data: unknown;
}

const open = (origin: string, token?: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${origin.replace(/^http/, 'ws')}/ws`,
      token === undefined
        ? undefined
        : { headers: { authorization: `Bearer ${token}` } },
    );
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error('refused')), {
      once: true,
    });
  });

const frame = (socket: WebSocket, event: string): Promise<Frame> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event}`)), 5000);
    const listener = (message: MessageEvent): void => {
      const parsed = JSON.parse(String(message.data)) as Frame;
      if (parsed.event !== event) return;
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      resolve(parsed);
    };
    socket.addEventListener('message', listener);
  });

/**
 * The gateway shares the HTTP server, so this connects to the same port the REST
 * calls use - there is no second listener and no `/socket.io` path.
 */
describe('websocket gateway against a live server', () => {
  test('an anonymous upgrade is refused', async () => {
    const { origin } = getTestContext();
    await expect(open(origin)).rejects.toThrow('refused');
  });

  test('a bearer token opens the socket and lands in the admin room', async () => {
    const { origin, adminToken } = getTestContext();
    const socket = await open(origin, adminToken);

    const connected = await frame(socket, 'connected');
    expect((connected.data as { rooms: string[] }).rooms).toContain('admins');

    socket.close();
  });

  test('a chat message is echoed to the sender and broadcast to the room', async () => {
    const { origin, adminToken } = getTestContext();
    const listener = await open(origin, adminToken);
    await frame(listener, 'connected');
    const sender = await open(origin, adminToken);
    await frame(sender, 'connected');

    const heard = frame(listener, 'message');
    const echoed = frame(sender, 'chatMessage');
    sender.send(JSON.stringify({ event: 'chatMessage', data: 'e2e hello' }));

    expect((await echoed).data).toEqual({ delivered: 1 });
    expect((await heard).data).toMatchObject({ text: 'e2e hello' });

    listener.close();
    sender.close();
  });
});
