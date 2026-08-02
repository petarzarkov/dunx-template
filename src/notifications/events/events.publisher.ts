import { encode, encodeRelay, PubSub } from '@dunx/http';
import { RedisConnection } from '@dunx/infra/redis';
import { AppConfigService } from '../../config/app.config.service.js';

/**
 * How a socket event leaves the process it was produced in.
 *
 * An abstract class rather than an interface, because a dunx constructor parameter
 * has to name something that exists at runtime for `@dunx/transform` to record it -
 * this is the same trick `Logger` and `Storage` use.
 *
 * It exists because a job handler runs in **two different containers**. In the web
 * process there is a `PubSub`, bound by `HttpFactory` around the root module. In the
 * worker there is not: `WorkerFactory` builds a container with no server in it, so a
 * handler that injected `PubSub` directly would resolve nothing. One token, two
 * bindings, and the handler is unaware of which process it is in.
 */
export abstract class EventsPublisher {
  abstract publish(topic: string, event: string, data: unknown): void;
}

/**
 * The web binding. `PubSub` publishes to this process's sockets and, when a relay
 * is configured, forwards the frame to every other node.
 */
export class SocketPublisher extends EventsPublisher {
  constructor(private readonly pubsub: PubSub) {
    super();
  }

  override publish(topic: string, event: string, data: unknown): void {
    this.pubsub.publishEvent(topic, event, data);
  }
}

/**
 * The worker binding: straight onto the relay channel, so every web node fans the
 * frame out to its own sockets.
 *
 * `encodeRelay` and `encode` are `@dunx/http`'s own wire formats, exported - so a
 * process with no server can put a frame on the channel a process with one is
 * already listening to, and neither has to know about the other. The NestJS template
 * needed `@socket.io/redis-emitter`, a second package alongside the adapter, to do
 * this.
 *
 * The origin is this process's own id, which is what stops a node that also runs a
 * worker from fanning out its own frame twice.
 */
export class RelayPublisher extends EventsPublisher {
  readonly #origin = `worker:${Bun.randomUUIDv7()}`;
  readonly #channel: string;

  constructor(
    private readonly redis: RedisConnection,
    config: AppConfigService,
  ) {
    super();
    this.#channel = config.get('ws').relayChannel;
  }

  override publish(topic: string, event: string, data: unknown): void {
    const frame = encodeRelay(this.#origin, topic, encode(event, data));
    // Fire and forget: a worker must not fail a job because no web node is
    // listening, and with no Redis at all there is nothing to fan out to anyway.
    void this.redis.publish(this.#channel, frame).catch(() => undefined);
  }
}
