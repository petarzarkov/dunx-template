import { Module } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import { QueueDashboardModule } from '@dunx/queue-dashboard';
import { AppConfigService } from '../../config/app.config.service.js';
import { CurrentUser } from '../../auth/services/current-user.service.js';
import { QUEUES } from '../../notifications/events/events.js';

/**
 * bull-board at `/queues`, over the same queues `QueuesController` reports on in
 * JSON. The two are complements, not alternatives: the controller is what a script
 * or an alert calls, the board is what a person opens.
 *
 * This replaces the NestJS template's `queue-dashboard.module.ts`, which needed
 * `@bull-board/nestjs`, `@bull-board/express` and a `MiddlewareConsumer` to attach an
 * HTML auth middleware to the route. Here the adapter is `Bun.serve`, there is no
 * express, and authorisation is one function.
 */
@Module({
  imports: [
    QueueDashboardModule.forRootAsync({
      useFactory: (
        publisher: JobPublisher,
        config: AppConfigService,
        caller: CurrentUser,
      ) => ({
        path: '/queues',
        /**
         * A thunk, not an array: constructing a bullmq `Queue` opens a connection,
         * so naming them here would make the app connect to Redis at boot even when
         * nobody opens the board.
         */
        queues: () =>
          Object.values(QUEUES).map((name) => publisher.queue(name)),
        uiConfig: { boardTitle: `${config.get('app').name} queues` },
        /**
         * Admins only, and a rejection is a 404 rather than a 403 - the board should
         * not confirm to a non-admin that it is there.
         *
         * `CurrentUser` reads `AuthContext`, which `SessionGuard` wrote on the way
         * in, so this works only because `QueueDashboardMiddleware` is registered
         * **after** `SessionGuard` in `httpOptions`. That ordering is the whole
         * mechanism; see the comment there.
         */
        authorize: () => caller.isAdmin(),
      }),
      inject: [JobPublisher, AppConfigService, CurrentUser] as const,
    }),
  ],
})
export class QueueDashboardsModule {}
