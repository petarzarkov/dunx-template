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
  HEALTH: 'health',
  LIVENESS: 'up',
  CONFIG: 'config',
} as const);

export const ACTOR_HEADER = 'x-actor-id';
