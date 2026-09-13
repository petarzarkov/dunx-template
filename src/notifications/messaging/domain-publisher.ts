import { Logger } from '@dunx/core';
import { AmqpOptions, AmqpPublisher } from '@dunx/infra/amqp';
import { AppConfigService } from '../../config/app.config.service.js';
import type { DomainEvent } from './domain-events.js';

/**
 * Announces a domain event, and never fails the caller for it.
 *
 * That is the whole difference from `JobPublisher`, and it is deliberate: a job
 * that fails to enqueue is work this system has lost, so the caller is told. An
 * event that fails to publish is an announcement nobody heard, and failing a
 * user's registration because a broker that no subscriber may even be listening
 * on was unreachable would be the wrong trade.
 *
 * With no broker configured this does nothing at all, warns once, and the app
 * carries on - the same contract the cache and the queue keep.
 */
export class DomainPublisher {
  readonly #exchange: string;
  readonly #configured: boolean;
  #warned = false;

  constructor(
    private readonly publisher: AmqpPublisher,
    private readonly logger: Logger,
    config: AppConfigService,
    options: AmqpOptions,
  ) {
    const amqp = config.get('amqp');
    this.#exchange = amqp.exchange;
    /**
     * `AmqpOptions.url` always has a value - the package falls back to
     * `defaultAmqpUrl()` - so "is a broker configured" is a question only this
     * app's own variable can answer.
     */
    this.#configured = amqp.url !== undefined;
    void options;
  }

  async announce(event: DomainEvent, body: unknown): Promise<void> {
    if (!this.#configured) {
      this.#once('AMQP_URL is not set, so no domain event is published');
      return;
    }
    try {
      await this.publisher.publish(
        { exchange: this.#exchange, routingKey: event },
        body,
      );
    } catch (error) {
      this.#once(
        `domain event ${event} not published: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** Once per process: an unreachable broker is touched on every write path. */
  #once(message: string): void {
    if (this.#warned) return;
    this.#warned = true;
    this.logger.warn(message);
  }
}
