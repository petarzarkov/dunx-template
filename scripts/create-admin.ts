/**
 * Creates an administrator, in any environment.
 *
 * `AuthAdminSeeder` covers development: it runs at `onInit` and refuses outright
 * when `APP_ENV=prod`, because a default administrator with a documented default
 * password is not something a deployment should acquire by booting. That refusal
 * is correct and it leaves a hole - a production deployment has no first admin
 * and no way to make one. This is that way.
 *
 * Through better-auth's own sign-up rather than an insert, for the same reason
 * the seeder is: a row written straight into `user` has no `account` row, so it
 * has no password hash and could never sign in.
 *
 *   bun run create:admin                      # prompts for both
 *   bun run create:admin ada@example.com      # prompts for the password only
 *
 * The password is always prompted for and never taken as an argument, because a
 * shell argument lands in the history file and in `ps` output for every other
 * user on the box. It is **not** masked while typing: `prompt()` echoes, and
 * pretending otherwise would be worse than saying so.
 */
import { betterAuth } from 'better-auth';
import { drizzleDatabase } from '@dunx/auth/drizzle';
import { SyncSqliteOptions } from '@dunx/infra/db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { eq } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { baseAuthOptions } from '../src/auth/auth.options.js';
import { validateConfig } from '../src/config/env.validation.js';
import { MIGRATIONS_FOLDER } from '../src/infra/db/database.module.js';
import * as schema from '../src/infra/db/schema.js';
import { UserRole, users } from '../src/users/schema/user.schema.js';
import { accounts } from '../src/auth/schema/account.schema.js';
import { sessions } from '../src/auth/schema/session.schema.js';
import { verifications } from '../src/auth/schema/verification.schema.js';
import { passwordSchema } from '../src/core/zod/schemas.js';
import { SQLITE_PRAGMAS } from '../src/infra/db/pragmas.js';

const ask = (question: string): string => {
  const answer = prompt(question);
  if (answer === null || answer.trim() === '') {
    console.error('cancelled');
    process.exit(1);
  }
  return answer.trim();
};

const config = validateConfig(Bun.env);
const email = Bun.argv[2] ?? ask('Email:');
const password = ask('Password:');

const valid = passwordSchema.safeParse(password);
if (!valid.success) {
  console.error('That password will not be accepted:');
  for (const issue of valid.error.issues) console.error(`  - ${issue.message}`);
  process.exit(1);
}

const filename = config.db.sqlitePath;
if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

const connection = new SyncSqliteOptions({
  schema,
  filename,
  pragmas: SQLITE_PRAGMAS,
}).openSync();

// The script may be the first thing that ever touches a fresh volume.
migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });

/**
 * No container. `baseAuthOptions` is a pure function of validated config precisely
 * so it can be used outside one, and the only other thing better-auth needs is
 * the database - which is why this does not boot the app to write one row.
 */
const auth = betterAuth({
  ...baseAuthOptions(config),
  database: drizzleDatabase(connection, {
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
});

const existing = connection.db
  .select({ id: users.id, role: users.role })
  .from(users)
  .where(eq(users.email, email))
  .get();

if (existing === undefined) {
  await auth.api.signUpEmail({
    body: { email, password, name: email.split('@')[0] ?? email },
  });
} else if (existing.role === UserRole.ADMIN) {
  console.log(`${email} is already an administrator`);
  connection.closeSync();
  process.exit(0);
} else {
  console.log(`${email} already exists, promoting it`);
}

// Set directly rather than through the `admin()` plugin's `setRole`, which needs
// an authenticated admin session - and the whole point here is that there is
// not one yet.
connection.db
  .update(users)
  .set({ role: UserRole.ADMIN, updatedAt: new Date() })
  .where(eq(users.email, email))
  .run();

connection.closeSync();
console.log(`${email} is an administrator`);
