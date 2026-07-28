import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { ReimportService } from './reimport/reimport.service'
import { TemplatesAdminController } from './templates/templates.controller'
import { TemplatesAdminService } from './templates/templates.service'

@Module({
  controllers: [AdminController, TemplatesAdminController],
  providers: [AdminService, ReimportService, TemplatesAdminService],
})
export class AdminModule {}
