import type { HttpOptions } from '@dunx/http';
import { SERVICE_ROUTES } from './constants.js';
import type { AppConfig } from './config/app.config.js';
import { errorMapper } from './core/errors/error-mapper.js';
import { AuditContextMiddleware } from './core/middlewares/audit-context.middleware.js';
import { RolesGuard } from './core/guards/roles.guard.js';

/**
 * The `HttpOptions` in one place, because they have to be passed to
 * `HttpFactory.create` **and** to `@dunx/testing`'s `createTestServer` -
 * neither reads them off the container, and the harness inherits nothing from
 * the production entrypoint. A suite that forgets them gets a server with no
 * guards and no error mapper, which still boots and still answers, so the
 * omission is silent.
 */
export const httpOptions = (config: AppConfig): HttpOptions => {
  const servicePath = `/${config.app.prefix}/${SERVICE_ROUTES.BASE}`;
  return {
    // Outermost first, after the built-in request logger: stamp the audit actor,
    // then authorise. A guard is middleware that throws, so ordering is the only
    // thing that decides which runs first.
    middleware: [AuditContextMiddleware, RolesGuard],
    onError: errorMapper,
    requestLogging: {
      requestBody: config.log.requestBody,
      responseBody: config.log.responseBody,
      ignore: [
        `${servicePath}/${SERVICE_ROUTES.LIVENESS}`,
        `${servicePath}/${SERVICE_ROUTES.HEALTH}`,
      ],
    },
  };
};
