import { integer, text } from 'drizzle-orm/sqlite-core';

/**
 * Column names are spelled out rather than derived. drizzle's `casing:
 * 'snake_case'` is set on the `drizzle()` call, and `@dunx/infra`'s
 * `SqliteOptions` forwards only `schema` to it, so the convention is
 * unreachable from inside the container. Explicit names are what keep the
 * runtime handle and the drizzle-kit output agreeing.
 */
export const uuidPk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const timestampMs = (name: string) =>
  integer(name, { mode: 'timestamp_ms' });

export const createdAt = () =>
  timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  timestampMs('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());
