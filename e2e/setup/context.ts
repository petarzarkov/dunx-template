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
}

let server: Subprocess | undefined;
let context: TestContext | undefined;

const DB_PATH = Bun.env['SQLITE_DB_PATH'] ?? './.tmp/e2e.db';
const API_URL = Bun.env['E2E_API_URL'] ?? 'http://127.0.0.1:3999/api';

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
    env: { ...process.env, SQLITE_DB_PATH: DB_PATH },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = drain(server.stdout as ReadableStream<Uint8Array> | undefined);
  const errors = drain(server.stderr as ReadableStream<Uint8Array> | undefined);
  await waitForReady(API_URL, () => `${output()}${errors()}`);

  const db = new DbClient(DB_PATH);
  const adminId = db.ensureAdmin('admin@e2e-test.com');

  context = { api: new ApiClient(API_URL, adminId), db, adminId };
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
