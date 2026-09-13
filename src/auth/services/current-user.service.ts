import { AuthContext, rolesOf } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { UserRole } from '../../users/schema/user.schema.js';

export interface Caller {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly sessionId: string;
}

/**
 * The authenticated caller, for services that are several constructor hops from
 * the request and are handed nothing.
 *
 * `AuthContext` is `AsyncLocalStorage`, written by `SessionGuard` on the way in,
 * so this needs no argument threaded through any signature. It exists rather than
 * every consumer injecting `AuthContext` directly because the two things the app
 * actually asks - "who is calling" and "is the caller an admin" - are worth
 * naming once.
 */
export class CurrentUser {
  constructor(private readonly context: AuthContext) {}

  /** The caller, or `undefined` on a `@Public()` route. */
  optional(): Caller | undefined {
    const principal = this.context.current();
    if (principal === undefined) return undefined;
    const { user, session } = principal;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: rolesOf(user),
      sessionId: session.id,
    };
  }

  /** The caller, or a 401. For anything behind `SessionGuard`. */
  require(): Caller {
    const caller = this.optional();
    if (caller === undefined) {
      throw new HttpError(HttpStatusCode.UNAUTHORIZED, 'UNAUTHENTICATED');
    }
    return caller;
  }

  isAdmin(): boolean {
    return this.optional()?.roles.includes(UserRole.ADMIN) === true;
  }
}
