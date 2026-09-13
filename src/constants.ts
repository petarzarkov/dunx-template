/**
 * Route segments are constants, not environment variables. A decorator argument
 * is evaluated at class-definition time, long before the container or the
 * validated config exists, so `@Controller(config.get(...))` is not expressible.
 * The NestJS template carried `SERVICE_ROUTE`/`HEALTH_ROUTE`/... as env vars and
 * then hardcoded the same strings in the decorators anyway; this makes the one
 * source of truth explicit instead.
 */
export const SERVICE_ROUTES = Object.freeze({
  BASE: 'service',
  CONFIG: 'config',
} as const);

/**
 * Where `HealthModule` mounts, which this app does not choose: the controller is
 * `@dunx/http`'s and declares `health/live` and `health/ready` itself.
 *
 * Named here anyway, because three other things have to agree with it - the
 * paths `requestLogging` ignores, the CI probe and the e2e suite - and a string
 * repeated in four places is the one that drifts.
 */
export const HEALTH_ROUTES = Object.freeze({
  BASE: 'health',
  LIVENESS: 'health/live',
  READINESS: 'health/ready',
} as const);

/**
 * Where `@dunx/auth`'s handler is mounted, relative to the global prefix, and the
 * websocket upgrade path. Both are route paths, so both are decided at
 * class-definition time and neither can come from the environment.
 */
export const WS_PATH = '/ws';
