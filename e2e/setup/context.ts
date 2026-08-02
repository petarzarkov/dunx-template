import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Subprocess } from 'bun';
import { ApiClient } from '../utils/api-client.js';
import { DbClient } from '../utils/db-client.js';

/**
 * The e2e suite drives a **separate process**, started the way production starts
 * it (`bun src/main.ts`), rather than `createTestServer`. That is the only way
 * to cover `bunfig.toml`'s preload, `.env` loading, the migrations running on a
 * real file, and graceful shutdown.
 */
export interface TestContext {
  readonly api: ApiClient;
  readonly db: DbClient;
  readonly adminId: string;
  readonly adminToken: string;
  /** `http://127.0.0.1:PORT` without the api prefix, for the websocket upgrade. */
  readonly origin: string;
}

let server: Subprocess | undefined;
let context: TestContext | undefined;

/**
 * What the e2e server needs to boot, as code.
 *
 * These are test fixtures, not secrets, and they used to live only in `e2e/.env` -
 * which `.gitignore` matches with its `.env` rule, so the file existed on every
 * developer machine and in no CI run. The suite passed locally and failed on the
 * runner with `API_PORT: expected number, received NaN`, because the server booted
 * with no configuration at all.
 *
 * A committed default is the fix: the suite now works from a clean clone with no
 * env file present, and `e2e/.env` still overrides when someone wants it to.
 */
const DEFAULTS: Record<string, string> = {
  API_PORT: '3999',
  APP_ENV: 'local',
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  SQLITE_DB_PATH: './.tmp/e2e.db',
  STORAGE_LOCAL_ROOT: './.tmp/e2e-uploads',
  E2E_API_URL: 'http://127.0.0.1:3999/api',
  // The credential `AuthAdminSeeder` creates at boot, and what the suite signs in
  // with. A user row inserted by hand has no `account` row and cannot sign in.
  SEED_ADMIN_EMAIL: 'admin@e2e-test.com',
  SEED_ADMIN_PASSWORD: 'e2e-admin-password',
  // The rate limiter is real and its counters live in a Redis that outlives the
  // process, so a suite needs its own namespace and enough headroom to finish.
  THROTTLE_LIMIT: '10000',
  THROTTLE_PREFIX: `e2e-${crypto.randomUUID()}`,
};

/**
 * `e2e/.env`, parsed here rather than inherited, and optional.
 *
 * `bun test --env-file` loads it into the **test** process, and the server is a
 * child of that process, so it only sees these values if they were exported. It
 * worked locally by accident: Bun auto-loads a root `.env`, which is gitignored,
 * so CI had none and the server booted with `API_PORT` undefined and died on
 * `expected number, received NaN`.
 */
const e2eEnv = (): Record<string, string> => {
  const file = new URL('../.env', import.meta.url).pathname;
  const out: Record<string, string> = {};
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
};

const ENV = { ...DEFAULTS, ...e2eEnv() };

const DB_PATH =
  Bun.env['SQLITE_DB_PATH'] ?? ENV['SQLITE_DB_PATH'] ?? './.tmp/e2e.db';
const API_URL =
  Bun.env['E2E_API_URL'] ?? ENV['E2E_API_URL'] ?? 'http://127.0.0.1:3999/api';

const waitForReady = async (
  url: string,
  output: () => string,
): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${url}/service/up`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await Bun.sleep(250);
  }
  // Without the server's own output this says nothing about why. A boot error is
  // the usual cause and it is sitting in the pipe.
  throw new Error(
    `server never became ready at ${url}. Its output was:\n${output()}`,
  );
};

/**
 * Reads a piped stream into a buffer as it arrives.
 *
 * A `Bun.spawn` pipe nobody reads fills at 64 KiB and then blocks the child on its
 * next write, so a server that logs a line per request would hang partway through
 * the suite. Draining it also means the boot output is available to put in an
 * error message.
 */
const drain = (
  stream: ReadableStream<Uint8Array> | undefined,
): (() => string) => {
  if (!stream) return () => '';
  const chunks: string[] = [];
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) chunks.push(decoder.decode(chunk));
  })();
  return () => chunks.join('').slice(-4000);
};

export const initializeTestContext = async (): Promise<TestContext> => {
  if (context !== undefined) return context;

  for (const suffix of ['', '-shm', '-wal']) {
    await rm(`${DB_PATH}${suffix}`, { force: true });
  }

  server = Bun.spawn(['bun', 'src/main.ts'], {
    cwd: new URL('../..', import.meta.url).pathname,
    // `e2e/.env` wins over the ambient environment, deliberately. Bun auto-loads a
    // root `.env` into this process, and if that set API_PORT the server would
    // listen somewhere the suite is not polling - which is the same class of bug
    // as the one this parsing fixes.
    env: { ...process.env, ...ENV, SQLITE_DB_PATH: DB_PATH },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = drain(server.stdout as ReadableStream<Uint8Array> | undefined);
  const errors = drain(server.stderr as ReadableStream<Uint8Array> | undefined);
  await waitForReady(API_URL, () => `${output()}${errors()}`);

  const db = new DbClient(DB_PATH);
  const email = ENV['SEED_ADMIN_EMAIL'] as string;
  const password = ENV['SEED_ADMIN_PASSWORD'] as string;

  // Through better-auth's own endpoint, against the running server - the same
  // exchange a real client makes, and the only way to get a token the guard
  // accepts.
  const signIn = await fetch(`${API_URL}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const adminToken = signIn.headers.get('set-auth-token');
  if (adminToken === null) {
    throw new Error(
      `e2e sign-in failed: ${signIn.status} ${await signIn.text()}\n${output()}${errors()}`,
    );
  }

  context = {
    api: new ApiClient(API_URL, adminToken),
    db,
    adminId: db.idFor(email),
    adminToken,
    origin: API_URL.replace(/\/api\/?$/, ''),
  };
  return context;
};

export const getTestContext = (): TestContext => {
  if (context === undefined) {
    throw new Error(
      'test context not initialized: is e2e/setup/preload.ts loaded?',
    );
  }
  return context;
};

export const destroyTestContext = async (): Promise<void> => {
  context?.db.close();
  context = undefined;
  if (server !== undefined) {
    // SIGTERM, so `enableShutdownHooks` runs and the connection closes cleanly.
    server.kill('SIGTERM');
    await server.exited;
    server = undefined;
  }
};
