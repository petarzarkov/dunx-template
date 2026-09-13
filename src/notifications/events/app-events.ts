import { AppEvent } from '@dunx/core';

/**
 * In-process events, which are the third messaging shape this app has and the
 * one with the narrowest job.
 *
 * The other two are about crossing a boundary: a **bullmq job** is work this
 * system owes, durable and retried; an **AMQP domain event** is a fact other
 * services subscribe to. An `AppEvent` crosses nothing - it is how one part of
 * this process tells another that something happened, without knowing who is
 * listening or whether anyone is.
 *
 * That is what it buys here. `auth.hooks.ts` used to publish a queue job
 * directly, so the auth layer named the notifications layer; now it states a
 * fact and two unrelated subscribers react. Adding a third is a new class in a
 * new module and no edit to the publisher.
 *
 * In process and single node: a subscriber that must survive a restart wants the
 * queue, and one in another service wants the exchange.
 */
export class UserRegistered extends AppEvent {
  constructor(
    readonly userId: string,
    readonly email: string,
    readonly name: string,
  ) {
    super();
  }
}
