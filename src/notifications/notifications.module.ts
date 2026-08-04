import { provide, type DynamicModule } from '@dunx/core';
import { RedisConnection } from '@dunx/infra/redis';
import { PubSub } from '@dunx/http';
import { HttpModule } from '@dunx/http/client';
import { AppConfigService } from '../config/app.config.service.js';
import {
  EventsPublisher,
  RelayPublisher,
  SocketPublisher,
} from './events/events.publisher.js';
import { EventsGateway } from './events/events.gateway.js';
import { NotificationJobs } from './handlers/notification.jobs.js';
import { EmailService } from './services/email.service.js';

export interface NotificationsModuleOptions {
  /**
   * `socket` in the web process, `relay` in the worker. The worker's container has
   * no `PubSub` - `HttpFactory` is what binds it - so a handler that published
   * through one would resolve nothing there.
   */
  readonly publisher: 'socket' | 'relay';
}

/**
 * A gateway is declared in `providers`, next to the services it injects. There is
 * no separate list for it and no second module to configure.
 */
export class NotificationsModule {
  static forRoot(options: NotificationsModuleOptions): DynamicModule {
    const publisher =
      options.publisher === 'socket'
        ? provide(EventsPublisher, {
            useFactory: (pubsub: PubSub) => new SocketPublisher(pubsub),
            inject: [PubSub] as const,
          })
        : provide(EventsPublisher, {
            useFactory: (redis: RedisConnection, config: AppConfigService) =>
              new RelayPublisher(redis, config),
            inject: [RedisConnection, AppConfigService] as const,
          });

    return {
      module: NotificationsModule,
      imports: [
        /**
         * The outbound client `EmailService` posts through, registered under the
         * name `email` rather than as the app's default `HttpService` - a named
         * registration deliberately does not claim the unnamed token, so a second
         * upstream added later coexists with this one instead of colliding.
         *
         * `forRootAsync` because the timeout comes off validated config, which is the
         * one thing a zero-argument `forRoot` cannot read.
         */
        HttpModule.forRootAsync(
          {
            useFactory: (config: AppConfigService) => ({
              timeoutMs: config.get('email').timeoutMs,
              headers: { 'content-type': 'application/json' },
            }),
            inject: [AppConfigService] as const,
          },
          'email',
        ),
      ],
      providers: [
        EmailService,
        NotificationJobs,
        publisher,
        // The gateway only exists where there is a server to upgrade on.
        ...(options.publisher === 'socket' ? [EventsGateway] : []),
      ],
    };
  }
}
