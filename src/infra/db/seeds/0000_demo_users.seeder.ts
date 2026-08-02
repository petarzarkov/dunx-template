import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { users } from '../../../users/schema/user.schema.js';
import * as schema from '../schema.js';

/**
 * `runSeeds` runs each file once, in numeric-prefix order, journaling it in
 * `dunx_seeds`. The seed and its journal row go in one transaction, so a throw
 * leaves neither.
 *
 * `when` is the environment gate. A seed refused by its own predicate is not
 * journaled, so it still runs the first time it is invoked somewhere it belongs.
 *
 * **These users cannot sign in, on purpose.** A row inserted here has no `account`
 * row and therefore no password hash - it is a directory entry, useful for paging
 * and audit demos and nothing else. The first administrator is created through
 * better-auth by `AuthAdminSeeder`, which is the only path that produces a
 * credential.
 */
export const when = (env: string): boolean => env !== 'production';

export function seed(db: BunSQLiteDatabase<typeof schema>): void {
  db.insert(users)
    .values([
      { email: 'ada@example.com', name: 'Ada Lovelace' },
      { email: 'grace@example.com', name: 'Grace Hopper' },
    ])
    .onConflictDoNothing()
    .run();
}
