import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Logger } from '@dunx/core';
import { SyncDatabase } from '@dunx/infra/db';
import { createTestServer, type TestServer } from '@dunx/testing';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { validateConfig } from '../config/env.validation.js';
import { httpOptions } from '../http.options.js';
import type * as schema from '../infra/db/schema.js';
import { signUp } from '../test-support/session.js';
import { sessions } from './schema/session.schema.js';
import { verifications } from './schema/verification.schema.js';
import { SessionSweeper } from './services/session-sweeper.service.js';

/**
 * The sweeper is armed by `ScheduleModule` and called by nothing, so its only
 * caller in a test is the test. It is constructed here rather than resolved,
 * because `AccountsModule` deliberately does not export it - a provider the
 * scheduler finds has no reason to be reachable from outside.
 */
const DB_PATH = `./.tmp/sweeper-spec-${crypto.randomUUID()}.db`;

const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: DB_PATH,
  QUEUE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

let server: TestServer;
let db: SyncDatabase<typeof schema>;
let sweeper: SessionSweeper;

const HOUR = 3_600_000;

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });
  db = server.app.get(SyncDatabase) as SyncDatabase<typeof schema>;
  sweeper = new SessionSweeper(db, server.app.get(Logger));
});

afterAll(async () => {
  await server.close();
});

test('an expired session is swept and a live one is left alone', async () => {
  const { userId } = await signUp(
    server,
    'sweeper@local.dev',
    'Sweeper-password-1!',
  );

  // Sign-up opened a real session. Backdating it is what makes it expired, and
  // going through the column rather than the API is the point: better-auth
  // stops *reading* an expired row, it never deletes it.
  db.update(sessions)
    .set({ expiresAt: new Date(Date.now() - HOUR) })
    .where(eq(sessions.userId, userId))
    .run();

  const live = await signUp(server, 'live@local.dev', 'Live-password-1!');

  db.insert(verifications)
    .values({
      identifier: 'sweeper@local.dev',
      value: 'stale-token',
      expiresAt: new Date(Date.now() - HOUR),
    })
    .run();

  sweeper.sweep();

  expect(
    db.select().from(sessions).where(eq(sessions.userId, userId)).all(),
  ).toHaveLength(0);
  expect(
    db.select().from(sessions).where(eq(sessions.userId, live.userId)).all(),
  ).not.toHaveLength(0);
  expect(db.select().from(verifications).all()).toHaveLength(0);
});

test('a sweep with nothing to do is a no-op', () => {
  expect(() => {
    sweeper.sweep();
  }).not.toThrow();
});
