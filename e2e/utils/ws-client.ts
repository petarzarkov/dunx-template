export interface Frame {
  event: string;
  data: unknown;
}

/**
 * Opens the gateway on the same origin the REST calls use. There is no second
 * listener and no `/socket.io` path: the upgrade is a route in the same
 * `Bun.serve` table.
 *
 * A refused upgrade never becomes a socket, so `@OnUpgrade` returning a 401
 * surfaces here as an `error` event rather than a response with a body.
 */
export const open = (origin: string, token?: string): Promise<WebSocket> =>
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

export interface WaitOptions {
  readonly timeoutMs?: number;
  /**
   * Which frame of that event to accept.
   *
   * Needed because a queue outlives the process that filled it: a rerun against
   * the same broker can deliver a notification left over from the last one, and
   * a test that took the first `notification` it saw would assert against
   * somebody else's job. Matching on content rather than arrival order is the
   * only thing that makes this reliable.
   */
  readonly where?: (frame: Frame) => boolean;
}

/**
 * The next frame carrying `event` and satisfying `where`, ignoring everything
 * else on the socket.
 *
 * Filtering rather than taking the first message is what makes this usable on a
 * connection that also receives chat and notifications: a test waiting for one
 * event should not fail because an unrelated one arrived first.
 */
export const frame = (
  socket: WebSocket,
  event: string,
  options: WaitOptions = {},
): Promise<Frame> => {
  const { timeoutMs = 5000, where } = options;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no matching ${event} within ${timeoutMs}ms`)),
      timeoutMs,
    );
    const listener = (message: MessageEvent): void => {
      const parsed = JSON.parse(String(message.data)) as Frame;
      if (parsed.event !== event) return;
      if (where !== undefined && !where(parsed)) return;
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      resolve(parsed);
    };
    socket.addEventListener('message', listener);
  });
};
