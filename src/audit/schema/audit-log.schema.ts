import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, uuidPk } from '../../infra/db/columns.js';

export const AuditAction = Object.freeze({
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
} as const);
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: uuidPk(),
    actorId: text('actor_id'),
    action: text('action', {
      enum: [AuditAction.INSERT, AuditAction.UPDATE, AuditAction.DELETE],
    }).notNull(),
    entityName: text('entity_name').notNull(),
    entityId: text('entity_id').notNull(),
    oldValues: text('old_values', { mode: 'json' }).$type<Record<
      string,
      unknown
    > | null>(),
    newValues: text('new_values', { mode: 'json' }).$type<Record<
      string,
      unknown
    > | null>(),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_actor_id_index').on(table.actorId),
    index('audit_action_index').on(table.action),
    index('audit_entity_name_index').on(table.entityName),
    index('audit_entity_id_index').on(table.entityId),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
