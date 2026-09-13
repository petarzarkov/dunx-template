import { and, eq, like, or, type SQL } from 'drizzle-orm';
import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import * as schema from '../../infra/db/schema.js';
import {
  users,
  type NewUserRow,
  type UserRole,
  type UserRow,
} from '../schema/user.schema.js';

export interface ListUsersFilters extends PageOptions {
  readonly role?: UserRole | undefined;
  readonly banned?: boolean | undefined;
}

/**
 * Every method is synchronous, `list` included. The handle is `SyncDatabase`,
 * which `SyncSqliteOptions` binds, so `bun:sqlite` returns rows rather than
 * promises.
 *
 * `paginate` picks its return type off the driver by overload rather than a
 * flag: a builder answering `all(): unknown[]` gets a `Page`, a thenable one
 * gets a `Promise<Page>`. So the keyset query lives in the framework and serves
 * `Bun.SQL` too, without putting an `async` on a repository that has no reason
 * for one.
 */
export class UsersRepository {
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  findById(id: string): UserRow | undefined {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }

  findByEmail(email: string): UserRow | undefined {
    return this.db.select().from(users).where(eq(users.email, email)).get();
  }

  create(values: NewUserRow): UserRow {
    return this.db.insert(users).values(values).returning().get();
  }

  /**
   * `exactOptionalPropertyTypes` separates an absent key from an explicit
   * `undefined`, and a patch DTO produces the latter, so the value type has to
   * admit it.
   */
  update(
    id: string,
    values: { [K in keyof NewUserRow]?: NewUserRow[K] | undefined },
  ): UserRow | undefined {
    return this.db
      .update(users)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning()
      .get();
  }

  deleteById(id: string): boolean {
    return (
      this.db.delete(users).where(eq(users.id, id)).returning().all().length > 0
    );
  }

  list(filters: ListUsersFilters): Page<UserRow> {
    const clauses: SQL[] = [];
    if (filters.role !== undefined) clauses.push(eq(users.role, filters.role));
    if (filters.banned !== undefined) {
      clauses.push(eq(users.banned, filters.banned));
    }
    if (filters.search !== undefined) {
      const term = `%${filters.search}%`;
      const search = or(like(users.email, term), like(users.name, term));
      if (search !== undefined) clauses.push(search);
    }

    return paginate<typeof users, UserRow>({
      db: this.db,
      table: users,
      options: filters,
      // Stated, not inferred. `paginate` defaults to the first of `updatedAt`,
      // `createdAt`, `id` the table has, and this table has `updatedAt` - so
      // leaving it out would silently re-sort the list by last modification.
      orderBy: 'createdAt',
      where: clauses.length === 0 ? undefined : and(...clauses),
    });
  }
}
