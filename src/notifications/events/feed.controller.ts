import { Controller, Roles, Sse, SseStream, type SseInput } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { EventBus } from '@dunx/core';
import { UserRole } from '../../users/schema/user.schema.js';
import { UserRegistered } from './app-events.js';

/**
 * The same notifications the websocket gateway carries, over Server-Sent Events.
 *
 * Both are here because they are not the same tool. The gateway is duplex and
 * fans out across processes through the Redis relay, which is what the chat page
 * needs. SSE is one-way, survives any proxy that speaks HTTP/1.1, reconnects by
 * itself and needs no client library at all - `new EventSource('/api/feed')` is
 * the whole browser side. For a dashboard that only ever listens, that is less
 * machinery for the same result.
 *
 * The trade this deliberately does not hide: **this feed is per process.** It
 * subscribes to the in-process `EventBus`, so behind two replicas a client sees
 * only what its own node handled. The gateway's `RedisRelay` is what solves that
 * for the websocket, and an SSE feed that needed the same would subscribe to the
 * relay rather than the bus.
 */
@ApiDoc({
  tags: ['notifications'],
  description: 'A one-way event stream, for a client that only listens.',
})
@Controller('feed')
export class FeedController {
  constructor(private readonly bus: EventBus) {}

  /**
   * `heartbeatMs` is what keeps an idle stream alive: a proxy that sees no bytes
   * for its own timeout closes the connection, and a comment line costs two
   * bytes and resets that clock.
   *
   * `Last-Event-ID` arrives as `input.lastEventId` when a client reconnects.
   * Nothing here replays from it - that needs a log of past events, which this
   * app keeps in `audit_log` rather than in memory - so it is reported and not
   * pretended about.
   */
  @ApiDoc({ tags: ['notifications'], summary: 'Live registrations, as SSE' })
  @Roles(UserRole.ADMIN)
  @Sse('/')
  stream(input: SseInput<Record<never, never>>): SseStream {
    const events = new SseStream({ heartbeatMs: 15_000 });

    events.comment(
      input.lastEventId === undefined
        ? 'connected'
        : `reconnected after ${input.lastEventId}; this feed does not replay`,
    );

    /**
     * Unsubscribed by the stream's own `signal`, which aborts when the client
     * goes away. Without that a closed browser tab would leave a subscriber on
     * the bus for the life of the process.
     */
    this.bus.on(
      UserRegistered,
      (event: UserRegistered) => {
        events.send({
          event: 'user.registered',
          id: event.userId,
          data: { userId: event.userId, email: event.email },
        });
      },
      { signal: events.signal },
    );

    return events;
  }
}
