import { Logger } from '@dunx/core';
import { AmqpHandler, type AmqpMessage } from '@dunx/infra/amqp';
import { ConsumerStatus } from 'rabbitmq-client';
import { z } from 'zod';
import { AUDIT_QUEUE, EVENTS_EXCHANGE } from './domain-events.js';

/**
 * `AmqpMessage<T>` is a compile-time shape and nothing validates what the broker
 * actually delivered. A body from an older producer, or from anything else that
 * can reach the exchange, arrives as whatever it is - so it is parsed here.
 */
const Announcement = z.object({}).loose();

/**
 * The consuming side, subscribed to **this app's own** exchange.
 *
 * A service consuming its own announcements is not what a topic exchange is for.
 * It is here because a template has to show the consume side working, and the
 * alternative is a second service nobody can run - so one queue binds `#` and
 * writes a line, which is exactly what a real subscriber in another codebase
 * would do before it did something useful.
 *
 * The binding is `#`, so adding a routing key to `DOMAIN_EVENTS` needs no change
 * here. That is the property worth demonstrating: a subscriber binds a pattern,
 * not a list.
 */
export class AuditMessages {
  /** Capped, because `consume: true` runs for the life of the process. */
  static readonly KEEP = 50;

  readonly seen: { event: string; at: string }[] = [];

  constructor(private readonly logger: Logger) {}

  @AmqpHandler({
    queue: AUDIT_QUEUE,
    exchange: EVENTS_EXCHANGE,
    routingKey: '#',
    /**
     * `requeue: false`: a body this handler can never parse would otherwise go
     * back on the queue and be redelivered forever. A throw is still right for a
     * failure that might succeed later - this is for the one that cannot.
     */
    consumer: { concurrency: 2, requeue: false },
  })
  record(message: AmqpMessage<unknown>): ConsumerStatus | void {
    const parsed = Announcement.safeParse(message.body);
    if (!parsed.success) return ConsumerStatus.DROP;

    const event = message.routingKey ?? 'unknown';
    this.seen.push({ event, at: new Date().toISOString() });
    if (this.seen.length > AuditMessages.KEEP) this.seen.shift();

    this.logger.info('domain event observed', { event });
  }
}
