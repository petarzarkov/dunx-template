import { Controller, Get, Public } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { AppConfigService } from '../../config/app.config.service.js';
import { NoCache } from '../../core/decorators/no-cache.decorator.js';
import { SERVICE_ROUTES } from '../../constants.js';

/**
 * What this build is, which is not a health concern and never was.
 *
 * It shared a controller with the health checks because both were "service
 * information". `HealthModule` owns liveness and readiness now, and this is what
 * was left: the version, the commit it came from, and the runtime under it -
 * read once at boot and answered without touching anything.
 */
@ApiDoc({
  tags: ['service'],
  description: 'What this build is and what it is running on.',
})
@Controller(SERVICE_ROUTES.BASE)
export class BuildInfoController {
  constructor(private readonly config: AppConfigService) {}

  @ApiDoc({ tags: ['service'], summary: 'Build and runtime information' })
  @NoCache()
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
}
