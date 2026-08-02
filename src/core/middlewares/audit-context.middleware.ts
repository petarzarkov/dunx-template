import { RequestContext } from '@dunx/core';
import type { Middleware, Next, RouteContext } from '@dunx/http';
import type { BunRequest } from 'bun';
import { DatabaseBootstrap } from '../../infra/db/database.module.js';
import { setAuditActor } from '../../infra/db/triggers.js';

/**
 * Stamps the acting user into the single-row `_audit_ctx` table so the database
 * triggers can attribute the rows they write, and mirrors it into the async
 * request context so every log line in the request carries `userId`.
 *
 * NestJS did this in an `APP_INTERCEPTOR`. dunx has one extension point, so an
 * interceptor and a middleware are the same thing: work before `next()`, work
 * after it, or both.
 *
 * Best-effort under concurrency: there is one SQLite connection and one context
 * row, so interleaved requests can race. A pooled backend should set a session
 * variable instead.
 */
export class AuditContextMiddleware implements Middleware {
  constructor(
    private readonly database: DatabaseBootstrap,
    private readonly context: RequestContext,
  ) {}

  handle(req: BunRequest, _ctx: RouteContext, next: Next): Promise<Response> {
    const actorId = req.headers.get('x-actor-id');
    setAuditActor(this.database.raw, actorId);
    if (actorId !== null) this.context.updateContext({ userId: actorId });
    return next();
  }
}
