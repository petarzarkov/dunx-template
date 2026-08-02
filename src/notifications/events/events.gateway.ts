import { Auth, rolesOf } from '@dunx/auth';
import { Logger } from '@dunx/core';
import {
  Gateway,
  HttpStatusCode,
  OnClose,
  OnMessage,
  OnOpen,
  OnUpgrade,
  type Socket,
} from '@dunx/http';
import type { BunRequest } from 'bun';
import { UserRole } from '../../users/schema/user.schema.js';
import { EventsPublisher } from './events.publisher.js';
import { CLIENT_EVENTS, EVENTS, TOPICS, userTopic } from './events.js';

export interface SocketContext {
  readonly userId: string;
  readonly email: string;
  readonly roles: readonly string[];
}

/**
 * Served by the same `Bun.serve` call as the HTTP routes: `HttpFactory` discovers
 * the gateway from `providers`, and `listen()` mounts the upgrade as a native
 * route. There is no second server, no adapter and no `socket.io`.
 *
 * The NestJS template used `@WebSocketGateway()` with `socket.io`, a
 * `SocketConfigAdapter` to inject options, two `io.use()` middlewares for context
 * and auth, `@socket.io/redis-adapter` with two extra connections for multi-node
 * fan-out and `@socket.io/redis-emitter` for the worker. Here: one class, one
 * `@OnUpgrade` for auth, Bun's own pub/sub for rooms, and one `RedisRelay` in
 * `HttpOptions` for fan-out.
 */
@Gateway('/ws')
export class EventsGateway {
  constructor(
    private readonly auth: Auth,
    private readonly events: EventsPublisher,
    private readonly logger: Logger,
  ) {}

  /**
   * Runs before the socket exists, and is the only place a connection can be
   * refused: return a `Response` and there is no upgrade. Anything else returned
   * becomes `socket.data.context`, which is how the authenticated user is carried
   * onto the connection without a second lookup per frame.
   *
   * It is handed the `BunRequest` because the upgrade really is a route - Bun
   * matched it - so `Cookie` and `Authorization` are both readable, and better-auth
   * reads whichever is present. That is the whole of the socket authentication:
   * the same `api.getSession` the HTTP guard calls.
   */
  @OnUpgrade()
  async upgrade(req: BunRequest): Promise<Response | SocketContext> {
    const principal = await this.auth.api.getSession({ headers: req.headers });
    if (principal === null) {
      return new Response('UNAUTHENTICATED', {
        status: HttpStatusCode.UNAUTHORIZED,
      });
    }
    const { user } = principal;
    return { userId: user.id, email: user.email, roles: rolesOf(user) };
  }

  @OnOpen()
  opened(socket: Socket<SocketContext>): void {
    const { userId, roles, email } = socket.data.context;

    // Bun's own pub/sub - a topic lives in the runtime, not in a JavaScript map,
    // and with the relay configured it spans processes too.
    socket.subscribe(userTopic(userId));
    socket.subscribe(TOPICS.CHAT);
    if (roles.includes(UserRole.ADMIN)) socket.subscribe(TOPICS.ADMINS);

    socket.send(
      JSON.stringify({
        event: EVENTS.CONNECTED,
        data: { userId, email, rooms: this.rooms(roles, userId) },
      }),
    );
    this.logger.info('socket opened', { userId });
  }

  /**
   * `@OnMessage('chatMessage')` receives the **decoded payload**, not the raw
   * frame, and whatever it returns is replied to the sender under the same event
   * name. The wire envelope is `{"event":"chatMessage","data":...}`.
   */
  @OnMessage(CLIENT_EVENTS.CHAT_MESSAGE)
  chat(
    text: unknown,
    socket: Socket<SocketContext>,
  ): { delivered: number } | { error: string } {
    if (typeof text !== 'string' || text.length === 0 || text.length > 1000) {
      return { error: 'a chat message is a string of 1 to 1000 characters' };
    }
    const { userId, email } = socket.data.context;
    // Published rather than `socket.publish`, so the frame goes through the relay
    // and reaches the other nodes as well as this one's subscribers.
    this.events.publish(TOPICS.CHAT, EVENTS.MESSAGE, {
      from: email,
      userId,
      text,
    });
    return { delivered: 1 };
  }

  @OnClose()
  closed(socket: Socket<SocketContext>, code: number): void {
    this.logger.info('socket closed', {
      userId: socket.data.context.userId,
      code,
    });
  }

  private rooms(roles: readonly string[], userId: string): readonly string[] {
    const rooms = [userTopic(userId), TOPICS.CHAT];
    return roles.includes(UserRole.ADMIN) ? [...rooms, TOPICS.ADMINS] : rooms;
  }
}
