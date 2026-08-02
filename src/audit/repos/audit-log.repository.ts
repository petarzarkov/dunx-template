import { and, eq, type SQL } from 'drizzle-orm';
import { SyncDatabase } from '@dunx/infra/db';
import { PaginationFactory } from '../../core/pagination/pagination.factory.js';
import type {
  Page,
  PageOptions,
} from '../../core/pagination/page-options.dto.js';
import * as schema from '../../infra/db/schema.js';
import {
  auditLog,
  type AuditAction,
  type AuditLogRow,
} from '../schema/audit-log.schema.js';

export interface AuditFilters extends PageOptions {
  readonly actorId?: string | undefined;
  readonly action?: AuditAction | undefined;
  readonly entityName?: string | undefined;
  readonly entityId?: string | undefined;
}

export class AuditLogRepository {
  constructor(
    private readonly db: SyncDatabase<typeof schema>,
    private readonly pagination: PaginationFactory,
  ) {}

  list(filters: AuditFilters): Page<AuditLogRow> {
    const clauses: SQL[] = [];
    if (filters.actorId !== undefined) {
      clauses.push(eq(auditLog.actorId, filters.actorId));
    }
    if (filters.action !== undefined) {
      clauses.push(eq(auditLog.action, filters.action));
    }
    if (filters.entityName !== undefined) {
      clauses.push(eq(auditLog.entityName, filters.entityName));
    }
    if (filters.entityId !== undefined) {
      clauses.push(eq(auditLog.entityId, filters.entityId));
    }

    return this.pagination.paginate<typeof auditLog, AuditLogRow>({
      table: auditLog,
      id: auditLog.id,
      sort: auditLog.createdAt,
      sortKey: 'createdAt',
      options: filters,
      where: clauses.length === 0 ? undefined : and(...clauses),
    });
  }
}
