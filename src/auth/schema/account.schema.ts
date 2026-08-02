import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  createdAt,
  timestampMs,
  updatedAt,
  uuidPk,
} from '../../infra/db/columns.js';
import { users } from '../../users/schema/user.schema.js';

/**
 * Better Auth's `account` model: one row per credential or social identity.
 *
 * `password` holds the hash, produced by `bunPassword` - `Bun.password`'s native
 * bcrypt rather than better-auth's pure-JavaScript scrypt default. `providerId`
 * is `credential` for email and password, or the provider's id for a social one.
 */
export const accounts = sqliteTable(
  'account',
  {
    id: uuidPk(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestampMs('access_token_expires_at'),
    refreshTokenExpiresAt: timestampMs('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('account_user_id_index').on(table.userId),
    index('account_provider_id_index').on(table.providerId),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
