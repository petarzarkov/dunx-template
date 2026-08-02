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

export class DatabaseModule {
  static forRoot(): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        DbModule.forRootAsync(SyncDatabase, {
          useFactory: (config: AppConfigService) => {
            const db = config.get('db');
            if (db.type === DbType.POSTGRES) {
              throw new TypeError(
                'DB_TYPE=postgres is not supported by this SQLite-first template: the data layer is synchronous (bun:sqlite). Set DB_TYPE=sqlite.',
              );
            }
            if (db.sqlitePath !== ':memory:') {
              mkdirSync(dirname(db.sqlitePath), { recursive: true });
            }
            return new SyncSqliteOptions({
              schema,
              filename: db.sqlitePath,
              pragmas: ['journal_mode = WAL', 'foreign_keys = ON'],
            });
          },
          inject: [AppConfigService] as const,
        }),
      ],
      providers: [DatabaseBootstrap],
    };
  }
}
