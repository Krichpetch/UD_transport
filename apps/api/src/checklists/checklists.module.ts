import { Module } from '@nestjs/common'
import { ChecklistsController } from './checklists.controller'
import { ChecklistsService } from './checklists.service'
import { StationsModule } from '../stations/stations.module'

@Module({
  imports: [StationsModule],
  controllers: [ChecklistsController],
  providers: [ChecklistsService],
})
export class ChecklistsModule {}
