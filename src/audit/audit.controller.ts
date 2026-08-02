import { Controller, Get, Roles, type Input } from '@dunx/http';
import { ApiDoc } from '@dunx/openapi';
import type { Page } from '../core/pagination/page-options.dto.js';
import { UserRole } from '../users/schema/user.schema.js';
import { listAudit, type AuditLogEntry } from './dto/audit-log.dto.js';
import { AuditService } from './services/audit.service.js';

@ApiDoc({
  tags: ['audit'],
  description:
    'Read side of the audit trail. Rows are written by SQLite triggers, never by application code.',
})
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @ApiDoc({ tags: ['audit'], summary: 'List audit entries, keyset paginated' })
  @Roles(UserRole.ADMIN)
  @Get('/', listAudit)
  list(input: Input<typeof listAudit>): Page<AuditLogEntry> {
    return this.audit.list(input.query);
  }
}
