import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ChecklistStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit.service'
import { CreateStationDto } from './dto/create-station.dto'
import { UpdateStationDto } from './dto/update-station.dto'
import { OtpRowDto } from './dto/otp-row.dto'
import { computeScoreFromItems, scoreToStatus, hasReviewFlag } from '../checklists/scoring'
import { computeFacilityMetrics, parseChecklistItems } from '@repo/types'
import type { ParsedChecklistGroup, StoredChecklistNode } from '@repo/types'

// Prisma's Json columns want InputJsonValue; every call site here passes data that has already
// been structurally validated (parseChecklistItems, or DTO-typed as object[]/plain JSON) — this
// is a single named bridge for the TS/Prisma interop gap, never a blind cast of unvalidated input.
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

// Same "latest checklist" selection ChecklistsService.findLatest() uses for a single station —
// any of these three statuses, most recent by submittedAt wins. DRAFT is excluded.
const LATEST_CHECKLIST_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'] as const

// batchOtpImport: rows are prefetched/processed in fixed-size chunks (see method doc).
const OTP_IMPORT_CHUNK_SIZE = 50

export type OtpImportRowResult =
  | { id: string; nameTh: string }
  | { nameTh: string; index: number; error: string }

// Same normalization the station dedupe guard (create()/batchOtpImport) matches on:
// case/whitespace-insensitive (mode, nameTh, province) — agency is deliberately excluded.
function otpStationKey(mode: string, nameTh: string, province: string): string {
  return `${mode}|${nameTh.trim().toLowerCase()}|${province.trim().toLowerCase()}`
}

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
    const limit = Math.min(filters?.limit ?? 20, 100)

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

  // Admin fix-up for name/classification/agency and, most importantly, location:
  // a manual lat/lng edit is how an APPROXIMATE (centroid) coordinate gets promoted
  // to a verified OK one so proximity checks work for that station. Both lat and lng
  // must be supplied together — a lone coordinate can't be trusted as a real fix.
  async update(id: string, dto: UpdateStationDto, adminId: string) {
    const before = await this.prisma.station.findUnique({ where: { id } })
    if (!before) throw new NotFoundException()

    const hasNewCoords = dto.lat !== undefined && dto.lng !== undefined
    const after = await this.prisma.station.update({
      where: { id },
      data: {
        ...(dto.nameTh             !== undefined && { nameTh: dto.nameTh.trim() }),
        ...(dto.mode               !== undefined && { mode: dto.mode }),
        ...(dto.railSubtype        !== undefined && { railSubtype: dto.railSubtype || null }),
        ...(dto.province           !== undefined && { province: dto.province.trim() }),
        ...(dto.region             !== undefined && { region: dto.region.trim() }),
        ...(dto.responsibleAgency  !== undefined && { responsibleAgency: dto.responsibleAgency }),
        ...(hasNewCoords && {
          lat: dto.lat,
          lng: dto.lng,
          coordSource: 'MANUAL' as const,
          coordStatus: 'OK' as const,
        }),
      },
    })

    await this.auditLog.log({
      userId: adminId, action: 'UPDATE', entityType: 'Station', entityId: id, before, after,
    })
    return after
  }

  async approveChecklist(stationId: string, checklistId: string) {
    // Read first (BOLA-scoped) so a flagged checklist never actually flips to APPROVED.
    const existing = await this.prisma.checklist.findFirst({ where: { id: checklistId, stationId } })
    if (!existing) throw new NotFoundException()
    if (existing.status !== 'SUBMITTED') {
      throw new BadRequestException('มีเพียงรายงานที่รอการอนุมัติเท่านั้นที่สามารถอนุมัติได้')
    }
    if (hasReviewFlag(existing.items)) {
      throw new BadRequestException({
        code: 'FLAGGED_ITEMS_PENDING',
        message: 'มีรายการที่พบปัญหาค้างอยู่ กรุณาแก้ไขก่อนอนุมัติ',
      })
    }

    // All three writes go through the tx client — a failure partway through (e.g. the
    // station update) must not leave the checklist flipped to APPROVED with a stale
    // station score. The status is re-checked inside the transaction to close the race
    // between the read above and this write (a concurrent approve landing in between).
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.checklist.findFirst({ where: { id: checklistId, stationId } })
      if (!current || current.status !== 'SUBMITTED') {
        throw new BadRequestException('มีเพียงรายงานที่รอการอนุมัติเท่านั้นที่สามารถอนุมัติได้')
      }

      const cl = await tx.checklist.update({
        where: { id: checklistId, stationId },
        data: { status: 'APPROVED' },
      })
      // Re-derive score from stored items; do not trust the client-supplied value.
      const score  = computeScoreFromItems(cl.items)
      const status = scoreToStatus(score)
      await tx.checklist.update({ where: { id: checklistId }, data: { score } })
      await tx.station.update({ where: { id: stationId }, data: { score, status, lastInspected: cl.submittedAt } })
      return cl
    })
  }

  // Toggles reviewFlag on one item inside the items JSON blob (there is no dedicated column —
  // same storage model the existing `flagged` scoring field uses). Returns before/after for
  // the caller to write an AuditLog entry.
  async setItemFlag(stationId: string, checklistId: string, itemId: string, reviewFlag: boolean) {
    const cl = await this.prisma.checklist.findFirst({ where: { id: checklistId, stationId } })
    if (!cl) throw new NotFoundException()

    const groups = parseChecklistItems(cl.items)
    let before: boolean | undefined
    let found = false
    // Recurses into subItems (v2 nested trees) as well as flat v1 leaves — the target item could
    // be at any depth.
    const updateNode = (it: StoredChecklistNode): StoredChecklistNode => {
      if (it.id === itemId) {
        found = true
        before = it.reviewFlag
        return { ...it, reviewFlag }
      }
      if (it.subItems) return { ...it, subItems: it.subItems.map(updateNode) }
      return it
    }
    const updatedGroups: ParsedChecklistGroup[] = groups.map(g => ({ ...g, items: g.items.map(updateNode) }))
    if (!found) throw new NotFoundException('checklist item not found')

    const updated = await this.prisma.checklist.update({
      where: { id: checklistId, stationId },
      data: { items: toJson(updatedGroups) },
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

    // Both writes (REJECTED status + the draft upsert that carries the feedback forward)
    // go through the tx client — a failure on the draft upsert must not leave the checklist
    // marked REJECTED with nothing for the auditor to resubmit from. Status is re-checked
    // inside the transaction to mirror the same precondition the pre-tx read enforces above.
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.checklist.findFirst({ where: { id: checklistId, stationId } })
      if (!current || current.status !== 'SUBMITTED') {
        throw new BadRequestException('มีเพียงรายงานที่รอการอนุมัติเท่านั้นที่สามารถปฏิเสธได้')
      }

      const cl = await tx.checklist.update({
        where: { id: checklistId, stationId },
        data: { status: 'REJECTED', reviewNotes: notes, reviewedAt: new Date() },
      })

      const draft = await tx.checklist.findFirst({
        where: { stationId, auditorId: cl.auditorId, status: 'DRAFT' },
      })
      if (draft) {
        await tx.checklist.update({
          where: { id: draft.id },
          data: { items: toJson(cl.items), reviewNotes: notes, updatedAt: new Date() },
        })
      } else {
        await tx.checklist.create({
          data: { stationId, auditorId: cl.auditorId, items: toJson(cl.items), status: 'DRAFT', reviewNotes: notes },
        })
      }
      return cl
    })
  }

  async getPendingReviews(): Promise<string[]> {
    const rows = await this.prisma.checklist.findMany({
      where: { status: 'SUBMITTED' },
      select: { stationId: true },
      distinct: ['stationId'],
    })
    return rows.map(r => r.stationId)
  }

  // Rows are processed in fixed-size chunks: each chunk gets ONE station.findMany +
  // ONE checklist.findMany (instead of two findFirst reads per row), and each ROW's
  // writes run inside their own $transaction — one bad row rolls back only itself and
  // is reported individually, never poisoning the rest of the chunk/batch. Chunks (and
  // rows within a chunk) run strictly in array order, so duplicate rows in one payload
  // resolve deterministically: last row wins, matching the prior per-row-findFirst
  // behavior exactly (see stationMap/checklistMap below, updated after every row).
  async batchOtpImport(rows: OtpRowDto[], adminId: string): Promise<OtpImportRowResult[]> {
    const results: OtpImportRowResult[] = new Array(rows.length)

    for (let chunkStart = 0; chunkStart < rows.length; chunkStart += OTP_IMPORT_CHUNK_SIZE) {
      const chunk = rows.slice(chunkStart, chunkStart + OTP_IMPORT_CHUNK_SIZE)

      // Same normalized-key dedupe guard as create(): agency alone must never fork a
      // station into a duplicate row (see _find-duplicate-stations.cjs) — batched here
      // as one OR-of-keys findMany instead of one findFirst per row.
      const existingStations = await this.prisma.station.findMany({
        where: {
          OR: chunk.map(row => ({
            mode:     row.station.mode,
            nameTh:   { equals: row.station.nameTh.trim(),   mode: 'insensitive' as const },
            province: { equals: row.station.province.trim(), mode: 'insensitive' as const },
          })),
        },
      })
      const stationMap = new Map<string, (typeof existingStations)[number]>()
      for (const s of existingStations) stationMap.set(otpStationKey(s.mode, s.nameTh, s.province), s)

      // One per (station, year) — same "latest APPROVED checklist for this year" concept
      // the original per-row findFirst enforced, just prefetched for every station this
      // chunk already knows about (brand-new stations have nothing to prefetch).
      const existingStationIds = existingStations.map(s => s.id)
      const existingChecklists = existingStationIds.length
        ? await this.prisma.checklist.findMany({
            where: { stationId: { in: existingStationIds }, status: 'APPROVED' },
          })
        : []
      const checklistMap = new Map<string, (typeof existingChecklists)[number]>()
      for (const cl of existingChecklists) {
        if (!cl.submittedAt) continue
        checklistMap.set(`${cl.stationId}|${cl.submittedAt.getFullYear()}`, cl)
      }

      for (let i = 0; i < chunk.length; i++) {
        const row = chunk[i]!
        const rowIndex = chunkStart + i
        try {
          results[rowIndex] = await this.importOtpRow(row, adminId, stationMap, checklistMap)
        } catch (err) {
          results[rowIndex] = {
            nameTh: row.station.nameTh,
            index:  rowIndex,
            error:  err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ',
          }
        }
      }
    }

    return results
  }

  // One row's writes (station upsert, checklist create/update, station score/status
  // refresh) as a single transaction — mirrors the atomicity approve/rejectChecklist
  // use above. stationMap/checklistMap are updated after the transaction commits so a
  // LATER row in this same batch (this chunk or a later one) that targets the same
  // station/year sees the fresh state without another DB read.
  private async importOtpRow(
    row: OtpRowDto,
    adminId: string,
    stationMap: Map<string, { id: string; nameTh: string; responsibleAgency: string; lastInspected: Date | null }>,
    checklistMap: Map<string, { id: string; stationId: string; submittedAt: Date | null }>,
  ): Promise<{ id: string; nameTh: string }> {
    const nameTh   = row.station.nameTh.trim()
    const province = row.station.province.trim()
    const key       = otpStationKey(row.station.mode, nameTh, province)
    const auditDate = new Date(row.lastInspected)
    // Re-derive score from items; never trust the client-computed row.score.
    const importedScore  = computeScoreFromItems(row.items)
    const importedStatus = scoreToStatus(importedScore)

    const station = await this.prisma.$transaction(async (tx) => {
      let station = stationMap.get(key)
      if (station) {
        // Prefer a real agency over a stale 'อื่นๆ' fallback if this row has one.
        if (station.responsibleAgency === 'อื่นๆ' && row.station.responsibleAgency !== 'อื่นๆ') {
          station = await tx.station.update({
            where: { id: station.id },
            data: { responsibleAgency: row.station.responsibleAgency },
          })
        }
      } else {
        station = await tx.station.create({
          data: { ...row.station, nameTh, province, urgentIssues: [] },
        })
      }

      const checklistKey = `${station.id}|${auditDate.getFullYear()}`
      const existing = checklistMap.get(checklistKey)
      if (existing) {
        await tx.checklist.update({
          where: { id: existing.id },
          data:  { items: toJson(row.items), score: importedScore },
        })
      } else {
        const created = await tx.checklist.create({
          data: {
            stationId:   station.id,
            auditorId:   adminId,
            items:       toJson(row.items),
            score:       importedScore,
            status:      'APPROVED',
            submittedAt: auditDate,
          },
        })
        checklistMap.set(checklistKey, created)
      }

      if (!station.lastInspected || auditDate > station.lastInspected) {
        station = await tx.station.update({
          where: { id: station.id },
          data: { score: importedScore, status: importedStatus, lastInspected: auditDate },
        })
      }
      return station
    })

    stationMap.set(key, station)

    await this.auditLog.log({
      userId: adminId, action: 'OTP_IMPORT', entityType: 'Station', entityId: station.id,
    })
    return { id: station.id, nameTh: station.nameTh }
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

  // Bounded aggregation for the executive/admin dashboard's facility-metrics panel — exactly
  // 2 Prisma queries regardless of how many stations match, replacing the old client-side
  // useQueries-per-station fan-out (1 + N requests). See metrics-aggregation.spec.ts for the
  // missing-data convention (a station with no checklist, or whose latest checklist doesn't
  // contain the requested sub-item, contributes nothing — it's dropped, not counted as ไม่มี).
  async computeMetrics(filters: {
    mode?: string
    railSubtype?: string
    region?: string
    province?: string
    responsibleAgency?: string
    subItem?: string
    from?: string
    to?: string
  }) {
    const stationWhere = {
      ...(filters.mode              && { mode:              filters.mode }),
      ...(filters.railSubtype       && { railSubtype:       filters.railSubtype }),
      ...(filters.region            && { region:            filters.region }),
      ...(filters.province          && { province:          filters.province }),
      ...(filters.responsibleAgency && { responsibleAgency: filters.responsibleAgency }),
    }

    const stations = await this.prisma.station.findMany({
      where: stationWhere,
      select: { id: true, nameTh: true, province: true },
    })
    const totalStations = stations.length

    if (totalStations === 0) {
      return {
        totalStations: 0,
        evaluatedStations: 0,
        metrics: computeFacilityMetrics([]),
        appliedFilters: filters,
        failingStations: [],
      }
    }
    const stationById = new Map(stations.map(s => [s.id, s]))

    // DISTINCT ON (stationId) ORDER BY stationId, submittedAt DESC — one row per station, the
    // most recently submitted of SUBMITTED/APPROVED/REJECTED. One query for any station count.
    const checklists = await this.prisma.checklist.findMany({
      where: {
        stationId: { in: stations.map(s => s.id) },
        status: { in: [...LATEST_CHECKLIST_STATUSES] },
        ...((filters.from || filters.to) && {
          submittedAt: {
            ...(filters.from && { gte: new Date(filters.from) }),
            ...(filters.to   && { lte: new Date(filters.to) }),
          },
        }),
      },
      select: { stationId: true, items: true },
      distinct: ['stationId'],
      orderBy: [{ stationId: 'asc' }, { submittedAt: 'desc' }],
    })

    const collected: StoredChecklistNode[] = []
    // Only meaningful (and only populated) when subItem is set — the per-station names behind
    // the aggregate "has the item but isn't standard yet" count, for the dashboard's drill-down
    // list. Mirrors the old client-side fan-out's equivalent list exactly.
    const failingStations: { id: string; nameTh: string; province: string }[] = []
    let evaluatedStations = 0
    for (const cl of checklists) {
      // Malformed rows are skipped, not thrown — this aggregates across every historical
      // checklist for the dashboard, so one bad row must never take the whole aggregate down
      // (same resilience the old `if (!Array.isArray(groups)) continue` defensive check gave).
      let groups: ParsedChecklistGroup[]
      try {
        groups = parseChecklistItems(cl.items)
      } catch {
        continue
      }

      if (filters.subItem) {
        let found: StoredChecklistNode | undefined
        for (const g of groups) {
          found = g.items?.find(it => it.id === filters.subItem)
          if (found) break
        }
        if (found) {
          collected.push(found)
          evaluatedStations++
          if (found.value === 'มี' && !found.meetsStandard && !found.flagged) {
            const station = stationById.get(cl.stationId)
            if (station) failingStations.push(station)
          }
        }
      } else {
        for (const g of groups) collected.push(...(g.items ?? []))
        evaluatedStations++
      }
    }

    return {
      totalStations,
      evaluatedStations,
      metrics: computeFacilityMetrics([{ groupId: 'agg', groupName: 'agg', items: collected }]),
      appliedFilters: filters,
      failingStations,
    }
  }

  // Slim scalar-only projection (no checklist join, no JSON blobs) for the dashboard's map/
  // table/filter-dropdown/urgent-issues panels — deliberately exempt from findAll()'s 100-row
  // cap (Session 1, 4.1). Cheap enough per row that returning every station in one shot is
  // fine; what must never happen is the dashboard silently rendering a truncated subset.
  findMapNodes() {
    return this.prisma.station.findMany({
      select: {
        id: true, name: true, nameTh: true, mode: true, railSubtype: true,
        province: true, region: true, responsibleAgency: true,
        lat: true, lng: true, coordSource: true, coordStatus: true,
        scope: true, isOperational: true, score: true, status: true,
        lastInspected: true, urgentIssues: true,
      },
      orderBy: { nameTh: 'asc' },
    })
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
