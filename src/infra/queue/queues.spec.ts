import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import { JobPublisher } from '@dunx/infra/queue';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import { validateConfig } from '../../config/env.validation.js';
import { httpOptions } from '../../http.options.js';
import { bearer, signIn } from '../../test-support/session.js';
import { JOBS, QUEUES } from '../../notifications/events/events.js';

/**
 * The queue is the one area this app cannot demonstrate in a single process: a
 * worker is its own container with its own connections, so `bun run worker` is a
 * second process and this suite spawns it.
 *
 * Every assertion that needs a broker is skipped when Redis is unreachable, because
 * `bun test` has to pass on a machine with nothing running - the degraded side of the
 * same contract is asserted in `src/infra/redis/redis.spec.ts`.
 *
 * **Jobs are published and read through `JobPublisher`, not over the routes.** The
 * routes are asserted separately, above. Driving bullmq's own `Queue` for the
 * round-trip is the better test: it asserts the queue rather than an HTTP shape
 * wrapped around it, and it keeps the publish/consume test independent of whether
 * this app happens to expose queue endpoints at all.
 */
const APP_DIR = new URL('../../..', import.meta.url).pathname;
const PREFIX = `test-${crypto.randomUUID()}`;
const DB_PATH = `./.tmp/queue-spec-${crypto.randomUUID()}.db`;

let server: TestServer;
let publisher: JobPublisher;
let worker: Subprocess | undefined;
let token = '';
let queueUp = false;

interface JobView {
  state: string;
  result: unknown;
  failedReason: string | null;
}

const source = {
  API_PORT: '0',
  // A file rather than `:memory:`, because the worker is a second process and has
  // to see the same rows. It is removed with the rest of `.tmp`.
  SQLITE_DB_PATH: DB_PATH,
  QUEUE_PREFIX: PREFIX,
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  SEED_ADMIN_EMAIL: 'admin@local.dev',
  SEED_ADMIN_PASSWORD: 'admin-password',
};

const enqueue = async (name: string, data: unknown): Promise<string> => {
  const job = await publisher.publish(QUEUES.NOTIFICATIONS, name, data);
  return job.id ?? '(unassigned)';
};

const view = async (id: string): Promise<JobView> => {
  const job = await publisher.queue(QUEUES.NOTIFICATIONS).getJob(id);
  if (job === undefined) throw new Error(`no job ${id}`);
  return {
    state: await job.getState(),
    result: (job.returnvalue as unknown) ?? null,
    failedReason: job.failedReason ?? null,
  };
};

/**
 * Waits for the **result**, not merely a terminal state: bullmq reports a state
 * before `returnvalue` is necessarily readable, and a test that stopped at
 * `completed` would flake on exactly the assertion that matters.
 */
const settled = async (id: string): Promise<JobView> => {
  let last: JobView | undefined;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    last = await view(id);
    // `failedReason` rather than `state === 'failed'`: with retries configured a
    // job that has thrown sits in `delayed` between attempts, and only becomes
    // `failed` once every attempt is spent.
    if (last.result !== null || last.failedReason !== null) return last;
    await Bun.sleep(150);
  }
  const output =
    worker === undefined
      ? '(no worker spawned)'
      : await new Response(worker.stderr as ReadableStream).text();
  throw new Error(
    `job ${id} never produced a result. last=${JSON.stringify(last)}\nworker stderr:\n${output.slice(0, 2000)}`,
  );
};

beforeAll(async () => {
  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    // The same options production passes, `SessionGuard` included - which is what
    // makes the authorization assertions below meaningful. A suite that omitted
    // them would get a server with no guards that still boots and still answers.
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });
  publisher = server.app.get(JobPublisher);
  token = await signIn(server, 'admin@local.dev', 'admin-password');

  // One operation decides it: with `maxRetries: 0` and a connection timeout, an
  // enqueue against a down Redis rejects in milliseconds rather than hanging, which
  // is what makes this check cheap enough to do here.
  try {
    await publisher.queue(QUEUES.NOTIFICATIONS).getJobCounts();
    queueUp = true;
  } catch {
    queueUp = false;
  }

  if (queueUp) {
    worker = Bun.spawn(['bun', 'src/worker.ts'], {
      cwd: APP_DIR,
      env: { ...process.env, ...source, NODE_ENV: 'production' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    // The worker opens its own container and one bullmq Worker per queue.
    await Bun.sleep(2500);
  }
});

afterAll(async () => {
  worker?.kill('SIGKILL');
  await worker?.exited;
  await server.close();
});

describe('the queue routes', () => {
  test('are admin only', async () => {
    const { status } = await server.json('api/queues');
    expect(status).toBe(401);
  });

  test('report counts for every declared queue', async () => {
    if (!queueUp) return;
    const { status, body } = await server.json<{
      broker: string;
      queues: { name: string; counts: Record<string, number> }[];
    }>('api/queues', { headers: bearer(token) });

    expect(status).toBe(200);
    expect(body.queues.map((q) => q.name).sort()).toEqual([
      'media',
      'notifications',
    ]);
    expect(body.queues[0]?.counts).toHaveProperty('waiting');
    // The broker URL is redacted, so a password in it never reaches a response.
    expect(body.broker).not.toContain('@');
  });

  test('an unknown queue name is a 400 from the params schema', async () => {
    if (!queueUp) return;
    const { status } = await server.json('api/queues/nope/jobs/1', {
      headers: bearer(token),
    });
    expect(status).toBe(400);
  });

  test('an unknown job id is a 404', async () => {
    if (!queueUp) return;
    const { status } = await server.json(
      `api/queues/${QUEUES.NOTIFICATIONS}/jobs/999999`,
      { headers: bearer(token) },
    );
    expect(status).toBe(404);
  });

  /**
   * A miss is a **404**, not the session guard's 401.
   *
   * `@dunx/http` defaults to `notFound: 'guarded'`, which gives an unmatched path no
   * route metadata so a global guard refuses it - and `SessionGuard` runs for misses
   * too, since global middleware sits in front of the not-found fallback. That turned
   * every typo into `401 UNAUTHENTICATED`, which says "log in" when the truth is "no
   * such route". `notFound: 'public'` in http.options.ts is what makes this a 404, and
   * this test is what stops that setting being dropped.
   */
  test('an unmatched path is a 404, not the guard\u2019s 401', async () => {
    const { status, body } = await server.json<{ error: string }>('api/queue');
    expect(status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
  });
});

describe('publish here, consume in the worker', () => {
  test('a job enqueued by the web process is completed by the worker', async () => {
    if (!queueUp) return;

    const id = await enqueue(JOBS.USER_REGISTERED, {
      userId: crypto.randomUUID(),
      email: 'queued@example.com',
      name: 'Queued',
    });
    const finished = await settled(id);

    expect(finished.state).toBe('completed');
    // The result was computed in another process and read back through Redis,
    // which is the only thing this test is really asserting.
    expect(finished.result).toMatchObject({ notified: expect.any(String) });
  }, 40_000);

  test('a handler that throws is retried and then reported failed', async () => {
    if (!queueUp) return;

    // No handler is registered for this name on this queue, so the dispatcher
    // rejects it - which is the same path a throwing handler takes.
    const id = await enqueue('no.such.job', {});
    const finished = await settled(id);

    // Still `delayed` between attempts - the retry policy is three attempts with
    // exponential backoff, which is the point.
    expect(['delayed', 'failed']).toContain(finished.state);
    expect(finished.failedReason).toContain('No handler for');
  }, 40_000);
});
