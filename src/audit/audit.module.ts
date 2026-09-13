import { Module } from '@dunx/core';
import { AuditController } from './audit.controller.js';
import { AuditLogRepository } from './repos/audit-log.repository.js';
import { AuditService } from './services/audit.service.js';

/**
 * `AuditLogRepository` is not exported: the audit trail is read through
 * `AuditService`, and a caller reaching past it into the table is what the trail
 * exists to record. The drizzle handle it injects comes from `DatabaseModule`,
 * which is global, so there is nothing to import.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditLogRepository],
  exports: [AuditService],
})
export class AuditModule {}
