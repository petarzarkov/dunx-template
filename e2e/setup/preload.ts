import { afterAll, beforeAll } from 'bun:test';
import { destroyTestContext, initializeTestContext } from './context.js';

// `bun test --preload` registers these once for the whole run, so the server is
// started and torn down exactly once no matter how many suites there are.
beforeAll(async () => {
  await initializeTestContext();
});

afterAll(async () => {
  await destroyTestContext();
});
