import { sql } from 'drizzle-orm';
import { Controller, Get, HttpStatusCode, Public } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { SyncDatabase } from '@dunx/infra/db';
import { LocalStorage, Storage } from '@dunx/infra/files';
import { Images } from '@dunx/infra/images';
import { JobPublisher, QueueOptions } from '@dunx/infra/queue';
import { AppConfigService } from '../../config/app.config.service.js';
import { NoCache } from '../../core/decorators/no-cache.decorator.js';
import { SERVICE_ROUTES } from '../../constants.js';
import { QUEUES } from '../../notifications/events/events.js';
import { DegradingCacheStore } from '../cache/degrading-store.js';
import * as schema from '../db/schema.js';

export type IndicatorStatus = 'up' | 'down' | 'degraded';

export interface Indicator {
  readonly status: IndicatorStatus;
  readonly message?: string;
  readonly [key: string]: unknown;
}

export interface HealthReport {
  readonly status: 'ok' | 'error';
  readonly info: Record<string, Indicator>;
  readonly degraded: Record<string, Indicator>;
  readonly error: Record<string, Indicator>;
  readonly details: Record<string, Indicator>;
}

/**
 * Terminus has no dunx counterpart, so the envelope it produced is reproduced here
 * rather than pulled in as a dependency - plus one state Terminus does not have.
 *
 * Three states, not two. `down` fails the probe; **`degraded` does not**. Redis, the
 * queue and a remote bucket may all be absent, and an area whose service is missing
 * reports that it is skipping while the app keeps serving everything else. Only what
 * is in-process and non-optional - the database, the heap - can fail readiness,
 * because nothing else being absent is a reason to take the process out of rotation.
 *
 * All three routes are `@Public()`, so a probe needs no credential.
 */
@ApiDoc({
  tags: ['service'],
  description: 'Liveness, readiness and build info.',
})
@Controller(SERVICE_ROUTES.BASE)
export class HealthController {
  constructor(
    private readonly db: SyncDatabase<typeof schema>,
    private readonly config: AppConfigService,
    private readonly cache: DegradingCacheStore,
    private readonly storage: Storage,
    private readonly images: Images,
    private readonly publisher: JobPublisher,
    private readonly queue: QueueOptions,
  ) {}

  #checkDb(): Indicator {
    try {
      this.db.get(sql`select 1`);
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', message: (error as Error).message };
    }
  }

  #checkMemory(): Indicator {
    const limit = this.config.get('service').maxMemoryMb * 1024 * 1024;
    const used = process.memoryUsage().heapUsed;
    return used < limit
      ? { status: 'up', used, limit }
      : { status: 'down', message: 'heap over limit', used, limit };
  }

  /**
   * A real read, not a ping and not the last-seen flag.
   *
   * The flag alone was wrong on a process that has served nothing yet: it starts
   * optimistic, so a fresh container reported the cache healthy until something
   * happened to use it. `probe()` touches the backend the same way the cache
   * does, which is what makes the answer true at the moment it is asked.
   */
  async #checkCache(): Promise<Indicator> {
    const { reachable, note } = await this.cache.probe();
    return reachable
      ? { status: 'up' }
      : { status: 'degraded', message: note ?? 'unreachable' };
  }

  /**
   * One listing, bounded to a single entry. A local directory always answers; a
   * bucket that is absent, misconfigured or unreachable does not, and that is a
   * degradation rather than a failure.
   */
  async #checkStorage(): Promise<Indicator> {
    const { driver } = this.config.get('storage');
    try {
      for await (const _entry of this.storage.list({ limit: 1 })) break;
      return {
        status: 'up',
        driver,
        root: this.storage instanceof LocalStorage ? this.storage.root : null,
      };
    } catch (error) {
      return { status: 'degraded', driver, message: (error as Error).message };
    }
  }

  async #checkQueue(): Promise<Indicator> {
    try {
      const counts = await this.publisher
        .queue(QUEUES.NOTIFICATIONS)
        .getJobCounts();
      return { status: 'up', broker: this.queue.redactedUrl, counts };
    } catch (error) {
      return {
        status: 'degraded',
        broker: this.queue.redactedUrl,
        message: (error as Error).message,
      };
    }
  }

  @ApiDoc({
    tags: ['service'],
    summary: 'Readiness: every area, live or degraded',
  })
  /**
   * Never cached. A readiness probe answering a stale "ok" for thirty seconds
   * after the database went away is worse than having no probe.
   */
  @NoCache()
  @Public()
  @Get(`/${SERVICE_ROUTES.HEALTH}`)
  async check(): Promise<Response> {
    const details: Record<string, Indicator> = {
      db: this.#checkDb(),
      memory_heap: this.#checkMemory(),
      cache: await this.#checkCache(),
      storage: await this.#checkStorage(),
      queue: await this.#checkQueue(),
      // In-process and always available: `Bun.Image` is the runtime itself.
      images: {
        status: 'up',
        quality: this.images.config.quality,
        maxPixels: this.images.config.maxPixels,
      },
    };

    const at = (status: IndicatorStatus): Record<string, Indicator> =>
      Object.fromEntries(
        Object.entries(details).filter(([, value]) => value.status === status),
      );

    const error = at('down');
    const ok = Object.keys(error).length === 0;

    const report: HealthReport = {
      status: ok ? 'ok' : 'error',
      info: at('up'),
      degraded: at('degraded'),
      error,
      details,
    };

    // A failing readiness probe has to be a failing status code, and a handler
    // that returns a plain object always gets the route's success status. The
    // escape hatch is returning a `Response` yourself.
    return Response.json(report, {
      status: ok ? HttpStatusCode.OK : HttpStatusCode.SERVICE_UNAVAILABLE,
    });
  }

  @ApiDoc({ tags: ['service'], summary: 'Build and runtime information' })
  @Public()
  @Get(`/${SERVICE_ROUTES.CONFIG}`)
  version(): Record<string, unknown> {
    const app = this.config.get('app');
    const service = this.config.get('service');
    return {
      name: app.name,
      version: app.version,
      env: app.env,
      commitSha: service.commitSha ?? null,
      commitMessage: service.commitMessage ?? null,
      tz: app.timezone,
      versions: { bun: Bun.version, node: process.versions.node },
    };
  }

  @ApiDoc({ tags: ['service'], summary: 'Liveness: is the process up' })
  @NoCache()
  @Public()
  @Get(`/${SERVICE_ROUTES.LIVENESS}`)
  up(): { uptimeSeconds: number } {
    return { uptimeSeconds: process.uptime() };
  }
}
