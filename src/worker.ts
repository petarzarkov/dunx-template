import { Logger } from '@dunx/core';
import { WorkerFactory } from '@dunx/infra/queue';
import { workerModule } from './app.module.js';
import { forceExitAfter } from './core/force-exit.js';

/**
 * `bun run worker` - the consuming half, and **a second process on purpose**.
 *
 * A worker is its own container: it builds only what a handler needs, opens one
 * bullmq `Worker` per queue and has no HTTP server. It shares exactly one thing
 * with the web process - the module list in `app.module.ts` - so the two agree on
 * the queue names and the handlers without agreeing on anything else.
 *
 * `create` discovers and validates before `start` opens a connection, so a wiring
 * mistake fails before anything consumes. With no Redis, `start()` is what fails,
 * and it fails loudly: unlike the web process, a worker that cannot reach its
 * broker has nothing left to do.
 */
const worker = await WorkerFactory.create(workerModule());
const logger = worker.get(Logger);

logger.info('worker starting', { queues: worker.queues });

try {
  await worker.start();
} catch (error) {
  logger.fatal('worker could not reach the broker', {
    reason: (error as Error).message,
  });
  await worker.shutdown();
  process.exit(1);
}

worker.enableShutdownHooks();
const cancelWatchdog = forceExitAfter();
logger.info('worker consuming', { queues: worker.queues });

// An in-flight job is drained by the shutdown hooks before this resolves.
await worker.closed;

cancelWatchdog();
process.exit(0);
