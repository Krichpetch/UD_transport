import { Module } from '@nestjs/common'
import { ChecklistsController, MyChecklistsController } from './checklists.controller'
import { ChecklistsService } from './checklists.service'
import { StationsModule } from '../stations/stations.module'

@Module({
  imports: [StationsModule],
  controllers: [ChecklistsController, MyChecklistsController],
  providers: [ChecklistsService],
})
export class ChecklistsModule {}
