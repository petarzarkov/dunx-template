import { Logger } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import type { BetterAuthOptions } from 'better-auth';
import { JOBS, QUEUES } from '../notifications/events/events.js';

/**
 * Publish `user.registered` whenever better-auth creates a user, however it was
 * created - email sign-up, a social callback, or the admin plugin.
 *
 * This is where the NestJS template put it too, and the reason is the same: the
 * hook fires for every path into the table, where a call site in one service would
 * only cover the one it is in.
 *
 * The enqueue is wrapped, because a `databaseHooks.after` that throws fails the
 * sign-up. An unreachable queue must not stop a user registering - the welcome
 * email is the part that degrades, not the account.
 */
export const registrationHooks = (
  publisher: JobPublisher,
  logger: Logger,
): BetterAuthOptions['databaseHooks'] => ({
  user: {
    create: {
      after: async (user) => {
        try {
          await publisher.publish(QUEUES.NOTIFICATIONS, JOBS.USER_REGISTERED, {
            userId: user.id,
            email: user.email,
            name: user.name,
          });
        } catch (error) {
          logger.warn('welcome notification not queued', {
            userId: user.id,
            reason: (error as Error).message,
          });
        }
      },
    },
  },
});
