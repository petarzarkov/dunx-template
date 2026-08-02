import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { createdAt, updatedAt, uuidPk } from '../../infra/db/columns.js';

export const UserRole = Object.freeze({
  ADMIN: 'admin',
  USER: 'user',
} as const);
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const users = sqliteTable(
  'user',
  {
    id: uuidPk(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: [UserRole.ADMIN, UserRole.USER] })
      .notNull()
      .default(UserRole.USER),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('UQ_user_email').on(table.email)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
