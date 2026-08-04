import { Controller, Get, Public, Roles } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import { AuditService } from '../audit/services/audit.service.js';
import { UserRole } from '../users/schema/user.schema.js';
import type { AuditLogEntry } from '../audit/dto/audit-log.dto.js';
import {
  PaginationDirection,
  PaginationOrder,
  type Page,
} from '@dunx/infra/pagination';
import { CurrentUser, type Caller } from './services/current-user.service.js';

/**
 * What the session actually resolved to, which is the one endpoint every client
 * of a Better Auth service needs and better-auth does not provide in the app's own
 * shape.
 *
 * Nothing here is handed a user: `CurrentUser` reads the principal out of
 * `AuthContext`, so a service two hops from the request sees the caller without it
 * being threaded through a signature.
 */
@ApiDoc({
  tags: ['profile'],
  description: 'The authenticated caller, as this service sees it.',
})
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly caller: CurrentUser,
    private readonly audit: AuditService,
  ) {}

  @ApiDoc({ tags: ['profile'], summary: 'The current session' })
  @Get('/')
  me(): Caller {
    return this.caller.require();
  }

  /**
   * The global `SessionGuard` reads this and 403s unless the caller holds `admin`
   * - the same metadata `@dunx/openapi` reads to emit `x-required-roles`, so the
   * document and the guard cannot disagree.
   */
  @ApiDoc({ tags: ['profile'], summary: 'Recent audit entries for the caller' })
  @Roles(UserRole.ADMIN)
  @Get('/audit')
  entries(): Promise<Page<AuditLogEntry>> {
    return this.audit.list({
      order: PaginationOrder.DESC,
      direction: PaginationDirection.FORWARD,
      take: 20,
      actorId: this.caller.require().id,
    });
  }

  /**
   * The guard reads this and skips: no session lookup, no rejection. A public
   * route that wants to *adapt* to an optional caller asks `CurrentUser` and gets
   * `undefined`.
   */
  @ApiDoc({
    tags: ['profile'],
    summary: 'Whether this request carried a session',
  })
  @Public()
  @Get('/anonymous')
  anonymous(): { caller: string | null } {
    return { caller: this.caller.optional()?.email ?? null };
  }
}
