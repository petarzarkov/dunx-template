import { Logger } from '@dunx/core';
import { EventBus } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import type { BetterAuthOptions } from 'better-auth';
import { JOBS, QUEUES } from '../notifications/events/events.js';
import { UserRegistered } from '../notifications/events/app-events.js';

/**
 * Publish `user.password_reset` when better-auth mints a reset link.
 *
 * better-auth will not offer the reset endpoints at all unless
 * `sendResetPassword` is set, so this is what turns the flow on rather than
 * decoration on top of it. The token and its expiry are better-auth's; the job
 * only carries the finished url to whatever sends mail.
 *
 * Deliberately **not** wrapped the way the registration hook is. A reset whose
 * mail was never queued is a link the user never receives, and failing the
 * request tells them to try again rather than leaving them waiting.
 */
export const passwordResetSender =
  (
    publisher: JobPublisher,
  ): NonNullable<
    NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword']
  > =>
  async ({ user, url }) => {
    await publisher.publish(QUEUES.NOTIFICATIONS, JOBS.USER_PASSWORD_RESET, {
      userId: user.id,
      email: user.email,
      url,
    });
  };

/**
 * Publish `user.registered` whenever better-auth creates a user, however it was
 * created - email sign-up, a social callback, or the admin plugin.
 *
 * This is where the NestJS template put it too, and the reason is the same: the
 * hook fires for every path into the table, where a call site in one service would
 * only cover the one it is in.
 *
 * It states a fact and publishes nothing itself. This used to enqueue the
 * welcome job directly, which meant the auth layer named the notifications
 * layer and a second reaction meant editing this file. `UserRegistered` on the
 * bus is what replaced that: the subscribers are in their own modules, and
 * adding a third is a new class rather than an edit here.
 *
 * The emit is wrapped, because a `databaseHooks.after` that throws fails the
 * sign-up. `emit` awaits every subscriber, so a queue that is down surfaces
 * here - and an unreachable queue must not stop a user registering. The welcome
 * email is the part that degrades, not the account.
 */
export const registrationHooks = (
  bus: EventBus,
  logger: Logger,
): BetterAuthOptions['databaseHooks'] => ({
  user: {
    create: {
      after: async (user) => {
        try {
          await bus.emit(new UserRegistered(user.id, user.email, user.name));
        } catch (error) {
          logger.warn('a user.registered subscriber failed', {
            userId: user.id,
            reason: (error as Error).message,
          });
        }
      },
    },
  },
});
