import { JobPublisher, QueueOptions } from '@dunx/infra/queue';
import {
  Controller,
  Get,
  HttpError,
  HttpStatusCode,
  Post,
  Roles,
  type Input,
} from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { z } from 'zod';
import { QUEUES } from '../../notifications/events/events.js';
import { UserRole } from '../../users/schema/user.schema.js';

const QueueParams = z.object({
  queue: z.enum([QUEUES.NOTIFICATIONS, QUEUES.MEDIA]),
});

const oneQueue = { params: QueueParams } as const;

const oneJob = {
  params: QueueParams.extend({ jobId: z.string().min(1).max(128) }),
} as const;

const enqueue = {
  params: QueueParams,
  body: z.object({
    name: z.string().min(1).max(128),
    data: z.record(z.string(), z.unknown()).default({}),
    delay: z.number().int().min(0).max(3_600_000).optional(),
  }),
  status: 202,
} as const;

export interface QueueSummary {
  readonly name: string;
  readonly counts: Record<string, number>;
}

/**
 * What Bull Board showed, as JSON. A holding position, deliberately.
 *
 * The NestJS template mounted `@bull-board/express` at `/api/queues` behind a
 * session-cookie middleware. dunx briefly had a counterpart - `@dunx/queue-dashboard`
 * served the real Bull Board over `Bun.serve`, which proved the adapter was cheap -
 * and it has since been **deleted**, because a queue-only dashboard is the wrong unit
 * for a framework. Its replacement is one page covering routes, the provider graph,
 * the queues and runtime health, designed in the dunx repo under
 * `docs/roadmap/dunx-dashboard.md` and not yet built.
 *
 * So there is no page today, and this is what serves the *data* until there is: job
 * counts per queue, one job's state and result, retry and drain, admin-only. Four
 * calls on bullmq's own `Queue`, which is all the panel will do either.
 *
 * `getWorkers()` is deliberately absent. bullmq matches workers by client name
 * through `CLIENT LIST` and its Bun adapter never names a connection, so it returns
 * an empty list while workers are demonstrably draining jobs. A `workers` field here
 * would be confidently wrong; job counts moving is the signal that works.
 *
 * Every route degrades: with no Redis these answer 503 in single-digit milliseconds
 * rather than hanging, which is what makes the whole app bootable with nothing
 * running. Nothing here does that translation - `QueueUnavailableMiddleware` is on
 * this module's `middleware` list, so it wraps every route below and the handlers
 * are left saying only what they do.
 */
@ApiDoc({
  tags: ['queues'],
  description: 'Queue depth and job inspection. The Bull Board data, as JSON.',
})
@Controller('queues')
export class QueuesController {
  constructor(
    private readonly publisher: JobPublisher,
    private readonly options: QueueOptions,
  ) {}

  @ApiDoc({ tags: ['queues'], summary: 'Job counts for every queue' })
  @Roles(UserRole.ADMIN)
  @Get('/')
  async summary(): Promise<{
    broker: string;
    queues: readonly QueueSummary[];
  }> {
    const queues = await Promise.all(
      Object.values(QUEUES).map(async (name) => ({
        name,
        counts: await this.publisher.queue(name).getJobCounts(),
      })),
    );
    return { broker: this.options.redactedUrl, queues };
  }

  @ApiDoc({ tags: ['queues'], summary: 'Enqueue a job by name' })
  @Roles(UserRole.ADMIN)
  @Post('/:queue/jobs', enqueue)
  async publish(input: Input<typeof enqueue>): Promise<{
    id: string;
    queue: string;
    state: string;
  }> {
    const { queue } = input.params;
    const { name, data, delay } = input.body;

    const job = await this.publisher.publish(
      queue,
      name,
      data,
      delay === undefined ? undefined : { delay },
    );

    return {
      id: job.id ?? '(unassigned)',
      queue,
      // `waiting` until a worker takes it, which is the observable point of a
      // queue and therefore in the response rather than hidden.
      state: await job.getState(),
    };
  }

  @ApiDoc({ tags: ['queues'], summary: 'One job: state, result, failure' })
  @Roles(UserRole.ADMIN)
  @Get('/:queue/jobs/:jobId', oneJob)
  async job(input: Input<typeof oneJob>): Promise<{
    id: string;
    state: string;
    attempts: number;
    result: unknown;
    failedReason: string | null;
  }> {
    const { queue, jobId } = input.params;
    const job = await this.publisher.queue(queue).getJob(jobId);
    if (job === undefined) {
      throw new HttpError(
        HttpStatusCode.NOT_FOUND,
        `No job ${jobId} on "${queue}"`,
      );
    }
    return {
      id: job.id ?? jobId,
      state: await job.getState(),
      attempts: job.attemptsMade,
      result: (job.returnvalue as unknown) ?? null,
      failedReason: job.failedReason ?? null,
    };
  }

  @ApiDoc({ tags: ['queues'], summary: 'Retry a failed job' })
  @Roles(UserRole.ADMIN)
  @Post('/:queue/jobs/:jobId/retry', oneJob)
  async retry(input: Input<typeof oneJob>): Promise<{ id: string }> {
    const { queue, jobId } = input.params;
    const job = await this.publisher.queue(queue).getJob(jobId);
    if (job === undefined) {
      throw new HttpError(
        HttpStatusCode.NOT_FOUND,
        `No job ${jobId} on "${queue}"`,
      );
    }
    await job.retry();
    return { id: jobId };
  }

  @ApiDoc({ tags: ['queues'], summary: 'Drain a queue of waiting jobs' })
  @Roles(UserRole.ADMIN)
  @Post('/:queue/drain', oneQueue)
  async drain(input: Input<typeof oneQueue>): Promise<{ queue: string }> {
    await this.publisher.queue(input.params.queue).drain();
    return { queue: input.params.queue };
  }
}
