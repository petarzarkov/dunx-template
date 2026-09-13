import {
  Controller,
  Delete,
  Get,
  Post,
  Public,
  Roles,
  type Input,
} from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import type { SanitizedUser } from '../dto/user.dto.js';
import { UserRole } from '../schema/user.schema.js';
import {
  acceptInvite,
  createInvite,
  listInvites,
  revokeInvite,
  type Invite,
} from './dto/invite.dto.js';
import { InvitesService } from './services/invites.service.js';

/**
 * Three admin routes and one public one, in the same controller.
 *
 * `@Public()` on a single handler is what makes that work: guards compose per
 * route rather than per controller, so the accept route is reachable without a
 * session while its neighbours still require `admin`. In the NestJS template
 * this was the same arrangement, `@Public()` against a global `AuthGuard`.
 */
@ApiDoc({
  tags: ['invites'],
  description: 'Invite an address to create an account, and redeem the code.',
})
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @ApiDoc({ tags: ['invites'], summary: 'List invitations' })
  @Roles(UserRole.ADMIN)
  @Get('/', listInvites)
  list(input: Input<typeof listInvites>): Invite[] {
    return this.invites.list(input.query.status);
  }

  @ApiDoc({ tags: ['invites'], summary: 'Invite an address' })
  @Roles(UserRole.ADMIN)
  @Post('/', createInvite)
  create(input: Input<typeof createInvite>): Promise<Invite> {
    return this.invites.create(input.body);
  }

  /**
   * The one public route. The code is the credential, so there is nothing to
   * authenticate against - and it is in the body rather than the path so it
   * stays out of access logs.
   */
  @ApiDoc({ tags: ['invites'], summary: 'Redeem an invite code' })
  @Public()
  @Post('/accept', acceptInvite)
  accept(input: Input<typeof acceptInvite>): Promise<SanitizedUser> {
    return this.invites.accept(input.body);
  }

  @ApiDoc({ tags: ['invites'], summary: 'Revoke an invitation' })
  @Roles(UserRole.ADMIN)
  @Delete('/:inviteId', revokeInvite)
  revoke(input: Input<typeof revokeInvite>): void {
    this.invites.revoke(input.params.inviteId);
  }
}
