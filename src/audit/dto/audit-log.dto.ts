import type { RouteSchemas } from '@dunx/http';
import { z } from 'zod';
import {
  pageOf,
  pageOptionsSchema,
} from '../../core/pagination/page-options.dto.js';
import { AuditAction } from '../schema/audit-log.schema.js';

export const AuditLogEntry = z
  .object({
    id: z.uuid(),
    actorId: z.string().nullable(),
    action: z.enum([
      AuditAction.INSERT,
      AuditAction.UPDATE,
      AuditAction.DELETE,
    ]),
    entityName: z.string(),
    entityId: z.string(),
    oldValues: z.record(z.string(), z.unknown()).nullable(),
    newValues: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({
    id: 'AuditLogEntry',
    title: 'One row written by a database trigger',
  });

export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

export const PaginatedAuditLog = pageOf(AuditLogEntry, 'PaginatedAuditLog');

export const ListAuditQuery = pageOptionsSchema.extend({
  actorId: z.string().optional(),
  action: z
    .enum([AuditAction.INSERT, AuditAction.UPDATE, AuditAction.DELETE])
    .optional(),
  entityName: z.string().optional(),
  entityId: z.string().optional(),
});

export const listAudit = {
  query: ListAuditQuery,
} as const satisfies RouteSchemas;
