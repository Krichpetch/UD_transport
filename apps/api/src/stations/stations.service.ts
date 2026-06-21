import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit.service'
import { CreateStationDto } from './dto/create-station.dto'
import { OtpRowDto } from './dto/otp-row.dto'

@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

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

  async batchOtpImport(rows: OtpRowDto[], adminId: string) {
    const results: { id: string; nameTh: string }[] = []
    for (const row of rows) {
      const station = await this.prisma.station.upsert({
        where: {
          nameTh_mode_responsibleAgency_province: {
            nameTh:            row.station.nameTh,
            mode:              row.station.mode,
            responsibleAgency: row.station.responsibleAgency,
            province:          row.station.province,
          },
        },
        create: { ...row.station, urgentIssues: [] },
        update: {},
      })
      await this.prisma.checklist.create({
        data: {
          stationId:   station.id,
          auditorId:   adminId,
          items:       row.items as object,
          score:       row.score,
          status:      'APPROVED',
          submittedAt: new Date(row.lastInspected),
        },
      })
      const newDate = new Date(row.lastInspected)
      if (!station.lastInspected || newDate > station.lastInspected) {
        await this.prisma.station.update({
          where: { id: station.id },
          data: { score: row.score, status: row.status, lastInspected: newDate },
        })
      }
      await this.auditLog.log({
        userId: adminId, action: 'OTP_IMPORT', entityType: 'Station', entityId: station.id,
      })
      results.push({ id: station.id, nameTh: station.nameTh })
    }
    return results
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
