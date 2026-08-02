import { Module } from '@dunx/core';
import { AuditController } from './audit.controller.js';
import { AuditLogRepository } from './repos/audit-log.repository.js';
import { AuditService } from './services/audit.service.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditLogRepository],
})
export class AuditModule {}
