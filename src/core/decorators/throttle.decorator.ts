import { SkipThrottle, Throttle, type ThrottleLimit } from '@dunx/http';
import { AppEnv } from '../../config/dto/service-vars.dto.js';

export { SkipThrottle, Throttle, type ThrottleLimit };

/**
 * A per-route limit that is off in local development.
 *
 * `@Throttle` and `@SkipThrottle` are the framework's, and this is the one thing
 * they cannot express between them: which of the two applies depends on the
 * environment, and a decorator argument is evaluated at class-definition time -
 * before a container exists, and therefore before validated config does.
 *
 * So it reads `Bun.env` directly. That is the deliberate exception to "config is
 * validated once": `APP_ENV` is a plain string with a default, nothing here can
 * fail on a bad value, and the alternative is a second guard reading the same
 * metadata the framework's already reads.
 *
 * The NestJS template needed `@EnvThrottle` plus a second `EnvThrottlerGuard`
 * with its own Lua script for this, because `@nestjs/throttler` could not vary a
 * window by environment. Here it is one decorator that picks one of two.
 *
 * ```ts
 * @ThrottleUnlessLocal({ limit: 10, windowSeconds: 600 })
 * ```
 */
export const ThrottleUnlessLocal = (limit: ThrottleLimit) =>
  (Bun.env['APP_ENV'] ?? AppEnv.LOCAL) === AppEnv.LOCAL
    ? SkipThrottle()
    : Throttle(limit);
