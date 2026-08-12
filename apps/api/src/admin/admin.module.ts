import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { ReimportService } from './reimport/reimport.service'
import { TemplatesAdminController } from './templates/templates.controller'
import { TemplatesAdminService } from './templates/templates.service'
import { FacilityGroupsController } from './templates/facility-groups.controller'
import { FacilityGroupsService } from './templates/facility-groups.service'
import { MasterCriteriaController } from './templates/master-criteria.controller'
import { MasterCriteriaService } from './templates/master-criteria.service'

@Module({
  controllers: [AdminController, TemplatesAdminController, FacilityGroupsController, MasterCriteriaController],
  providers: [AdminService, ReimportService, TemplatesAdminService, FacilityGroupsService, MasterCriteriaService],
})
export class AdminModule {}
