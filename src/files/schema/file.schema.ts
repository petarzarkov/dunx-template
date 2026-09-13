import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { createdAt, updatedAt, uuidPk } from '../../infra/db/columns.js';
import { users } from '../../users/schema/user.schema.js';

/**
 * The metadata row for an uploaded object. The bytes live in `Storage` - a
 * directory under `LocalStorage` or a bucket under `S3Storage` - and `key` is the
 * one thing that ties the two together.
 *
 * `width`/`height` are filled by `@dunx/infra/images` on upload when the bytes
 * decode as an image, and `thumbnailKey` by the `media` queue's job once a worker
 * has rendered one. Both are nullable because both are best-effort.
 */
export const files = sqliteTable(
  'file',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    thumbnailKey: text('thumbnail_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('UQ_file_key').on(table.key),
    index('file_user_id_index').on(table.userId),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;
