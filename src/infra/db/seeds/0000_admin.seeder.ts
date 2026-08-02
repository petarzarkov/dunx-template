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
 */
export const when = (env: string): boolean => env !== 'production';

export function seed(db: BunSQLiteDatabase<typeof schema>): void {
  db.insert(users)
    .values({
      email: Bun.env['SEED_ADMIN_EMAIL'] ?? 'admin@local.dev',
      name: 'Admin',
      role: 'admin',
    })
    .onConflictDoNothing()
    .run();
}
