import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateStationDto } from './dto/create-station.dto'

@Injectable()
export class StationsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(filters?: {
    mode?: string
    region?: string
    responsibleAgency?: string
    status?: string
  }) {
    return this.prisma.station.findMany({
      where: {
        ...(filters?.mode && { mode: filters.mode }),
        ...(filters?.region && { region: filters.region }),
        ...(filters?.responsibleAgency && { responsibleAgency: filters.responsibleAgency }),
        ...(filters?.status && { status: filters.status }),
      },
      orderBy: { nameTh: 'asc' },
    })
  }

  findOne(id: string) {
    return this.prisma.station.findUniqueOrThrow({ where: { id } })
  }

  create(dto: CreateStationDto) {
    return this.prisma.station.create({ data: { ...dto, urgentIssues: [] } })
  }

  async approveChecklist(stationId: string, checklistId: string) {
    const cl = await this.prisma.checklist.update({
      where: { id: checklistId },
      data: { status: 'APPROVED' },
    })
    const score = cl.score ?? 0
    const status =
      score >= 75 ? 'ผ่านมาตรฐาน' : score >= 50 ? 'ต้องปรับปรุง' : 'ไม่ผ่าน'
    await this.prisma.station.update({
      where: { id: stationId },
      data: { score, status, lastInspected: cl.submittedAt },
    })
    return cl
  }

  async getPendingReviews(): Promise<string[]> {
    const rows = await this.prisma.checklist.findMany({
      where: { status: 'SUBMITTED' },
      select: { stationId: true },
      distinct: ['stationId'],
    })
    return rows.map(r => r.stationId)
  }

  async summary() {
    const [total, passing, needsImprovement, failing] = await Promise.all([
      this.prisma.station.count(),
      this.prisma.station.count({ where: { status: 'ผ่านมาตรฐาน' } }),
      this.prisma.station.count({ where: { status: 'ต้องปรับปรุง' } }),
      this.prisma.station.count({ where: { status: 'ไม่ผ่าน' } }),
    ])
    return {
      totalStations: total,
      passing,
      needsImprovement,
      failing,
      passRate: total > 0 ? Math.round((passing / total) * 1000) / 10 : 0,
    }
  }
}
