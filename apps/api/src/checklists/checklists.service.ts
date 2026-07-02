import { Injectable } from '@nestjs/common'
import { ChecklistStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { computeScoreFromItems } from './scoring'

@Injectable()
export class ChecklistsService {
  constructor(private readonly prisma: PrismaService) {}

  findDraft(stationId: string, auditorId: string) {
    return this.prisma.checklist.findFirst({
      where: { stationId, auditorId, status: ChecklistStatus.DRAFT },
    })
  }

  findLatest(stationId: string) {
    return this.prisma.checklist.findFirst({
      where: { stationId, status: { in: [ChecklistStatus.SUBMITTED, ChecklistStatus.APPROVED] } },
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

  async submit(stationId: string, auditorId: string, items: unknown, _clientScore?: number) {
    // Re-derive score server-side; never trust the client-supplied value.
    const score = computeScoreFromItems(items)
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
