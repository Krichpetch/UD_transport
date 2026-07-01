import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { StationsModule } from './stations/stations.module'
import { ChecklistsModule } from './checklists/checklists.module'
import { AuditModule } from './audit/audit.module'
import { MinioModule } from './minio/minio.module'
import { UploadsModule } from './uploads/uploads.module'
import { UserAwareThrottlerGuard } from './common/throttler.guard'

@Module({
  imports: [
    // 200 requests per 60s per user-ID (or IP for unauthenticated).
    // Login endpoint overrides this with a stricter 5/60s limit.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }]),
    PrismaModule,
    AuthModule,
    StationsModule,
    ChecklistsModule,
    AuditModule,
    MinioModule,
    UploadsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: UserAwareThrottlerGuard }],
})
export class AppModule {}
