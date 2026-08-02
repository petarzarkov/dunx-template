import { Logger } from '@dunx/core';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type { Page } from '../../core/pagination/page-options.dto.js';
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
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
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

  create(input: CreateUser): SanitizedUser {
    if (this.repo.findByEmail(input.email) !== undefined) {
      throw new HttpError(
        HttpStatusCode.CONFLICT,
        'A user with that email already exists',
      );
    }
    const row = this.repo.create(input);
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

  setBanned(id: string, banned: boolean): SanitizedUser {
    return this.update(id, { banned });
  }

  remove(id: string): void {
    if (!this.repo.deleteById(id)) {
      throw new HttpError(HttpStatusCode.NOT_FOUND, `No user with id ${id}`);
    }
    this.logger.warn('user deleted', { userId: id });
  }
}
