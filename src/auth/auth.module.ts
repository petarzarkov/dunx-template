import { AuthModule, redisStorage } from '@dunx/auth';
import { drizzleDatabase } from '@dunx/auth/drizzle';
import { Logger, Module } from '@dunx/core';
import { DbConnection } from '@dunx/infra/db';
import { JobPublisher } from '@dunx/infra/queue';
import { RedisConnection } from '@dunx/infra/redis';
import { AppConfigService } from '../config/app.config.service.js';
import { AuthSessionStore } from '../config/dto/auth-vars.dto.js';
import { users } from '../users/schema/user.schema.js';
import { accounts } from './schema/account.schema.js';
import { sessions } from './schema/session.schema.js';
import { verifications } from './schema/verification.schema.js';
import { AuditModule } from '../audit/audit.module.js';
import { registrationHooks } from './auth.hooks.js';
import { AUTH_MOUNT, baseAuthOptions } from './auth.options.js';
import { ProfileController } from './profile.controller.js';
import { AuthAdminSeeder } from './services/auth-admin.seeder.js';
import { CurrentUser } from './services/current-user.service.js';

/**
 * `forRootAsync` because the secret, the base URL and the database all come out
 * of the container: the config is validated there and the drizzle handle is the
 * one `DatabaseModule` already opened, so better-auth adds no second connection
 * and the app still closes exactly once.
 *
 * The second, **synchronous** argument is the mount. Under
 * `setGlobalPrefix('api')` the handler is a route at `/auth` while better-auth
 * matches `/api/auth`, so the two are different strings for one URL and the
 * route table is built before any factory has run.
 *
 * Hoisted to a `const` so the same reference is both imported and re-exported. A
 * scope is keyed on the module reference, so a second `forRootAsync(...)` call in
 * `exports` would name a module that is not in the graph.
 */
const auth = AuthModule.forRootAsync(
  {
    useFactory: (
      config: AppConfigService,
      connection: DbConnection,
      redis: RedisConnection,
      publisher: JobPublisher,
      logger: Logger,
    ) => {
      const base = baseAuthOptions(config.values);
      const redisSessions =
        config.get('auth').sessionStore === AuthSessionStore.REDIS;

      return {
        ...base,
        // The mapping is not optional here, despite `drizzleDatabase`'s
        // documentation saying "the better-auth tables being in the app's
        // schema object is the whole requirement". The adapter looks the
        // model up as `fullSchema['user']`, which is the **export name**
        // in the schema barrel, not the SQL table name - and this app
        // exports `users`, plural, like every other table it has. Without
        // the mapping the first query is:
        //
        //   BetterAuthError: [# Drizzle Adapter]: The model "user" was
        //   not found in the schema object.
        database: drizzleDatabase(connection, {
          schema: {
            user: users,
            session: sessions,
            account: accounts,
            verification: verifications,
          },
        }),
        // Every path into the user table, not just the ones this app
        // calls - which is why this is a hook and not a call site.
        databaseHooks: registrationHooks(publisher, logger),
        // An explicit opt-in, never a side effect of `REDIS_URL` being
        // set. `redisStorage` deliberately does not soften a connection
        // failure - a swallowed `null` from `get` would read as "no
        // session" and sign every user out - so this is the one area that
        // does *not* degrade, and choosing it is choosing to have Redis
        // up. The default keeps sessions in the database, which is why a
        // clean checkout can sign in with nothing running.
        ...(redisSessions ? { secondaryStorage: redisStorage(redis) } : {}),
      };
    },
    inject: [
      AppConfigService,
      DbConnection,
      RedisConnection,
      JobPublisher,
      Logger,
    ] as const,
  },
  AUTH_MOUNT,
);

/**
 * Named for the feature rather than the package, so `AuthModule` still means
 * `@dunx/auth`'s.
 *
 * **A decorated class rather than a `forRoot()` that took no arguments.** Under
 * module scoping the identity of a module reference is what a scope is keyed on, and
 * `forRoot()` returns a new object per call - so `UsersModule` importing
 * `AccountsModule.forRoot()` would have built a *second* better-auth, against a
 * second session store. A class is one reference however many modules import it,
 * which is the only shape that composes.
 *
 * `AuditModule` is imported for `ProfileController`, which records a profile edit.
 */
@Module({
  imports: [AuditModule, auth],
  controllers: [ProfileController],
  providers: [CurrentUser, AuthAdminSeeder],
  /**
   * `AuthModule` re-exported by reference, so an importer sees `Auth`,
   * `AuthContext` and `SessionGuard` without naming any of them. `CurrentUser` is
   * this module's own read of that context and is what every feature actually
   * injects.
   *
   * `AuthAdminSeeder` is not exported. It runs once at boot and has no caller.
   */
  exports: [auth, CurrentUser],
})
export class AccountsModule {}
