import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import { JobPublisher } from '@dunx/infra/queue';
import { createTestServer, type TestServer } from '@dunx/testing';
import { appModule } from '../../app.module.js';
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
 * **Jobs are published and read through `JobPublisher`, not over HTTP.** They used to
 * go through a `QueuesController` this app wrote because dunx had no dashboard, and
 * that controller is gone now that `@dunx/queue-dashboard` serves the real Bull
 * Board. Driving bullmq's own `Queue` is the better test anyway: it asserts the
 * queue, not an HTTP shape wrapped around it.
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
    modules: [appModule({ source, logLevel: 'fatal' })],
    prefix: 'api',
    // `QueueDashboardMiddleware` is in here, first in the chain - which is why the
    // authorization assertions below get the package's 404 and not the session
    // guard's 401. See http.options.ts.
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

describe('the queue dashboard', () => {
  /**
   * Not served without an admin session, and the status is the point: a dashboard
   * that answered 403 would have confirmed to an anonymous caller that there is a
   * dashboard at that path. `authorize` returns false and the package answers 404.
   *
   * Both of these hold with no Redis running, because `authorize` is checked before
   * anything bull-board owns is loaded - which is also what keeps an app that mounts
   * the board from connecting to a broker at boot.
   */
  test('is invisible to an anonymous caller', async () => {
    const response = await server.request('queues');
    expect(response.status).toBe(404);
  });

  test('is invisible to a caller whose session does not resolve', async () => {
    const response = await server.request('queues', {
      headers: { authorization: 'Bearer not-a-real-session' },
    });
    expect(response.status).toBe(404);
  });

  test('serves the board to an admin', async () => {
    if (!queueUp) return;
    const response = await server.request('queues', { headers: bearer(token) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    // bull-board's own entry template, rendered by the substitution renderer -
    // which is why `ejs` is not a dependency here.
    expect(await response.text()).toContain('id="root"');
  });

  test('a path outside the board falls through to the app', async () => {
    // The middleware is global, so this is the assertion that it does not swallow
    // requests that are not its own.
    const { status } = await server.json('api/service/up');
    expect(status).toBe(200);
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
