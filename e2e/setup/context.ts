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

const waitForReady = async (url: string): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${url}/service/up`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await Bun.sleep(250);
  }
  throw new Error(`server never became ready at ${url}`);
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

  await waitForReady(API_URL);

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
