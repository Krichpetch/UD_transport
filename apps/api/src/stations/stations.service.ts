import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ChecklistStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit.service'
import { CreateStationDto } from './dto/create-station.dto'
import { OtpRowDto } from './dto/otp-row.dto'
import { computeScoreFromItems, scoreToStatus, hasReviewFlag } from '../checklists/scoring'
import type { ChecklistGroup } from '@repo/types'

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
    checklistStatus?: string
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
      ...(filters?.checklistStatus && {
        checklists: { some: { status: filters.checklistStatus as ChecklistStatus } },
      }),
      ...(filters?.search && {
        OR: [
          { nameTh:   { contains: filters.search, mode: 'insensitive' as const } },
          { name:     { contains: filters.search, mode: 'insensitive' as const } },
          { province: { contains: filters.search, mode: 'insensitive' as const } },
        ],
      }),
    }
    // reviewChecklist join: filtered to an impossible id when no checklistStatus is
    // requested, so ordinary listing always gets an empty array (no behavior change),
    // and the pending/rejected tabs get the one matching checklist per station for free.
    const [rows, total] = await Promise.all([
      this.prisma.station.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          checklists: {
            where: filters?.checklistStatus
              ? { status: filters.checklistStatus as ChecklistStatus }
              : { id: '__none__' },
            orderBy: { submittedAt: 'desc' },
            take: 1,
            include: { auditor: { select: { username: true } } },
          },
        },
      }),
      this.prisma.station.count({ where }),
    ])
    const data = rows.map(({ checklists, ...station }) => {
      const cl = checklists[0]
      return {
        ...station,
        reviewChecklist: cl ? {
          id:              cl.id,
          status:          cl.status,
          submittedAt:     cl.submittedAt,
          reviewNotes:     cl.reviewNotes,
          auditorUsername: cl.auditor.username,
        } : null,
      }
    })
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

  // Proximity search for the location-first auditor picker. PostGIS ST_DWithin/ST_Distance
  // over an expression-based GiST index (see prisma/migrations_manual/) — deliberately not a
  // Prisma-tracked column, since `db push` can't safely manage generated geography columns.
  // Only coordStatus=OK stations are candidates: APPROXIMATE/PENDING coords can be tens of km
  // off and would produce meaningless "nearby" results.
  async findNearby(lat: number, lng: number, limit = 20) {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string; name: string; nameTh: string; mode: string; railSubtype: string | null
      province: string; region: string; responsibleAgency: string; lat: number; lng: number
      coordStatus: string; score: number; status: string; lastInspected: Date | null
      urgentIssues: string[]; distanceM: number
    }>>`
      SELECT id, name, "nameTh", mode, "railSubtype", province, region, "responsibleAgency",
             lat, lng, "coordStatus", score, status, "lastInspected", "urgentIssues",
             ST_Distance(
               ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
               ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
             ) AS "distanceM"
      FROM "Station"
      WHERE "coordStatus" = 'OK' AND lat IS NOT NULL AND lng IS NOT NULL
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          1000
        )
      ORDER BY "distanceM" ASC
      LIMIT ${limit}
    `
    return rows.map(r => ({ ...r, distanceM: Math.round(Number(r.distanceM)) }))
  }

  // Server-side truth for the submit-time proximity gate — never trust a client "isNear" flag.
  // Returns null when the station has no coordinates at all (defensive; shouldn't happen for
  // coordStatus=OK rows).
  async distanceToStationMeters(stationId: string, lat: number, lng: number): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ distanceM: number }>>`
      SELECT ST_Distance(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      ) AS "distanceM"
      FROM "Station"
      WHERE id = ${stationId} AND lat IS NOT NULL AND lng IS NOT NULL
    `
    return rows[0] ? Math.round(Number(rows[0].distanceM)) : null
  }

  // Dedupe guard: match on normalized (nameTh, mode, province) — case/whitespace
  // insensitive — regardless of responsibleAgency, since agency parsing drift
  // (e.g. an 'อื่นๆ' fallback) is what let same-station duplicates slip past the
  // DB's exact-string unique constraint. Returns the existing row instead of
  // creating a new one when found; caller decides whether to log a CREATE audit.
  async create(dto: CreateStationDto) {
    const nameTh = dto.nameTh.trim()
    const province = dto.province.trim()
    const existing = await this.prisma.station.findFirst({
      where: {
        mode:     dto.mode,
        nameTh:   { equals: nameTh,   mode: 'insensitive' },
        province: { equals: province, mode: 'insensitive' },
      },
    })
    if (existing) return { station: existing, deduped: true }
    const station = await this.prisma.station.create({
      data: { ...dto, nameTh, province, urgentIssues: [] },
    })
    return { station, deduped: false }
  }

  async approveChecklist(stationId: string, checklistId: string) {
    // Read first (BOLA-scoped) so a flagged checklist never actually flips to APPROVED.
    const existing = await this.prisma.checklist.findFirst({ where: { id: checklistId, stationId } })
    if (!existing) throw new NotFoundException()
    if (hasReviewFlag(existing.items)) {
      throw new BadRequestException({
        code: 'FLAGGED_ITEMS_PENDING',
        message: 'มีรายการที่พบปัญหาค้างอยู่ กรุณาแก้ไขก่อนอนุมัติ',
      })
    }

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

  // Toggles reviewFlag on one item inside the items JSON blob (there is no dedicated column —
  // same storage model the existing `flagged` scoring field uses). Returns before/after for
  // the caller to write an AuditLog entry.
  async setItemFlag(stationId: string, checklistId: string, itemId: string, reviewFlag: boolean) {
    const cl = await this.prisma.checklist.findFirst({ where: { id: checklistId, stationId } })
    if (!cl) throw new NotFoundException()

    const groups = cl.items as unknown as ChecklistGroup[]
    let before: boolean | undefined
    let found = false
    const updatedGroups = groups.map(g => ({
      ...g,
      items: g.items.map(it => {
        if (it.id !== itemId) return it
        found = true
        before = it.reviewFlag
        return { ...it, reviewFlag }
      }),
    }))
    if (!found) throw new NotFoundException('checklist item not found')

    const updated = await this.prisma.checklist.update({
      where: { id: checklistId, stationId },
      data: { items: updatedGroups as object },
    })
    return { checklist: updated, before: before ?? false, after: reviewFlag }
  }

  // Admin sends a SUBMITTED checklist back to the auditor with feedback. The items are copied
  // into (or overwrite) the auditor's DRAFT row for this station, so the existing draft/resubmit
  // path in ChecklistsService.submit() picks it up unchanged — no new submit logic needed.
  async rejectChecklist(stationId: string, checklistId: string, notes: string) {
    const existing = await this.prisma.checklist.findFirst({ where: { id: checklistId, stationId } })
    if (!existing) throw new NotFoundException()
    if (existing.status !== 'SUBMITTED') {
      throw new BadRequestException('มีเพียงรายงานที่รอการอนุมัติเท่านั้นที่สามารถปฏิเสธได้')
    }

    const cl = await this.prisma.checklist.update({
      where: { id: checklistId, stationId },
      data: { status: 'REJECTED', reviewNotes: notes, reviewedAt: new Date() },
    })

    const draft = await this.prisma.checklist.findFirst({
      where: { stationId, auditorId: cl.auditorId, status: 'DRAFT' },
    })
    if (draft) {
      await this.prisma.checklist.update({
        where: { id: draft.id },
        data: { items: cl.items as object, updatedAt: new Date() },
      })
    } else {
      await this.prisma.checklist.create({
        data: { stationId, auditorId: cl.auditorId, items: cl.items as object, status: 'DRAFT' },
      })
    }
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
      // Same normalized-key dedupe guard as create(): agency alone must never
      // fork a station into a duplicate row (see _find-duplicate-stations.cjs).
      const nameTh   = row.station.nameTh.trim()
      const province = row.station.province.trim()
      let station = await this.prisma.station.findFirst({
        where: {
          mode:     row.station.mode,
          nameTh:   { equals: nameTh,   mode: 'insensitive' },
          province: { equals: province, mode: 'insensitive' },
        },
      })
      if (station) {
        // Prefer a real agency over a stale 'อื่นๆ' fallback if this row has one.
        if (station.responsibleAgency === 'อื่นๆ' && row.station.responsibleAgency !== 'อื่นๆ') {
          station = await this.prisma.station.update({
            where: { id: station.id },
            data: { responsibleAgency: row.station.responsibleAgency },
          })
        }
      } else {
        station = await this.prisma.station.create({
          data: { ...row.station, nameTh, province, urgentIssues: [] },
        })
      }
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

  // Export data source: one row per (station, calendar year) — the most recently
  // submitted APPROVED checklist wins if more than one exists for the same year.
  // Reused by both the "all stations" and per-station export routes so there is
  // exactly one code path pulling real assessment results for exports.
  async findAllForExport(stationId?: string) {
    const checklists = await this.prisma.checklist.findMany({
      where: { status: 'APPROVED', ...(stationId && { stationId }) },
      include: { station: true },
      orderBy: [{ stationId: 'asc' }, { submittedAt: 'asc' }],
    })

    const byYear = new Map<string, (typeof checklists)[number]>()
    for (const cl of checklists) {
      if (!cl.submittedAt) continue
      const year = cl.submittedAt.getFullYear()
      const key = `${cl.stationId}|${year}`
      const prev = byYear.get(key)
      if (!prev || cl.submittedAt > prev.submittedAt!) byYear.set(key, cl)
    }
    return [...byYear.values()]
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
