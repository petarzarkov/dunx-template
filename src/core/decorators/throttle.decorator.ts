import { meta, metaKey } from '@dunx/http';

export interface ThrottleOptions {
  /** Requests allowed per window, per caller. */
  readonly limit: number;
  readonly windowSeconds: number;
}

export const THROTTLE = metaKey<ThrottleOptions>('throttle');

/**
 * A per-route rate limit, read by `ThrottleGuard`.
 *
 * `metaKey` plus `meta` is the whole mechanism `@Roles()` and `@Public()` use, and
 * it is public API - so an app's own metadata needs no `reflect-metadata`, no
 * registry and no framework change. `RouteContext.get(THROTTLE)` is what a
 * middleware reads it back with.
 *
 * The NestJS template needed two throttlers for this: `@nestjs/throttler` with
 * three named tiers for the global limit, and a hand-rolled `EnvThrottlerGuard`
 * with its own Lua script for the per-route one, because the package cannot express
 * a different window per environment. Here both are the same guard, and the default
 * comes from the validated config.
 */
export const Throttle = (options: ThrottleOptions) => meta(THROTTLE, options);
