import { Module } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { InvitesController } from './invites/invites.controller.js';
import { InvitesRepository } from './invites/repos/invites.repository.js';
import { InvitesService } from './invites/services/invites.service.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './repos/users.repository.js';
import { UsersService } from './services/users.service.js';

/**
 * `AccountsModule` for `Auth` - the service bans and unbans through better-auth's
 * own API rather than by writing the column - and for `CurrentUser`, which the
 * controller reads to decide whose records a non-admin may see.
 *
 * Invites live here rather than in a module of their own: `InvitesService` needs
 * `UsersRepository` to refuse an address that already has an account and to apply
 * the invited role after sign-up, and that repository is this module's and is not
 * exported.
 *
 * Nothing is exported. `UsersRepository` is the table and `UsersService` is this
 * feature's own logic; a second feature that needs a user reads it through
 * better-auth, which is the one source that stays in step with sessions.
 */
@Module({
  imports: [AccountsModule],
  controllers: [UsersController, InvitesController],
  providers: [UsersService, UsersRepository, InvitesService, InvitesRepository],
})
export class UsersModule {}
