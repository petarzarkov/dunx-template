import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  createdAt,
  timestampMs,
  updatedAt,
  uuidPk,
} from '../../../infra/db/columns.js';
import { UserRole } from '../../schema/user.schema.js';

/**
 * A frozen object rather than a TypeScript `enum`, matching `UserRole`. An
 * `enum` is a runtime construct the emit has to synthesise, and the union of a
 * frozen object is the same type with none of that.
 */
export const InviteStatus = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
} as const);
export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];

/**
 * An invitation to create an account, which is the one way into this app that
 * is neither an open sign-up nor an admin creating the row directly.
 *
 * The code is the credential. It is unique and unguessable, so the accept route
 * can be public: knowing the code is the proof.
 *
 * `email` is unique too, which is what makes a second invite to the same
 * address reuse the row rather than leave two live codes for one mailbox.
 */
export const invites = sqliteTable(
  'invite',
  {
    id: uuidPk(),
    email: text('email').notNull(),
    inviteCode: text('invite_code').notNull(),
    role: text('role').$type<UserRole>().notNull().default(UserRole.USER),
    status: text('status')
      .$type<InviteStatus>()
      .notNull()
      .default(InviteStatus.PENDING),
    expiresAt: timestampMs('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('UQ_invite_email').on(table.email),
    uniqueIndex('UQ_invite_invite_code').on(table.inviteCode),
  ],
);

export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;
