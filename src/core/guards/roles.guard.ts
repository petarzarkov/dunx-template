import { Logger } from '@dunx/core';
import {
  HttpError,
  HttpStatusCode,
  PUBLIC,
  ROLES,
  type Middleware,
  type Next,
  type RouteContext,
} from '@dunx/http';
import type { BunRequest } from 'bun';
import { UsersRepository } from '../../users/repos/users.repository.js';
import type { UserRole } from '../../users/schema/user.schema.js';

/**
 * dunx has no `CanActivate`. A guard is middleware that throws: allow by
 * returning `next()`, refuse by throwing an `HttpError`. Nothing downstream
 * runs, so the body is never read and the handler is never invoked.
 *
 * This stands in for the NestJS template's Better Auth `AuthGuard`: the actor is
 * an `x-actor-id` header rather than a session cookie, so the template stays
 * free of an auth dependency while still exercising the guard and metadata
 * machinery. Swap the lookup for `@dunx/auth`'s `SessionGuard` when you add
 * real authentication.
 */
export class RolesGuard implements Middleware {
  constructor(
    private readonly users: UsersRepository,
    private readonly logger: Logger,
  ) {}

  async handle(
    req: BunRequest,
    ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    if (ctx.get(PUBLIC) === true) return next();

    const required = ctx.get(ROLES);
    if (required === undefined) return next();

    const actorId = req.headers.get('x-actor-id');
    if (actorId === null) {
      throw new HttpError(HttpStatusCode.UNAUTHORIZED, 'UNAUTHENTICATED');
    }

    const actor = this.users.findById(actorId);
    if (actor === undefined || actor.banned) {
      this.logger.warn('rejected actor', { actorId, banned: actor?.banned });
      throw new HttpError(HttpStatusCode.UNAUTHORIZED, 'UNAUTHENTICATED');
    }

    if (!required.includes(actor.role satisfies UserRole)) {
      throw new HttpError(
        HttpStatusCode.FORBIDDEN,
        `Requires one of: ${required.join(', ')}`,
      );
    }

    return next();
  }
}
