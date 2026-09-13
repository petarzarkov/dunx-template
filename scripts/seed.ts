import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runSeeds, SyncSqliteOptions } from '@dunx/infra/db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { MIGRATIONS_FOLDER } from '../src/infra/db/database.module.js';
import * as schema from '../src/infra/db/schema.js';
import { applyAuditTriggers } from '../src/infra/db/triggers.js';

const filename = Bun.env['SQLITE_DB_PATH'] ?? './data/app.db';
if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

const connection = new SyncSqliteOptions({
  schema,
  filename,
  pragmas: ['journal_mode = WAL', 'foreign_keys = ON'],
}).openSync();

migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
applyAuditTriggers(connection.raw);

const report = await runSeeds(connection.db, {
  dir: join(import.meta.dir, '..', 'src', 'infra', 'db', 'seeds'),
  env: Bun.env['NODE_ENV'] ?? 'development',
});

connection.closeSync();

console.log(
  JSON.stringify(
    {
      applied: report.applied,
      journaled: report.journaled,
      skipped: report.skipped,
    },
    null,
    2,
  ),
);
