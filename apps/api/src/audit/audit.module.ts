import { Global, Module } from '@nestjs/common'
import { AuditLogService } from './audit.service'

@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
