import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit.service'
import { CreateStationDto } from './dto/create-station.dto'
import { OtpRowDto } from './dto/otp-row.dto'
import { computeScoreFromItems, scoreToStatus } from '../checklists/scoring'

@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(filters?: {
    mode?: string
    region?: string
    responsibleAgency?: string
    status?: string
    search?: string
    page?: number
    limit?: number
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
  }) {
    const page  = filters?.page  ?? 1
    const limit = filters?.limit ?? 20

    const SORTABLE = new Set(['nameTh', 'province', 'responsibleAgency', 'score', 'status', 'lastInspected', 'mode'])
    const col      = filters?.sortBy && SORTABLE.has(filters.sortBy) ? filters.sortBy : 'nameTh'
    const dir: 'asc' | 'desc' = filters?.sortOrder === 'desc' ? 'desc' : 'asc'
    const orderBy  = col === 'lastInspected'
      ? { lastInspected: { sort: dir, nulls: 'last' as const } }
      : { [col]: dir }

    const where = {
      ...(filters?.mode              && { mode:              filters.mode }),
      ...(filters?.region            && { region:            filters.region }),
      ...(filters?.responsibleAgency && { responsibleAgency: filters.responsibleAgency }),
      ...(filters?.status            && { status:            filters.status }),
      ...(filters?.search && {
        OR: [
          { nameTh:   { contains: filters.search, mode: 'insensitive' as const } },
          { name:     { contains: filters.search, mode: 'insensitive' as const } },
          { province: { contains: filters.search, mode: 'insensitive' as const } },
        ],
      }),
    }
    const [data, total] = await Promise.all([
      this.prisma.station.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.station.count({ where }),
    ])
    return { data, total, page, totalPages: Math.ceil(total / limit) }
  }

  async getFilterOptions() {
    const [regions, agencies] = await Promise.all([
      this.prisma.station.findMany({
        select: { region: true },
        distinct: ['region'],
        orderBy: { region: 'asc' },
      }),
      this.prisma.station.findMany({
        select: { responsibleAgency: true },
        distinct: ['responsibleAgency'],
        orderBy: { responsibleAgency: 'asc' },
      }),
    ])
    return {
      regions:  regions.map(r => r.region),
      agencies: agencies.map(a => a.responsibleAgency),
    }
  }

  async searchSlim(params: { q?: string; mode?: string; limit: number; page: number }) {
    const limit = Math.min(params.limit, 50)
    const page  = Math.max(params.page, 1)
    const q     = params.q?.trim()
    const where = {
      ...(params.mode && { mode: params.mode }),
      ...(q && {
        OR: [
          { nameTh:   { contains: q, mode: 'insensitive' as const } },
          { province: { contains: q, mode: 'insensitive' as const } },
        ],
      }),
    }
    const [data, total] = await Promise.all([
      this.prisma.station.findMany({
        where,
        select: { id: true, nameTh: true, province: true, mode: true, railSubtype: true },
        orderBy: { nameTh: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.station.count({ where }),
    ])
    return { data, total, page, totalPages: Math.ceil(total / limit) }
  }

  findOne(id: string) {
    return this.prisma.station.findUniqueOrThrow({ where: { id } })
  }

  create(dto: CreateStationDto) {
    return this.prisma.station.create({ data: { ...dto, urgentIssues: [] } })
  }

  async approveChecklist(stationId: string, checklistId: string) {
    const cl = await this.prisma.checklist.update({
      where: { id: checklistId, stationId },
      data: { status: 'APPROVED' },
    })
    // Re-derive score from stored items; do not trust the client-supplied value.
    const score  = computeScoreFromItems(cl.items)
    const status = scoreToStatus(score)
    await Promise.all([
      this.prisma.checklist.update({ where: { id: checklistId }, data: { score } }),
      this.prisma.station.update({ where: { id: stationId }, data: { score, status, lastInspected: cl.submittedAt } }),
    ])
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
      const auditDate = new Date(row.lastInspected)
      const yearStart = new Date(auditDate.getFullYear(), 0, 1)
      const yearEnd   = new Date(auditDate.getFullYear() + 1, 0, 1)
      const existing  = await this.prisma.checklist.findFirst({
        where: { stationId: station.id, submittedAt: { gte: yearStart, lt: yearEnd }, status: 'APPROVED' },
      })
      // Re-derive score from items; never trust the client-computed row.score.
      const importedScore  = computeScoreFromItems(row.items as unknown)
      const importedStatus = scoreToStatus(importedScore)

      if (existing) {
        await this.prisma.checklist.update({
          where: { id: existing.id },
          data:  { items: row.items as object, score: importedScore },
        })
      } else {
        await this.prisma.checklist.create({
          data: {
            stationId:   station.id,
            auditorId:   adminId,
            items:       row.items as object,
            score:       importedScore,
            status:      'APPROVED',
            submittedAt: auditDate,
          },
        })
      }
      if (!station.lastInspected || auditDate > station.lastInspected) {
        await this.prisma.station.update({
          where: { id: station.id },
          data: { score: importedScore, status: importedStatus, lastInspected: auditDate },
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
