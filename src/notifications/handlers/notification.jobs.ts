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
  type UserRegisteredJob,
} from '../events/events.js';
import { EmailService } from '../services/email.service.js';

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
  constructor(
    private readonly email: EmailService,
    private readonly events: EventsPublisher,
    private readonly logger: Logger,
  ) {}

  @JobHandler({ queue: QUEUES.NOTIFICATIONS, name: JOBS.USER_REGISTERED })
  async registered(job: Job<UserRegisteredJob>): Promise<{ notified: string }> {
    const { userId, email, name } = job.data;

    await this.email.send({
      to: email,
      subject: 'Welcome',
      body: `Hello ${name}, your account is ready.`,
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

    this.logger.info('handled user.registered', { userId });
    return { notified: userId };
  }

  @JobHandler({ queue: QUEUES.NOTIFICATIONS, name: JOBS.USER_BANNED })
  async banned(job: Job<UserBannedJob>): Promise<{ notified: string }> {
    const { userId, email, reason } = job.data;

    await this.email.send({
      to: email,
      subject: 'Your account has been suspended',
      body: reason,
    });

    this.events.publish(TOPICS.ADMINS, EVENTS.NOTIFICATION, {
      event: JOBS.USER_BANNED,
      payload: { userId, reason },
    });

    return { notified: userId };
  }
}
