import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DynamicModule } from '@dunx/core';
import {
  DbConnection,
  DbModule,
  SqliteConnection,
  SyncDatabase,
  SyncSqliteOptions,
} from '@dunx/infra/db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { AppConfigService } from '../../config/app.config.service.js';
import { DbType } from '../../config/dto/db-vars.dto.js';
import * as schema from './schema.js';
import { applyAuditTriggers } from './triggers.js';

export const MIGRATIONS_FOLDER = join(import.meta.dir, 'migrations');

/**
 * Applies the drizzle-kit migrations and the audit triggers, in the constructor,
 * so both are done before anything else in the graph is built. `bun:sqlite` is
 * synchronous, so there is nothing to await and no boot phase to coordinate.
 *
 * dunx settles every async factory before the first constructor runs, which is
 * what makes it safe to assume the connection is already open here.
 */
export class DatabaseBootstrap {
  constructor(
    private readonly connection: DbConnection<SyncDatabase<typeof schema>>,
  ) {
    if (!(this.connection instanceof SqliteConnection)) {
      throw new TypeError(
        'DatabaseBootstrap expects the bun:sqlite backend. Set DB_TYPE=sqlite.',
      );
    }

    migrate(this.connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
    applyAuditTriggers(this.connection.raw);
  }

  /** The raw `bun:sqlite` handle, for the audit-actor stamp and health probes. */
  get raw(): SqliteConnection<
    typeof schema,
    SyncDatabase<typeof schema>
  >['raw'] {
    return (
      this.connection as SqliteConnection<
        typeof schema,
        SyncDatabase<typeof schema>
      >
    ).raw;
  }
}

/**
 * **`global: true`**, like every module under `infra/`. There is exactly one
 * database in this app, `foundation()` builds it once, and auth, users, audit and
 * the health probe all read it - so making each of them import a reference they
 * cannot construct for themselves would be ceremony with no boundary behind it.
 * The private half is still private: `exports` lists the connection and the
 * bootstrap, and nothing else here leaves the module.
 *
 * The alternative is worse than verbose, it is wrong: `DbModule.forRootAsync()`
 * returns a new object per call, so a feature module calling it again would be a
 * second scope with a second SQLite connection.
 */
export class DatabaseModule {
  static forRoot(): DynamicModule {
    const db = DbModule.forRootAsync(SyncDatabase, {
      useFactory: (config: AppConfigService) => {
        const settings = config.get('db');
        if (settings.type === DbType.POSTGRES) {
          throw new TypeError(
            'DB_TYPE=postgres is not supported by this SQLite-first template: the data layer is synchronous (bun:sqlite). Set DB_TYPE=sqlite.',
          );
        }
        if (settings.sqlitePath !== ':memory:') {
          mkdirSync(dirname(settings.sqlitePath), { recursive: true });
        }
        return new SyncSqliteOptions({
          schema,
          filename: settings.sqlitePath,
          pragmas: ['journal_mode = WAL', 'foreign_keys = ON'],
        });
      },
      inject: [AppConfigService] as const,
    });

    return {
      module: DatabaseModule,
      global: true,
      imports: [db],
      providers: [DatabaseBootstrap],
      // The reference, not a token list: re-exporting the module hands on whatever
      // `DbModule` exports - `DbConnection`, the drizzle handle - without this
      // module having to restate a list that is not its own.
      exports: [db, DatabaseBootstrap],
    };
  }
}
