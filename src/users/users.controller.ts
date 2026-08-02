import {
  Controller,
  Delete,
  Get,
  HttpError,
  HttpStatusCode,
  Patch,
  Post,
  Roles,
  type Input,
} from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import type { Page } from '../core/pagination/page-options.dto.js';
import {
  createUser,
  listUsers,
  oneUser,
  updateUser,
  type SanitizedUser,
} from './dto/user.dto.js';
import { UserRole } from './schema/user.schema.js';
import { UsersService } from './services/users.service.js';

/**
 * NestJS reads the body with `@Body()` and the params with `@Param()`. There are
 * no parameter decorators in the TC39 proposal, so dunx hands the handler one
 * `input` argument whose shape comes from the route's own schemas. The schemas
 * are declared once and both the validation and the type follow from them.
 */
@ApiDoc({ tags: ['users'], description: 'Read and administer user accounts.' })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiDoc({ tags: ['users'], summary: 'List users, keyset paginated' })
  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get('/', listUsers)
  list(input: Input<typeof listUsers>): Page<SanitizedUser> {
    return this.users.list(input.query);
  }

  @ApiDoc({ tags: ['users'], summary: 'Fetch one user by id' })
  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get('/:userId', oneUser)
  one(input: Input<typeof oneUser>): SanitizedUser {
    return this.users.findById(input.params.userId);
  }

  @ApiDoc({ tags: ['users'], summary: 'Create a user' })
  @Roles(UserRole.ADMIN)
  @Post('/', createUser)
  create(input: Input<typeof createUser>): SanitizedUser {
    return this.users.create(input.body);
  }

  @ApiDoc({ tags: ['users'], summary: 'Patch a user' })
  @Roles(UserRole.ADMIN)
  @Patch('/:userId', updateUser)
  update(input: Input<typeof updateUser>): SanitizedUser {
    return this.users.update(input.params.userId, input.body);
  }

  @ApiDoc({
    tags: ['users'],
    summary: 'Ban a user so it can no longer use the platform',
  })
  @Roles(UserRole.ADMIN)
  @Post('/:userId/ban', oneUser)
  ban(input: Input<typeof oneUser>): SanitizedUser {
    if (input.req.headers.get('x-actor-id') === input.params.userId) {
      throw new HttpError(
        HttpStatusCode.FORBIDDEN,
        'You cannot ban your own account',
      );
    }
    return this.users.setBanned(input.params.userId, true);
  }

  @ApiDoc({ tags: ['users'], summary: 'Lift a ban' })
  @Roles(UserRole.ADMIN)
  @Post('/:userId/unban', oneUser)
  unban(input: Input<typeof oneUser>): SanitizedUser {
    return this.users.setBanned(input.params.userId, false);
  }

  @ApiDoc({ tags: ['users'], summary: 'Delete a user' })
  @Roles(UserRole.ADMIN)
  @Delete('/:userId', oneUser)
  remove(input: Input<typeof oneUser>): void {
    this.users.remove(input.params.userId);
  }
}
