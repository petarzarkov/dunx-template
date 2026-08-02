import { Database } from 'bun:sqlite';

/**
 * Opens the same SQLite file the app under test opened. WAL is on, so a second
 * reader is fine while the server holds the writer.
 */
export class DbClient {
  readonly #db: Database;

  constructor(path: string) {
    this.#db = new Database(path, { strict: true });
  }

  ensureAdmin(email: string): string {
    this.#db.run('DELETE FROM user WHERE email = ?', [email]);
    const id = crypto.randomUUID();
    const now = Date.now();
    this.#db.run(
      'INSERT INTO user (id, email, name, role, banned, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [id, email, 'E2E Admin', 'admin', now, now],
    );
    return id;
  }

  countAuditRows(entityId: string): number {
    const row = this.#db
      .query('SELECT count(*) AS n FROM audit_log WHERE entity_id = ?')
      .get(entityId) as { n: number } | null;
    return row?.n ?? 0;
  }

  close(): void {
    this.#db.close();
  }
}
