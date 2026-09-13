import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

/**
 * The audit trail is the most fragile thing in this app and the only one with no
 * in-process test worth having.
 *
 * It is two mechanisms that have to agree at runtime and cannot be checked at
 * compile time: SQLite triggers write the rows, and `AuditContextMiddleware`
 * stamps the actor through an `AsyncLocalStorage` that the trigger reads back
 * out of a connection variable. `app.module.ts` carries a long comment arguing
 * that middleware has to be global, and that argument is only correct if the
 * trigger and the stamp really do line up - which is what this suite checks,
 * against a server in another process, over real HTTP.
 *
 * The NestJS template had this suite. The port dropped it.
 */
interface AuditEntry {
  id: string;
  actorId: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  entityName: string;
  entityId: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
}

interface Page<T> {
  data: T[];
  meta: {
    take: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    nextCursor: string | null;
    /** `previousCursor`, not `prevCursor`. The short spelling silently yields
     * `undefined`, which reaches the server as the literal string and is a 400. */
    previousCursor: string | null;
  };
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  banned: boolean;
}

const makeUser = async (): Promise<User> => {
  const { api } = getTestContext();
  const created = await api.post<User>('users', {
    email: `audit-${crypto.randomUUID()}@example.com`,
    name: 'Audit Subject',
    password: 'Audit-password-1!',
  });
  expect(created.status).toBe(201);
  return created.body;
};

/** Triggers fire inside the write, but the read is a separate connection. */
const entriesFor = async (entityId: string): Promise<AuditEntry[]> => {
  const { api } = getTestContext();
  const { body } = await api.json<Page<AuditEntry>>(
    `audit-logs?entityId=${entityId}&take=50`,
  );
  return body.data;
};

describe('the audit trail, written by SQLite triggers', () => {
  test('an anonymous caller cannot read it', async () => {
    const { api } = getTestContext();
    const { status } = await api.as(undefined).json('audit-logs');
    expect(status).toBe(401);
  });

  /**
   * The whole contract in one test: the row exists because a trigger wrote it,
   * and it names the caller because the middleware stamped the connection before
   * the statement ran.
   */
  test('a create is recorded as INSERT and attributed to the session', async () => {
    const { adminId } = getTestContext();
    const user = await makeUser();

    const entries = await entriesFor(user.id);
    const insert = entries.find((entry) => entry.action === 'INSERT');

    expect(insert).toBeDefined();
    // `AUDITED_TABLES` names the entity `User`, which is not the table name.
    expect(insert?.entityName).toBe('User');
    expect(insert?.actorId).toBe(adminId);
    expect(insert?.oldValues).toBeNull();
    expect(insert?.newValues).toMatchObject({ email: user.email });
  });

  test('a ban is recorded as UPDATE with both snapshots', async () => {
    const { api } = getTestContext();
    const user = await makeUser();

    const banned = await api.post<User>(`users/${user.id}/ban`, {});
    expect(banned.status).toBe(200);

    const update = (await entriesFor(user.id)).find(
      (entry) => entry.action === 'UPDATE',
    );
    expect(update).toBeDefined();
    // Both sides, which is what makes the trail a history rather than a log of
    // things having changed. `banned` is a JSON boolean rather than SQLite's
    // 0/1, because the trigger's snapshot coerces it with `json(iif(...))`.
    expect(update?.oldValues).toMatchObject({ banned: false });
    expect(update?.newValues).toMatchObject({ banned: true });
  });

  test('a delete is recorded as DELETE, after the row is gone', async () => {
    const { api } = getTestContext();
    const user = await makeUser();

    const removed = await api.json(`users/${user.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);

    const entries = await entriesFor(user.id);
    expect(entries.some((entry) => entry.action === 'DELETE')).toBe(true);
    // The audit row outlives its subject, which is the point of recording it.
    expect((await api.json(`users/${user.id}`)).status).toBe(404);
  });

  describe('filters', () => {
    test('by action', async () => {
      const { api } = getTestContext();
      await makeUser();

      const { body } = await api.json<Page<AuditEntry>>(
        'audit-logs?action=INSERT&take=10',
      );
      expect(body.data.length).toBeGreaterThan(0);
      for (const entry of body.data) expect(entry.action).toBe('INSERT');
    });

    test('by entityName', async () => {
      const { api } = getTestContext();
      const { body } = await api.json<Page<AuditEntry>>(
        'audit-logs?entityName=User&take=10',
      );
      expect(body.data.length).toBeGreaterThan(0);
      for (const entry of body.data) expect(entry.entityName).toBe('User');
    });

    test('by actorId', async () => {
      const { api, adminId } = getTestContext();
      await makeUser();

      const { body } = await api.json<Page<AuditEntry>>(
        `audit-logs?actorId=${adminId}&take=10`,
      );
      expect(body.data.length).toBeGreaterThan(0);
      for (const entry of body.data) expect(entry.actorId).toBe(adminId);
    });

    test('an unknown actor matches nothing rather than everything', async () => {
      const { api } = getTestContext();
      const { body } = await api.json<Page<AuditEntry>>(
        `audit-logs?actorId=${crypto.randomUUID()}`,
      );
      expect(body.data).toHaveLength(0);
    });
  });

  /**
   * Keyset pagination is now `@dunx/infra/pagination` rather than this app's own
   * code, and the framework's version fixed three things on the way in. These
   * assert the behaviour this app depends on, over a table that is being written
   * to by the tests above.
   */
  describe('cursor pagination', () => {
    test('walks forward without repeating a row', async () => {
      const { api } = getTestContext();
      for (let i = 0; i < 3; i++) await makeUser();

      const first = await api.json<Page<AuditEntry>>('audit-logs?take=2');
      expect(first.body.data).toHaveLength(2);
      expect(first.body.meta.nextCursor).not.toBeNull();

      const second = await api.json<Page<AuditEntry>>(
        `audit-logs?take=2&cursor=${encodeURIComponent(first.body.meta.nextCursor ?? '')}`,
      );
      expect(second.body.data.length).toBeGreaterThan(0);

      const seen = new Set(first.body.data.map((entry) => entry.id));
      for (const entry of second.body.data)
        expect(seen.has(entry.id)).toBe(false);
    });

    test('walks back to where it started', async () => {
      const { api } = getTestContext();
      const first = await api.json<Page<AuditEntry>>('audit-logs?take=2');
      const second = await api.json<Page<AuditEntry>>(
        `audit-logs?take=2&cursor=${encodeURIComponent(first.body.meta.nextCursor ?? '')}`,
      );

      /**
       * A cursor is minted only when there is a page in that direction, so a
       * null `prevCursor` is the correct answer rather than a failure - and
       * asserting it that way is the point, since a cursor that always existed
       * is exactly the bug the framework's version fixed.
       */
      const cursor = second.body.meta.previousCursor;
      expect(cursor).not.toBeNull();

      const back = await api.json<Page<AuditEntry>>(
        `audit-logs?take=2&direction=backward&cursor=${encodeURIComponent(cursor ?? '')}`,
      );
      expect(back.status).toBe(200);
      expect(back.body.data.map((entry) => entry.id)).toEqual(
        first.body.data.map((entry) => entry.id),
      );
    });

    test('a malformed cursor is a 400, not an empty page', async () => {
      const { api } = getTestContext();
      const { status } = await api.json('audit-logs?cursor=not-a-real-cursor');
      expect(status).toBe(400);
    });

    /**
     * A `nextCursor` on the last page reads as "there is more" to any client
     * checking for null, which is one of the things the framework's version
     * fixed. `take` above the row count is the only reliable way to be on it.
     */
    test('the last page mints no forward cursor', async () => {
      const { api } = getTestContext();
      const { body } = await api.json<Page<AuditEntry>>('audit-logs?take=50');
      if (body.data.length < 50) expect(body.meta.nextCursor).toBeNull();
    });
  });
});
