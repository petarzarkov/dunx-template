import { Auth } from '@dunx/auth';
import { Logger } from '@dunx/core';
import { JobPublisher } from '@dunx/infra/queue';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type { Page } from '../../core/pagination/page-options.dto.js';
import { JOBS, QUEUES } from '../../notifications/events/events.js';
import type { CreateUser, SanitizedUser, UpdateUser } from '../dto/user.dto.js';
import type { UserRow } from '../schema/user.schema.js';
import {
  UsersRepository,
  type ListUsersFilters,
} from '../repos/users.repository.js';

const sanitize = (row: UserRow): SanitizedUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  banned: row.banned,
  emailVerified: row.emailVerified,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly auth: Auth,
    private readonly publisher: JobPublisher,
    private readonly logger: Logger,
  ) {}

  list(filters: ListUsersFilters): Page<SanitizedUser> {
    const page = this.repo.list(filters);
    return { data: page.data.map(sanitize), meta: page.meta };
  }

  findById(id: string): SanitizedUser {
    const row = this.repo.findById(id);
    if (row === undefined) {
      throw new HttpError(HttpStatusCode.NOT_FOUND, `No user with id ${id}`);
    }
    return sanitize(row);
  }

  /**
   * Through better-auth's own sign-up, not an insert.
   *
   * A row written straight into `user` has no `account` row and therefore no
   * password hash, so it could never sign in - a directory entry rather than a
   * user. `api.signUpEmail` is what creates the credential, hashes it with
   * `Bun.password`, and fires the `user.registered` hook that queues the welcome
   * notification.
   *
   * The role is applied afterwards, because the `admin()` plugin's sign-up always
   * uses its `defaultRole` and its `setRole` endpoint needs an authenticated admin
   * whose session this service does not hold.
   */
  async create(input: CreateUser): Promise<SanitizedUser> {
    if (this.repo.findByEmail(input.email) !== undefined) {
      throw new HttpError(
        HttpStatusCode.CONFLICT,
        'A user with that email already exists',
      );
    }

    await this.auth.api.signUpEmail({
      body: { email: input.email, name: input.name, password: input.password },
    });

    const created = this.byEmail(input.email);
    const row = this.repo.update(created.id, { role: input.role });
    if (row === undefined) {
      throw new HttpError(
        HttpStatusCode.INTERNAL_SERVER_ERROR,
        'The user was created but could not be read back',
      );
    }

    this.logger.info('user created', { userId: row.id, role: row.role });
    return sanitize(row);
  }

  update(id: string, input: UpdateUser): SanitizedUser {
    const row = this.repo.update(id, input);
    if (row === undefined) {
      throw new HttpError(HttpStatusCode.NOT_FOUND, `No user with id ${id}`);
    }
    this.logger.info('user updated', {
      userId: id,
      fields: Object.keys(input),
    });
    return sanitize(row);
  }

  async setBanned(id: string, banned: boolean): Promise<SanitizedUser> {
    const user = this.update(id, { banned });
    if (banned) await this.notifyBanned(user);
    return user;
  }

  remove(id: string): void {
    if (!this.repo.deleteById(id)) {
      throw new HttpError(HttpStatusCode.NOT_FOUND, `No user with id ${id}`);
    }
    this.logger.warn('user deleted', { userId: id });
  }

  private byEmail(email: string): UserRow {
    const row = this.repo.findByEmail(email);
    if (row === undefined) {
      throw new HttpError(
        HttpStatusCode.INTERNAL_SERVER_ERROR,
        `Sign-up reported success but no user exists for ${email}`,
      );
    }
    return row;
  }

  /** An unreachable queue costs a notification, never the ban itself. */
  private async notifyBanned(user: SanitizedUser): Promise<void> {
    try {
      await this.publisher.publish(QUEUES.NOTIFICATIONS, JOBS.USER_BANNED, {
        userId: user.id,
        email: user.email,
        reason: 'Suspended by an administrator',
      });
    } catch (error) {
      this.logger.warn('ban notification not queued', {
        userId: user.id,
        reason: (error as Error).message,
      });
    }
  }
}
