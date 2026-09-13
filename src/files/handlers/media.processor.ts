import { JobProcessor } from '@dunx/infra/queue';
import { WorkerModule } from '../../app.module.js';

/**
 * The file bullmq forks into for the media queue.
 *
 * A sandboxed job runs in a child process with a container of its own, which is
 * what `@JobHandler({ background: true })` asks for. Its default export is the
 * processor, and `JobProcessor` is what builds one out of a dunx module - so the
 * child gets the same graph the worker has, rather than a hand-bootstrapped
 * second one.
 *
 * `WorkerModule` rather than a narrower module: the handler injects `Storage`,
 * `ThumbnailsService` and `FilesRepository`, and the worker graph is where those
 * are already wired together correctly.
 */
export default new JobProcessor(WorkerModule.forRoot()).handle;
