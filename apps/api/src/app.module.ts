import { Module } from '@nestjs/common'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { StationsModule } from './stations/stations.module'
import { ChecklistsModule } from './checklists/checklists.module'

@Module({
  imports: [PrismaModule, AuthModule, StationsModule, ChecklistsModule],
})
export class AppModule {}
