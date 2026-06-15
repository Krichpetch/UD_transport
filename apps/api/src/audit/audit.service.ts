import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    userId: string
    action: string
    entityType: string
    entityId: string
    before?: unknown
    after?: unknown
    ipAddress?: string
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        ipAddress: params.ipAddress,
        before: params.before !== undefined ? (params.before as Prisma.InputJsonValue) : undefined,
        after: params.after !== undefined ? (params.after as Prisma.InputJsonValue) : undefined,
      },
    })
  }
}
