import { Injectable, Logger } from '@nestjs/common';

/** Records who did what from the dashboard. Goes through the Nest logger, so it also lands in `/admin/logs`. */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger('AdminAudit');

  record(adminEmail: string, action: string, target: string): void {
    this.logger.log(`${adminEmail} ${action} ${target}`);
  }
}
