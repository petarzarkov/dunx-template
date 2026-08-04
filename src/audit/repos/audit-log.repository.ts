import { and, eq, type SQL } from 'drizzle-orm';
import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
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
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  list(filters: AuditFilters): Promise<Page<AuditLogRow>> {
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

    return paginate<typeof auditLog, AuditLogRow>({
      db: this.db,
      table: auditLog,
      options: filters,
      orderBy: 'createdAt',
      where: clauses.length === 0 ? undefined : and(...clauses),
    });
  }
}
