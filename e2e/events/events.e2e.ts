import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';
import { frame, open } from '../utils/ws-client.js';

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
