import { Module } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './repos/users.repository.js';
import { UsersService } from './services/users.service.js';

/**
 * `AccountsModule` for `Auth` - the service bans and unbans through better-auth's
 * own API rather than by writing the column - and for `CurrentUser`, which the
 * controller reads to decide whose records a non-admin may see.
 *
 * Nothing is exported. `UsersRepository` is the table and `UsersService` is this
 * feature's own logic; a second feature that needs a user reads it through
 * better-auth, which is the one source that stays in step with sessions.
 */
@Module({
  imports: [AccountsModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
})
export class UsersModule {}
