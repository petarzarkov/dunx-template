import { meta, metaKey } from '@dunx/http';
import type { AppEnv } from '../../config/dto/service-vars.dto.js';

/**
 * A window in seconds, or one per environment.
 *
 * The map exists because an expensive route wants a different answer in
 * development than in production: one invite an hour is right for a deployment
 * and intolerable while building the page that sends it. An environment the map
 * omits falls back to the app-wide default, and `0` disables the limit for that
 * environment entirely.
 */
export type ThrottleWindow = number | Partial<Record<AppEnv, number>>;

export interface ThrottleOptions {
  /** Requests allowed per window, per caller. */
  readonly limit: number;
  readonly windowSeconds: ThrottleWindow;
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
 * with its own Lua script and an `@EnvThrottle` decorator for the per-route,
 * per-environment one, because the package cannot express a different window per
 * environment. Here all three are the same guard and the same decorator, and the
 * app-wide default comes from validated config.
 *
 * ```ts
 * @Throttle({ limit: 1, windowSeconds: { local: 60, prod: 3600 } })
 * ```
 */
export const Throttle = (options: ThrottleOptions) => meta(THROTTLE, options);

/**
 * Which window applies right now. Exported because `ThrottleGuard` is the only
 * caller and a test is the only other reader, and both want the rule rather
 * than a copy of it.
 *
 * `undefined` means "no limit on this route in this environment", which is what
 * a `0` is for: a route that is rate limited in production and unthrottled while
 * it is being written.
 */
export const windowFor = (
  window: ThrottleWindow,
  env: AppEnv,
  fallback: number,
): number | undefined => {
  const seconds =
    typeof window === 'number' ? window : (window[env] ?? fallback);
  return seconds <= 0 ? undefined : seconds;
};
