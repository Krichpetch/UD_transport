import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ChecklistsService {
  constructor(private readonly prisma: PrismaService) {}

  findLatest(stationId: string) {
    return this.prisma.checklist.findFirst({
      where: { stationId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
    })
  }

  findAll(stationId: string) {
    return this.prisma.checklist.findMany({
      where: { stationId },
      orderBy: { createdAt: 'desc' },
      include: { auditor: { select: { id: true, username: true } } },
    })
  }

  async saveDraft(stationId: string, auditorId: string, items: unknown) {
    const existing = await this.prisma.checklist.findFirst({
      where: { stationId, auditorId, status: 'DRAFT' },
    })

    if (existing) {
      return this.prisma.checklist.update({
        where: { id: existing.id },
        data: { items: items as object, updatedAt: new Date() },
      })
    }

    return this.prisma.checklist.create({
      data: { stationId, auditorId, items: items as object, status: 'DRAFT' },
    })
  }

  async submit(stationId: string, auditorId: string, items: unknown, score?: number) {
    return this.prisma.checklist.create({
      data: {
        stationId,
        auditorId,
        items: items as object,
        score,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    })
  }
}
