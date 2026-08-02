import { sql } from 'drizzle-orm';
import { Controller, Get, HttpStatusCode, Public } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { SyncDatabase } from '@dunx/infra/db';
import { AppConfigService } from '../../config/app.config.service.js';
import { SERVICE_ROUTES } from '../../constants.js';
import * as schema from '../db/schema.js';

export type IndicatorStatus = 'up' | 'down';

export interface Indicator {
  readonly status: IndicatorStatus;
  readonly message?: string;
  readonly [key: string]: unknown;
}

export interface HealthReport {
  readonly status: 'ok' | 'error';
  readonly info: Record<string, Indicator>;
  readonly error: Record<string, Indicator>;
  readonly details: Record<string, Indicator>;
}

/**
 * Three routes, all `@Public()` so the guard lets a probe through without a
 * credential. Terminus has no dunx counterpart, so the envelope it produced is
 * reproduced here in twenty lines rather than pulled in as a dependency.
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

  @ApiDoc({ tags: ['service'], summary: 'Readiness: database and heap' })
  @Public()
  @Get(`/${SERVICE_ROUTES.HEALTH}`)
  check(): Response {
    const details: Record<string, Indicator> = {
      db: this.#checkDb(),
      memory_heap: this.#checkMemory(),
    };

    const entries = Object.entries(details);
    const info = Object.fromEntries(
      entries.filter(([, value]) => value.status === 'up'),
    );
    const error = Object.fromEntries(
      entries.filter(([, value]) => value.status === 'down'),
    );
    const ok = Object.keys(error).length === 0;

    const report: HealthReport = {
      status: ok ? 'ok' : 'error',
      info,
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
  @Public()
  @Get(`/${SERVICE_ROUTES.LIVENESS}`)
  up(): { uptimeSeconds: number } {
    return { uptimeSeconds: process.uptime() };
  }
}
