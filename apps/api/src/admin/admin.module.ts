import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { ReimportService } from './reimport/reimport.service'

@Module({
  controllers: [AdminController],
  providers: [AdminService, ReimportService],
})
export class AdminModule {}
