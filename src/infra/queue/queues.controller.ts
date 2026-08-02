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
 * What Bull Board showed, as JSON.
 *
 * The NestJS template mounted `@bull-board/express` at `/api/queues` behind a
 * session-cookie middleware. dunx has no counterpart and should not grow one: Bull
 * Board is an Express-mounted React application, and `Bun.serve` is not Express.
 * What is portable is the *data* - job counts per queue, one job's state and result,
 * and a retry button - so that is what this exposes, admin-only, and a dashboard is
 * whatever renders it.
 *
 * Every route degrades: with no Redis these answer 503 in single-digit milliseconds
 * rather than hanging, which is what makes the whole app bootable with nothing
 * running.
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
    const queues = await this.degrades(() =>
      Promise.all(
        Object.values(QUEUES).map(async (name) => ({
          name,
          counts: await this.publisher.queue(name).getJobCounts(),
        })),
      ),
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

    const job = await this.degrades(() =>
      this.publisher.publish(
        queue,
        name,
        data,
        delay === undefined ? undefined : { delay },
      ),
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
    const job = await this.degrades(() =>
      this.publisher.queue(queue).getJob(jobId),
    );
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
    await this.degrades(async () => {
      const job = await this.publisher.queue(queue).getJob(jobId);
      if (job === undefined) {
        throw new HttpError(
          HttpStatusCode.NOT_FOUND,
          `No job ${jobId} on "${queue}"`,
        );
      }
      await job.retry();
    });
    return { id: jobId };
  }

  @ApiDoc({ tags: ['queues'], summary: 'Drain a queue of waiting jobs' })
  @Roles(UserRole.ADMIN)
  @Post('/:queue/drain', oneQueue)
  async drain(input: Input<typeof oneQueue>): Promise<{ queue: string }> {
    await this.degrades(() => this.publisher.queue(input.params.queue).drain());
    return { queue: input.params.queue };
  }

  /**
   * No Redis is a degraded queue, not a broken app - the same contract the cache
   * routes keep. bullmq surfaces some failures through its own client rather than
   * Bun's, so the error shape is not guaranteed; anything unrecognised still
   * becomes a 503 rather than a 500, because "the queue is not reachable" is the
   * only thing it can mean here.
   */
  private async degrades<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const reason = (error as Error).message;
      throw new HttpError(
        HttpStatusCode.SERVICE_UNAVAILABLE,
        `Queue unavailable: ${reason}`,
      );
    }
  }
}
