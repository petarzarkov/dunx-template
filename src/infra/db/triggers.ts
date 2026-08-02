import type { Database as BunSqlite } from 'bun:sqlite';

interface AuditedTable {
  readonly table: string;
  readonly entity: string;
  /** Columns snapshotted into `old_values` / `new_values`. */
  readonly columns: readonly string[];
}

export const AUDITED_TABLES: readonly AuditedTable[] = [
  {
    table: 'user',
    entity: 'User',
    columns: ['email', 'name', 'role', 'banned'],
  },
];

const uuidExpression = `
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
`;

/** `banned` is stored as 0/1; json_object would emit a number, so coerce it. */
const snapshot = (alias: string, columns: readonly string[]): string => {
  const pairs = columns.map((column) =>
    column === 'banned'
      ? `'${column}', json(iif(${alias}.${column}, 'true', 'false'))`
      : `'${column}', ${alias}.${column}`,
  );
  return `json_object(${pairs.join(', ')})`;
};

/**
 * Audit rows are written by SQLite itself, not by application code, so a write
 * that bypasses the repository is still recorded. The actor comes from a
 * single-row context table that `AuditContextMiddleware` stamps per request.
 *
 * Idempotent: every statement is `IF NOT EXISTS`, so this may run on every boot.
 */
export const applyAuditTriggers = (sqlite: BunSqlite): void => {
  // One DDL statement per run(): prepare() compiles the first and drops the rest.
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS _audit_ctx (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      actor_id TEXT
    )
  `);
  sqlite.run(
    `INSERT OR IGNORE INTO _audit_ctx (id, actor_id) VALUES (1, NULL)`,
  );

  for (const { table, entity, columns } of AUDITED_TABLES) {
    const actor = `(SELECT actor_id FROM _audit_ctx WHERE id = 1)`;

    sqlite.run(`
      CREATE TRIGGER IF NOT EXISTS audit_${table}_insert
      AFTER INSERT ON "${table}"
      BEGIN
        INSERT INTO audit_log (id, actor_id, action, entity_name, entity_id, old_values, new_values, created_at)
        VALUES (${uuidExpression}, ${actor}, 'INSERT', '${entity}', NEW.id, NULL, ${snapshot('NEW', columns)}, unixepoch('subsec') * 1000);
      END
    `);

    sqlite.run(`
      CREATE TRIGGER IF NOT EXISTS audit_${table}_update
      AFTER UPDATE ON "${table}"
      BEGIN
        INSERT INTO audit_log (id, actor_id, action, entity_name, entity_id, old_values, new_values, created_at)
        VALUES (${uuidExpression}, ${actor}, 'UPDATE', '${entity}', NEW.id, ${snapshot('OLD', columns)}, ${snapshot('NEW', columns)}, unixepoch('subsec') * 1000);
      END
    `);

    sqlite.run(`
      CREATE TRIGGER IF NOT EXISTS audit_${table}_delete
      AFTER DELETE ON "${table}"
      BEGIN
        INSERT INTO audit_log (id, actor_id, action, entity_name, entity_id, old_values, new_values, created_at)
        VALUES (${uuidExpression}, ${actor}, 'DELETE', '${entity}', OLD.id, ${snapshot('OLD', columns)}, NULL, unixepoch('subsec') * 1000);
      END
    `);
  }
};

export const setAuditActor = (
  sqlite: BunSqlite,
  actorId: string | null,
): void => {
  sqlite.run(`UPDATE _audit_ctx SET actor_id = ? WHERE id = 1`, [actorId]);
};
