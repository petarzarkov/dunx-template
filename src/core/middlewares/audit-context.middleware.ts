import type { Middleware, Next, RouteContext } from '@dunx/http';
import type { BunRequest } from 'bun';
import { CurrentUser } from '../../auth/services/current-user.service.js';
import { DatabaseBootstrap } from '../../infra/db/database.module.js';
import { setAuditActor } from '../../infra/db/triggers.js';

/**
 * Stamps the acting user into the single-row `_audit_ctx` table so the database
 * triggers can attribute the rows they write.
 *
 * The actor is the authenticated caller, read out of `AuthContext` - which is why
 * this runs **after** `SessionGuard`, whose `context.run(principal, next)` is what
 * opened the scope. It used to be an `x-actor-id` header, a stand-in for exactly
 * this that trusted whatever the client sent.
 *
 * `SessionGuard` also writes `userId` into `RequestContext`, so every log line in
 * the request is correlated without this doing anything.
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
    private readonly caller: CurrentUser,
  ) {}

  handle(_req: BunRequest, _ctx: RouteContext, next: Next): Promise<Response> {
    setAuditActor(this.database.raw, this.caller.optional()?.id ?? null);
    return next();
  }
}
