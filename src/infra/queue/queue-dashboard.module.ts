import { Auth, rolesOf } from '@dunx/auth';
import { Logger } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import { QueueDashboardModule } from '@dunx/queue-dashboard';
import type { DynamicModule } from '@dunx/core';
import { AppConfigService } from '../../config/app.config.service.js';
import { QUEUES } from '../../notifications/events/events.js';
import { UserRole } from '../../users/schema/user.schema.js';

/**
 * Bull Board, mounted on `Bun.serve`.
 *
 * This replaces `QueuesController`, which served job counts, one job's state, retry
 * and drain as admin-only JSON. That existed because the NestJS template mounted
 * `@bull-board/express` and dunx had no counterpart - Bull Board is an
 * Express-mounted React application and `Bun.serve` is not Express - so the app
 * settled for the *data* and left the page to whatever rendered it.
 *
 * `@dunx/queue-dashboard` is that counterpart. bull-board's `IServerAdapter` turns
 * out to be a sink, so implementing it over `Bun.serve` is about a page of code, and
 * the real UI is served with its static assets streamed from `Bun.file`. The
 * template's JSON is gone rather than kept alongside: it was a reimplementation of
 * a page that now exists, and an admin endpoint that enqueues an arbitrary job by
 * name is not something to keep for its own sake.
 *
 * ## The queues are a thunk
 *
 * Constructing a bullmq `Queue` opens a connection, so naming them eagerly would
 * make an app that mounts a dashboard connect to Redis at boot even when nobody
 * opens the page - which would break the one contract this template keeps
 * everywhere: it boots with nothing running. The thunk is called on the first
 * dashboard request.
 */
export class QueueDashboardFeatureModule {
  static forRoot(): DynamicModule {
    return {
      module: QueueDashboardFeatureModule,
      imports: [
        QueueDashboardModule.forRootAsync({
          useFactory: (
            publisher: JobPublisher,
            auth: Auth,
            config: AppConfigService,
            logger: Logger,
          ) => ({
            path: '/queues',
            queues: () => Object.values(QUEUES).map((q) => publisher.queue(q)),
            uiConfig: { boardTitle: `${config.get('app').name} queues` },
            /**
             * Asks better-auth for the session directly rather than reading
             * `AuthContext`.
             *
             * `AuthContext` is written by `SessionGuard`, so relying on it would make
             * this correct only while the dashboard middleware is registered after
             * that guard. `app.use` appends to a global chain and the dashboard's
             * paths are not declared routes, so that ordering is an assumption
             * nothing here enforces. `auth.api.getSession` needs only the headers and
             * cannot be wrong.
             *
             * A non-admin gets 404, not 403 - the package's decision, and the right
             * one: a queue dashboard that announces itself has told an
             * unauthenticated caller where to keep knocking.
             */
            authorize: async (request: Request): Promise<boolean> => {
              try {
                const session = await auth.api.getSession({
                  headers: request.headers,
                });
                if (session === null) return false;
                return rolesOf(session.user).includes(UserRole.ADMIN);
              } catch (error) {
                // A session store that is down must not serve the board open.
                logger.warn('queue dashboard authorization failed', {
                  reason: (error as Error).message,
                });
                return false;
              }
            },
          }),
          inject: [JobPublisher, Auth, AppConfigService, Logger] as const,
        }),
      ],
    };
  }
}
