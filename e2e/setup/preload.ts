import { afterAll, beforeAll } from 'bun:test';
import { destroyTestContext, initializeTestContext } from './context.js';

/**
 * `bun test --preload` registers these once for the whole run, so the server is
 * started and torn down exactly once no matter how many suites there are.
 *
 * The explicit timeouts are load-bearing. Bun's default for a hook is 5 s, and
 * `waitForReady` is allowed 15 s, so on a cold CI runner the hook was killed
 * before the readiness loop had given up - which surfaced as every test failing
 * with "test context not initialized" and one `(unnamed)` failure at exactly
 * 5000 ms, naming nothing.
 */
beforeAll(async () => {
  await initializeTestContext();
}, 60_000);

afterAll(async () => {
  await destroyTestContext();
}, 30_000);
