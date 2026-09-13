import { provide, type DynamicModule } from '@dunx/core';
import {
  PubSub,
  RelayPublisher,
  WsRelay,
  WsRelayModule,
  type RedisRelayOptions,
} from '@dunx/http';
import { AccountsModule } from '../auth/auth.module.js';
import { AppConfigService } from '../config/app.config.service.js';
import {
  EventsPublisher,
  SocketPublisher,
  WorkerPublisher,
} from './events/events.publisher.js';
import { AppEmailModule } from './email/email.module.js';
import { EventsGateway } from './events/events.gateway.js';
import { NotificationJobs } from './handlers/notification.jobs.js';

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
            /**
             * `RelayPublisher` is constructed here rather than injected, because
             * the **channel** has to be passed and it comes from validated
             * config. `WsRelayModule` binds one too, but its
             * `RelayPublisherInit` is a static argument to `forRootAsync` and
             * nothing readable from the container can reach it.
             *
             * Getting this wrong is silent: this app listens on
             * `WS_RELAY_CHANNEL`, which defaults to `dunx-template:ws`, while
             * `RelayPublisher` defaults to dunx's own `dunx:ws`. The broker
             * would accept every publish and deliver it to nobody. Both sides
             * read `ws.relayChannel`, and the e2e round trip is what proves it.
             */
            useFactory: (relay: WsRelay, config: AppConfigService) =>
              new WorkerPublisher(
                new RelayPublisher(relay, {
                  channel: config.get('ws').relayChannel,
                }),
              ),
            inject: [WsRelay, AppConfigService] as const,
          });

    return {
      module: NotificationsModule,
      imports: [
        // Only where there is a gateway: `EventsGateway` authenticates the upgrade
        // through `Auth`. The worker has neither, and must not build better-auth.
        ...(options.publisher === 'socket' ? [AccountsModule] : []),
        /**
         * Binds `WsRelay` and `RelayPublisher`, and only in the worker: the web
         * process reaches the relay through the `PubSub` that `HttpFactory`
         * already built from `httpOptions.relay`, and a second one here would
         * open a second connection to the same broker.
         *
         * The channel has to match the one the servers listen on, so both read
         * `ws.relayChannel`. A mismatch is silent - the broker accepts the
         * publish and delivers it to nobody.
         */
        ...(options.publisher === 'relay'
          ? [
              WsRelayModule.forRootAsync({
                useFactory: (config: AppConfigService): RedisRelayOptions => {
                  const { url, connectTimeoutMs } = config.get('redis');
                  return {
                    // Absent rather than `undefined`, which
                    // `exactOptionalPropertyTypes` refuses: with no url the
                    // relay falls back to Bun's own default.
                    ...(url === undefined ? {} : { url }),
                    connectionTimeout: connectTimeoutMs,
                    // Same as the web side: a worker must still exit when the
                    // broker is gone.
                    maxRetries: 0,
                  };
                },
                inject: [AppConfigService] as const,
              }),
            ]
          : []),
        /**
         * `EmailService`, its transport and its renderer. Both processes bind it:
         * the worker is what actually sends, and the web process has it for a
         * send on the request path.
         */
        AppEmailModule.forRoot(),
      ],
      providers: [
        NotificationJobs,
        publisher,
        // The gateway only exists where there is a server to upgrade on.
        ...(options.publisher === 'socket' ? [EventsGateway] : []),
      ],
    };
  }
}
