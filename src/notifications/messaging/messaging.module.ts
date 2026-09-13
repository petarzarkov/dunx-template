import { provide, type DynamicModule } from '@dunx/core';
import { AmqpModule, AmqpOptions, AmqpPublisher } from '@dunx/infra/amqp';
import { Logger } from '@dunx/core';
import { AppConfigService } from '../../config/app.config.service.js';
import { AuditMessages } from './audit.messages.js';
import { DomainPublisher } from './domain-publisher.js';
import { EVENTS_EXCHANGE } from './domain-events.js';

export interface MessagingModuleOptions {
  /** The worker consumes; the web process announces and does not. */
  readonly consume?: boolean;
}

/**
 * Domain events over a RabbitMQ topic exchange.
 *
 * This sits beside bullmq rather than replacing it, and the distinction is the
 * reason both are here: a **job** is work this system owes and must finish, with
 * retries and a worker it owns; an **event** is a statement of fact that zero or
 * many other services subscribe to and that this app is not responsible for
 * completing. A queue cannot express the second - a bullmq job has exactly one
 * consumer by construction.
 *
 * Nothing here is required to be running. `AMQP_URL` unset means the publish
 * side warns once and does nothing, `consume: 'if-any'` stands down rather than
 * failing boot, and the health check reports it non-critical.
 */
export class AppMessagingModule {
  static forRoot(options: MessagingModuleOptions = {}): DynamicModule {
    const amqp = AmqpModule.forRootAsync({
      useFactory: (config: AppConfigService) => {
        const { url, exchange } = config.get('amqp');
        return {
          ...(url === undefined ? {} : { url }),
          connectionName: config.get('app').name,
          /**
           * `'if-any'` rather than `true`: with no handlers discovered - the
           * web process - it stands down with a warning where `true` fails
           * boot.
           */
          consume: options.consume === true ? ('if-any' as const) : false,
          publisher: {
            confirm: true,
            // Declared once and re-declared on every reconnect, rather than
            // on every publish.
            exchanges: [{ exchange, type: 'topic', durable: true }],
          },
          /**
           * Short, all of them. An absent broker has to be found out about
           * at boot rather than held on to, and a publish on a request path
           * must not outlive the request that is waiting for it.
           */
          readyTimeoutMs: 1_500,
          publishTimeoutMs: 2_000,
          drainTimeoutMs: 2_000,
        };
      },
      inject: [AppConfigService] as const,
    });

    return {
      module: AppMessagingModule,
      global: true,
      imports: [amqp],
      providers: [
        provide(DomainPublisher, {
          useFactory: (
            publisher: AmqpPublisher,
            logger: Logger,
            config: AppConfigService,
            amqp: AmqpOptions,
          ) => new DomainPublisher(publisher, logger, config, amqp),
          inject: [AmqpPublisher, Logger, AppConfigService, AmqpOptions],
        }),
        // Only where something consumes: a provider with `@AmqpHandler` methods
        // is what discovery walks, so listing it is what opens the consumer.
        ...(options.consume === true ? [AuditMessages] : []),
      ],
      /**
       * The AMQP module is re-exported by reference, not just this app's own
       * publisher. `exports` takes a module and re-exports whatever it exports,
       * which is what makes `AmqpPublisher` reachable from the scope that asks
       * for `DomainPublisher` - a global module publishes its exports, and a
       * consumer resolving one still has to be able to see what it was built
       * from.
       */
      exports: [
        amqp,
        DomainPublisher,
        ...(options.consume === true ? [AuditMessages] : []),
      ],
    };
  }
}

export { EVENTS_EXCHANGE };
