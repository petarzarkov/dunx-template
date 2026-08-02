/**
 * Applies the drizzle-kit migrations without booting the app.
 *
 * The app applies them itself on every boot (`DatabaseBootstrap`), which is what
 * makes a fresh container work with no init step. This exists for the case where
 * you want to migrate a database the app is not about to open.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SyncSqliteOptions } from '@dunx/infra/db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { MIGRATIONS_FOLDER } from '../src/infra/db/database.module.js';
import * as schema from '../src/infra/db/schema.js';
import { applyAuditTriggers } from '../src/infra/db/triggers.js';

const filename = Bun.env['SQLITE_DB_PATH'] ?? './data/app.db';
if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

// `openSync()` is the synchronous mode's own escape hatch: no container, no
// await, and the connection is a real one rather than a fixture.
const connection = new SyncSqliteOptions({
  schema,
  filename,
  pragmas: ['journal_mode = WAL', 'foreign_keys = ON'],
}).openSync();

migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
applyAuditTriggers(connection.raw);
connection.closeSync();

console.log(`migrated ${filename}`);
