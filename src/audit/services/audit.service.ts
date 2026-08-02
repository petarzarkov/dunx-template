import type { Page } from '../../core/pagination/page-options.dto.js';
import type { AuditLogEntry } from '../dto/audit-log.dto.js';
import type { AuditLogRow } from '../schema/audit-log.schema.js';
import {
  AuditLogRepository,
  type AuditFilters,
} from '../repos/audit-log.repository.js';

const present = (row: AuditLogRow): AuditLogEntry => ({
  id: row.id,
  actorId: row.actorId,
  action: row.action,
  entityName: row.entityName,
  entityId: row.entityId,
  oldValues: row.oldValues,
  newValues: row.newValues,
  createdAt: row.createdAt.toISOString(),
});

export class AuditService {
  constructor(private readonly repo: AuditLogRepository) {}

  list(filters: AuditFilters): Page<AuditLogEntry> {
    const page = this.repo.list(filters);
    return { data: page.data.map(present), meta: page.meta };
  }
}
