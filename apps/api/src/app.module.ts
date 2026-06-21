import { Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { StationsModule } from './stations/stations.module'
import { ChecklistsModule } from './checklists/checklists.module'
import { AuditModule } from './audit/audit.module'
import { MinioModule } from './minio/minio.module'
import { UploadsModule } from './uploads/uploads.module'

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PrismaModule,
    AuthModule,
    StationsModule,
    ChecklistsModule,
    AuditModule,
    MinioModule,
    UploadsModule,
  ],
})
export class AppModule {}
