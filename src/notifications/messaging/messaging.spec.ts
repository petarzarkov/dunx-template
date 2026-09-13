import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestApp } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { DomainPublisher } from './domain-publisher.js';
import { DOMAIN_EVENTS } from './domain-events.js';

/**
 * The publish side with **no broker configured**, which is the default and the
 * case every clean checkout runs.
 *
 * There is no assertion here that a message arrived: that needs a broker, and it
 * is what `e2e` and the compose profile are for. What this pins is the contract
 * the whole template rests on - an announcement nobody can hear must not fail
 * the caller, because the write that triggered it already succeeded.
 */
const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: `./.tmp/amqp-spec-${crypto.randomUUID()}.db`,
  QUEUE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  // Deliberately absent: AMQP_URL.
};

let app: Awaited<ReturnType<typeof createTestApp>>;
let domain: DomainPublisher;

beforeAll(async () => {
  app = await createTestApp({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
  });
  domain = app.get(DomainPublisher);
}, 30_000);

afterAll(async () => {
  await app.shutdown();
});

describe('announcing a domain event with no broker', () => {
  test('does not throw', async () => {
    await expect(
      domain.announce(DOMAIN_EVENTS.USER_REGISTERED, {
        userId: crypto.randomUUID(),
        email: 'nobody@example.com',
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * The distinction this module exists to make. A job that cannot be enqueued is
   * work the system has lost and the caller is told; an event that cannot be
   * published is an announcement nobody heard, and failing a registration over
   * it would be the wrong trade.
   */
  test('every announcement resolves, not just the first', async () => {
    const announced = [1, 2, 3].map(() =>
      domain.announce(DOMAIN_EVENTS.FILE_UPLOADED, {
        fileId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
        bytes: 1,
      }),
    );

    // `allSettled` rather than `all`: `all` rejects on the first failure and
    // would hide whether the others did too, which is the thing being checked.
    const settled = await Promise.allSettled(announced);
    expect(settled.map((r) => r.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
  });
});
