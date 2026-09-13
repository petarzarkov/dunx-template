import { meta, metaKey } from '@dunx/http';

export const NO_CACHE = metaKey<true>('no-cache');

/**
 * Excludes one route from `ResponseCacheMiddleware`.
 *
 * The same `metaKey`/`meta` pair `@Throttle`, `@Roles` and `@Public` use, read
 * back with `ctx.get(NO_CACHE)`. In the NestJS template this was `SetMetadata`
 * plus a `Reflector` lookup inside a subclassed `CacheInterceptor`.
 */
export const NoCache = () => meta(NO_CACHE, true);
