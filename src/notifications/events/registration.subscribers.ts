import { Logger, OnEvent } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import { DOMAIN_EVENTS } from '../messaging/domain-events.js';
import { DomainPublisher } from '../messaging/domain-publisher.js';
import { UserRegistered } from './app-events.js';
import { JOBS, QUEUES } from './events.js';

/**
 * Two reactions to one fact, in two classes, neither of which the publisher
 * names.
 *
 * They were one before: the welcome job was enqueued by `auth.hooks.ts` and the
 * domain announcement was made from inside the job handler that sent the email.
 * That second one was the giveaway - announcing to other services is not part of
 * sending a welcome email, it was just the place that happened to have the data.
 *
 * `EventRegistry` finds these by walking the prototype chains of classes the
 * modules already declare, so they need no registration beyond being in
 * `providers`.
 */
export class QueueWelcomeEmail {
  constructor(
    private readonly publisher: JobPublisher,
    private readonly logger: Logger,
  ) {}

  /**
   * Returns nothing, deliberately.
   *
   * `emit` awaits whatever a handler returns, and this handler is reached from
   * better-auth's `user.create.after` hook - which runs while the row that
   * caused it is still being written. Awaiting a Redis round trip there holds
   * the write open, and with a worker consuming against the same SQLite file
   * that is enough to turn a user creation into `SQLITE_BUSY`. It did, in the
   * e2e suite, reproducibly.
   *
   * So the publish is detached and carries its own failure handling. The trade
   * is real and worth stating: nothing downstream knows whether the job was
   * queued. That is the right trade for a welcome email and would be the wrong
   * one for anything the caller needs a guarantee about - which would be work
   * for the request path, not a subscriber.
   */
  @OnEvent(UserRegistered)
  queue(event: UserRegistered): void {
    void this.publisher
      .publish(QUEUES.NOTIFICATIONS, JOBS.USER_REGISTERED, {
        userId: event.userId,
        email: event.email,
        name: event.name,
      })
      .catch((error: unknown) => {
        this.logger.warn('welcome notification not queued', {
          userId: event.userId,
          reason: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

/**
 * The announcement, now that it has a reason to exist on its own rather than
 * riding the email handler.
 *
 * `DomainPublisher` never throws, so this needs no guard of its own.
 */
export class AnnounceRegistration {
  constructor(private readonly domain: DomainPublisher) {}

  /** Detached for the same reason, and `announce` never throws anyway. */
  @OnEvent(UserRegistered)
  announce(event: UserRegistered): void {
    void this.domain.announce(DOMAIN_EVENTS.USER_REGISTERED, {
      userId: event.userId,
      email: event.email,
    });
  }
}
