import {
  HttpError,
  HttpStatusCode,
  type Middleware,
  type Next,
  type RouteContext,
} from '@dunx/http';
import type { BunRequest } from 'bun';

/**
 * A module-scoped exception filter, which in dunx is just middleware: work after
 * `next()` - or in this case around it - is what an interceptor and a filter both
 * were.
 *
 * No Redis is a degraded queue, not a broken app, the same contract the cache
 * routes keep. bullmq surfaces some failures through its own client rather than
 * Bun's, so the error shape is not guaranteed; anything unrecognised still becomes
 * a 503 rather than a 500, because "the queue is not reachable" is the only thing it
 * can mean on these routes.
 *
 * This used to be a private `degrades()` helper wrapped around all five route
 * bodies, which is what a per-controller `@Catch` filter is for elsewhere. It is
 * listed in `@Module({ middleware })` instead, so it covers exactly the routes
 * `QueuesController` declares and nothing the module imports - and an `HttpError`
 * rethrown here still travels out to the app-wide mapper, which is the route →
 * controller → global cascade with no second concept behind it.
 */
export class QueueUnavailableMiddleware implements Middleware {
  async handle(
    _req: BunRequest,
    _ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    try {
      return await next();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        HttpStatusCode.SERVICE_UNAVAILABLE,
        `Queue unavailable: ${(error as Error).message}`,
      );
    }
  }
}
