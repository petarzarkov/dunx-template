import { Logger } from '@dunx/core';
import { JobHandler } from '@dunx/infra/queue';
import type { Job } from 'bullmq';
import { EventsPublisher } from '../events/events.publisher.js';
import {
  EVENTS,
  JOBS,
  QUEUES,
  TOPICS,
  userTopic,
  type UserBannedJob,
  type UserInvitedJob,
  type UserPasswordResetJob,
  type UserRegisteredJob,
} from '../events/events.js';
import { EmailService } from '@dunx/infra/email';
import { AppConfigService } from '../../config/app.config.service.js';
import { DOMAIN_EVENTS } from '../messaging/domain-events.js';
import { DomainPublisher } from '../messaging/domain-publisher.js';
import Invite from '../email/templates/invite.js';
import PasswordReset from '../email/templates/password-reset.js';
import Welcome from '../email/templates/welcome.js';

/**
 * A job handler is a method with a decorator and nothing else - no class decorator,
 * no `@Processor`, no queue token, no registry. `WorkerFactory` finds it by walking
 * the prototypes of the classes already in `providers`, which is the same
 * marker-plus-scan the route and gateway discovery use.
 *
 * The NestJS template had to add `@JobHandler` itself on top of `@nestjs/bullmq`,
 * plus a `JobDispatcher` that walked the `DiscoveryService` and a forked
 * `job.processor.ts` to give the worker a DI context. All of that is
 * `WorkerFactory.create(WorkerModule)` here.
 */
export class NotificationJobs {
  /** The app's own public origin, which is the one link a welcome mail needs. */
  readonly #signInUrl: string;

  constructor(
    private readonly email: EmailService,
    private readonly events: EventsPublisher,
    private readonly logger: Logger,
    config: AppConfigService,
    private readonly domain: DomainPublisher,
  ) {
    this.#signInUrl = config.get('auth').baseUrl;
  }

  @JobHandler({ queue: QUEUES.NOTIFICATIONS, name: JOBS.USER_REGISTERED })
  async registered(job: Job<UserRegisteredJob>): Promise<{ notified: string }> {
    const { userId, email, name } = job.data;

    /**
     * `sendTemplate` renders through the same `ReactEmailRenderer` instance
     * `bun run mail:preview` loads, so what an inbox gets is what the preview
     * showed. The bodies are not built here at all.
     */
    await this.email.sendTemplate({
      to: email,
      subject: 'Welcome',
      template: Welcome,
      props: { name, signInUrl: this.#signInUrl },
    });

    // Two topics: the user's own, and the admin room. Written by the worker
    // process, so a browser seeing this is proof the frame crossed processes.
    this.events.publish(userTopic(userId), EVENTS.NOTIFICATION, {
      event: JOBS.USER_REGISTERED,
      payload: { userId, email, name },
    });
    this.events.publish(TOPICS.ADMINS, EVENTS.NOTIFICATION, {
      event: JOBS.USER_REGISTERED,
      payload: { userId, email },
    });

    /**
     * Announced after the work, not instead of it. The job is what this system
     * owed; this is what it tells anyone else who cares, and it cannot fail the
     * handler.
     */
    await this.domain.announce(DOMAIN_EVENTS.USER_REGISTERED, {
      userId,
      email,
    });

    this.logger.info('handled user.registered', { userId });
    return { notified: userId };
  }

  /**
   * The reset link, delivered. Nothing is published to a socket: a reset is
   * proof of access to the mailbox, and announcing it on the user's own topic
   * would show it to whoever already holds the session.
   */
  @JobHandler({ queue: QUEUES.NOTIFICATIONS, name: JOBS.USER_PASSWORD_RESET })
  async passwordReset(
    job: Job<UserPasswordResetJob>,
  ): Promise<{ notified: string }> {
    const { userId, email, url } = job.data;

    await this.email.sendTemplate({
      to: email,
      subject: 'Reset your password',
      template: PasswordReset,
      props: { url },
    });

    this.logger.info('handled user.password_reset', { userId });
    return { notified: userId };
  }

  /**
   * The invite, delivered. The code is in the mail and nowhere else: it is not
   * logged, not published to a socket, and the admin room is told an address was
   * invited without being told what would let them redeem it.
   */
  @JobHandler({ queue: QUEUES.NOTIFICATIONS, name: JOBS.USER_INVITED })
  async invited(job: Job<UserInvitedJob>): Promise<{ notified: string }> {
    const { inviteId, email, role, inviteCode, expiresAt } = job.data;

    await this.email.sendTemplate({
      to: email,
      subject: 'You have been invited',
      template: Invite,
      props: { role, inviteCode, expiresAt },
    });

    this.events.publish(TOPICS.ADMINS, EVENTS.NOTIFICATION, {
      event: JOBS.USER_INVITED,
      payload: { inviteId, email, role },
    });

    this.logger.info('handled user.invited', { inviteId });
    return { notified: email };
  }

  @JobHandler({ queue: QUEUES.NOTIFICATIONS, name: JOBS.USER_BANNED })
  async banned(job: Job<UserBannedJob>): Promise<{ notified: string }> {
    const { userId, email, reason } = job.data;

    // No template: one sentence, and a React tree for it would be ceremony.
    // `send` and `sendTemplate` are both on the service for exactly this.
    await this.email.send({
      to: email,
      subject: 'Your account has been suspended',
      text: reason,
    });

    this.events.publish(TOPICS.ADMINS, EVENTS.NOTIFICATION, {
      event: JOBS.USER_BANNED,
      payload: { userId, reason },
    });

    return { notified: userId };
  }
}
