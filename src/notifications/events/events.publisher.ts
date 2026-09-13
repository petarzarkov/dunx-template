import { PubSub, RelayPublisher } from '@dunx/http';

/**
 * How a socket event leaves the process it was produced in.
 *
 * An abstract class rather than an interface, because a dunx constructor
 * parameter has to name something that exists at runtime for `@dunx/transform`
 * to record it - this is the same trick `Logger` and `Storage` use.
 *
 * It exists because a job handler runs in **two different containers**. In the
 * web process there is a `PubSub`, bound by `HttpFactory` around the root
 * module. In the worker there is not: `WorkerFactory` builds a container with no
 * server in it, so a handler that injected `PubSub` directly would resolve
 * nothing. One token, two bindings, and the handler is unaware of which process
 * it is in.
 */
export abstract class EventsPublisher {
  abstract publish(topic: string, event: string, data: unknown): void;
}

/**
 * The web binding. `PubSub` publishes to this process's sockets and, when a
 * relay is configured, forwards the frame to every other node.
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
 * The worker binding: straight onto the relay channel, so every web node fans
 * the frame out to its own sockets. The NestJS template needed
 * `@socket.io/redis-emitter` for this, a second package alongside the adapter.
 *
 * `RelayPublisher` is `@dunx/http`'s own, bound by `WsRelayModule`. This used to
 * restate the two wire formats locally because neither was exported;
 * [dunx#137](https://github.com/petarzarkov/dunx/issues/137) is fixed in 3.8.2
 * and the copies are gone with it.
 *
 * Still a wrapper rather than binding `RelayPublisher` to `EventsPublisher`
 * directly: the method is `publishEvent` there and `publish` here, and both
 * bindings have to answer the same name for the handler to stay unaware of which
 * process it is in.
 */
export class WorkerPublisher extends EventsPublisher {
  constructor(private readonly frames: RelayPublisher) {
    super();
  }

  /**
   * Fire and forget, and that is `RelayPublisher`'s contract rather than this
   * class's: it never throws, because a job handler that failed here would be
   * retried and would repeat its side effects to deliver a frame nobody awaited.
   */
  override publish(topic: string, event: string, data: unknown): void {
    this.frames.publishEvent(topic, event, data);
  }
}
