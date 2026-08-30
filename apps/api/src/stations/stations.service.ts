import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import * as path from 'path'
import { ChecklistStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit.service'
import { CreateStationDto } from './dto/create-station.dto'
import { UpdateStationDto } from './dto/update-station.dto'
import { OtpRowDto } from './dto/otp-row.dto'
import { computeScoreFromItems, scoreToStatus, hasReviewFlag } from '../checklists/scoring'
import { computeFacilityMetrics, parseChecklistItems, isValidYearBuilt, isValidYearBuiltDate, deriveRegion, UNSPECIFIED_REGION, RESPONSIBLE_AGENCIES, OTHER_AGENCY } from '@repo/types'
import type { ParsedChecklistGroup, StoredChecklistNode } from '@repo/types'
import { resolveStationMatch, type MasterlistStation } from './masterlist-match'
import { applyOtpRowToStation } from './import-otp-row'
import { writeReconciliationCsv, writePendingPayloads, type ReconciliationRow } from './import-reconciliation'
import { normalizeKey } from '../common/text-normalize'

// Prisma's Json columns want InputJsonValue; every call site here passes data that has already
// been structurally validated (parseChecklistItems, or DTO-typed as object[]/plain JSON) — this
// is a single named bridge for the TS/Prisma interop gap, never a blind cast of unvalidated input.
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

// The 10 canonical agencies with a real identity, i.e. everything except the OTHER_AGENCY
// catch-all bucket itself.
const NAMED_AGENCIES = RESPONSIBLE_AGENCIES.filter((a) => a !== OTHER_AGENCY)

// responsibleAgency is stored as the raw value (a masterlist-sourced company name may not be
// one of the 11 canonical strings — see migrate-agency-names.ts's header comment for why that's
// deliberate). Filtering by one of the 10 named agencies is an exact match; filtering by
// OTHER_AGENCY must also catch any raw value that ISN'T one of those 10, not just rows that
// literally equal the OTHER_AGENCY string.
function agencyWhere(agency: string): { responsibleAgency: string | { notIn: string[] } } {
  return {
    responsibleAgency: agency === OTHER_AGENCY ? { notIn: NAMED_AGENCIES } : agency,
  }
}

// AND-combines id sets from independent filters (e.g. search + subItem) that each narrow
// findAll() by station id — spreading two `{ id: {...} }` where-entries into one object would
// silently let the later one overwrite the former instead of intersecting them.
function intersectIdSets(sets: string[][]): string[] {
  return sets.reduce((acc, ids) => {
    const idSet = new Set(ids)
    return acc.filter((id) => idSet.has(id))
  })
}

// Recurses into subItems (v2 nested trees) as well as flat v1 leaves, same as
// StationsService.setItemFlag's traversal — the target item could be at any depth.
function findItemInGroups(groups: ParsedChecklistGroup[], itemId: string): StoredChecklistNode | undefined {
  const search = (nodes: StoredChecklistNode[]): StoredChecklistNode | undefined => {
    for (const node of nodes) {
      if (node.id === itemId) return node
      if (node.subItems) {
        const found = search(node.subItems)
        if (found) return found
      }
    }
    return undefined
  }
  for (const g of groups) {
    const found = search(g.items ?? [])
    if (found) return found
  }
  return undefined
}

// Same "latest checklist" selection ChecklistsService.findLatest() uses for a single station —
// any of these three statuses, most recent by submittedAt wins. DRAFT is excluded.
const LATEST_CHECKLIST_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'] as const

// batchOtpImport: rows are prefetched/processed in fixed-size chunks (see method doc).
const OTP_IMPORT_CHUNK_SIZE = 50

// Station masterlist cutover, import hardening (Task B3) — where reconciliation CSVs land.
// Gitignored: these are run artifacts, not source of truth (the masterlist JSON is).
const IMPORT_REPORTS_DIR = path.resolve(__dirname, '..', '..', 'import-reports')

export type OtpImportRowResult =
  | { id: string; nameTh: string }
  | { nameTh: string; index: number; error: string }
  | { nameTh: string; index: number; skipped: true; reason: 'REVIEW' | 'NOT_ON_MASTERLIST' }

@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(filters?: {
    mode?: string
    railSubtype?: string
    // Session F3, Part A.4 — line/route (สาย) the station sits on. Exact match, and part of the
    // station identity key (mode, nameTh, line), so it belongs in scopeWhere alongside
    // mode/railSubtype: the subItem filter scopes through it identically.
    line?: string
    region?: string
    province?: string
    responsibleAgency?: string
    status?: string
    checklistStatus?: string
    search?: string
    subItem?: string
    page?: number
    limit?: number
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
    // Session S3b, Part A.4 — training stations are hidden from the admin stations list by
    // default (they're fixtures, not real audit targets); an explicit "แสดงสถานีฝึกหัด" toggle
    // sets this true to surface them for review/QA. Every OTHER caller of findAll (search
    // dropdowns, checklist-status queue tabs) inherits the same default-excluded behavior.
    includeTraining?: boolean
  }) {
    const page  = filters?.page  ?? 1
    const limit = Math.min(filters?.limit ?? 20, 100)

    const SORTABLE = new Set(['nameTh', 'province', 'responsibleAgency', 'score', 'status', 'lastInspected', 'mode'])
    const col      = filters?.sortBy && SORTABLE.has(filters.sortBy) ? filters.sortBy : 'nameTh'
    const dir: 'asc' | 'desc' = filters?.sortOrder === 'desc' ? 'desc' : 'asc'
    const orderBy  = col === 'lastInspected'
      ? { lastInspected: { sort: dir, nulls: 'last' as const } }
      : { [col]: dir }

    // The scalar (non-checklist-derived) station filters — reused as the scoping query for the
    // subItem filter below, so "which stations does the item filter search within" always
    // matches "which stations does the rest of this filter bar narrow to".
    const scopeWhere = {
      ...(filters?.mode              && { mode:              filters.mode }),
      ...(filters?.railSubtype       && { railSubtype:       filters.railSubtype }),
      ...(filters?.line              && { line:              filters.line }),
      ...(filters?.region            && {
        region: filters.region === UNSPECIFIED_REGION ? null : filters.region,
      }),
      ...(filters?.province          && { province:          filters.province }),
      ...(filters?.responsibleAgency && agencyWhere(filters.responsibleAgency)),
      ...(filters?.status            && { status:            filters.status }),
      ...(!filters?.includeTraining  && { isTraining:        false }),
    }

    // Both resolved BEFORE the main where clause since each needs its own query. Station
    // identity is (mode, nameTh, line) post-masterlist-cutover, so `line` must be searchable
    // alongside nameTh/name/province, and Thai text needs whitespace/digit/punctuation
    // normalization (spacing varies a lot across source files) to match a plain Prisma
    // `contains` would miss. The subItem filter mirrors computeMetrics()'s per-station item
    // lookup (see findItemInGroups) rather than duplicating that traversal.
    const searchIds  = filters?.search  ? await this.searchStationIds(filters.search)                 : null
    const subItemIds = filters?.subItem ? await this.stationIdsWithAnsweredItem(filters.subItem, scopeWhere) : null
    // Both filters narrow by station id independently — intersect rather than spreading two
    // `{ id: ... }` entries into one object, which would silently let the second overwrite
    // the first instead of combining them with AND.
    const idFilterSets = [searchIds, subItemIds].filter((s): s is string[] => s !== null)
    const combinedIds  = idFilterSets.length === 0 ? null : intersectIdSets(idFilterSets)

    const where = {
      ...scopeWhere,
      ...(filters?.checklistStatus && {
        checklists: { some: { status: filters.checklistStatus as ChecklistStatus } },
      }),
      ...(combinedIds !== null && { id: { in: combinedIds } }),
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

  // Server-side search for findAll() — reuses the same normalizeKey() the masterlist import's
  // fuzzy matching uses (see masterlist-match.ts) rather than a second ad-hoc normalization, so
  // "what counts as the same text" stays defined in exactly one place. Matches nameTh, the
  // (optional, manually-entered) English `name`, line, and province, all whitespace/digit/
  // punctuation-normalized and case-insensitive — a plain Prisma `contains` catches none of that
  // and silently drops line entirely, which is the actual station-identity component the
  // masterlist cutover added ((mode, nameTh, line), not (mode, nameTh)).
  private async searchStationIds(search: string): Promise<string[]> {
    const key = normalizeKey(search)
    if (!key) return []
    // Escape ILIKE wildcards that could be present in user input so they're matched literally.
    const escaped = key.replace(/[!%_]/g, (c) => `!${c}`)
    const pattern = `%${escaped}%`
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Station"
      WHERE regexp_replace("nameTh", '\s+', '', 'g') ILIKE ${pattern} ESCAPE '!'
         OR regexp_replace("name", '\s+', '', 'g') ILIKE ${pattern} ESCAPE '!'
         OR regexp_replace("line", '\s+', '', 'g') ILIKE ${pattern} ESCAPE '!'
         OR regexp_replace(COALESCE("province", ''), '\s+', '', 'g') ILIKE ${pattern} ESCAPE '!'
    `
    return rows.map((r) => r.id)
  }

  // findAll()'s checklist-item filter — station ids whose LATEST checklist (same
  // SUBMITTED/APPROVED/REJECTED convention as computeMetrics) has the given item ANSWERED
  // (value 'มี' or 'ไม่มี' — excludes null/unanswered and 'N/A', per CLAUDE.md's scoring
  // convention). Shares the group traversal (findItemInGroups) with computeMetrics rather
  // than a second copy; only the "what counts as a match" condition differs (computeMetrics
  // wants the item present at all, this wants it actually answered).
  //
  // 2 queries total regardless of how many stations match `scopeWhere` — same bounded shape
  // as computeMetrics, not a per-station fan-out.
  private async stationIdsWithAnsweredItem(
    subItem: string,
    scopeWhere: Prisma.StationWhereInput,
  ): Promise<string[]> {
    const stations = await this.prisma.station.findMany({ where: scopeWhere, select: { id: true } })
    if (stations.length === 0) return []

    const checklists = await this.prisma.checklist.findMany({
      where: { stationId: { in: stations.map((s) => s.id) }, status: { in: [...LATEST_CHECKLIST_STATUSES] } },
      select: { stationId: true, items: true },
      distinct: ['stationId'],
      orderBy: [{ stationId: 'asc' }, { submittedAt: 'desc' }],
    })

    const matched: string[] = []
    for (const cl of checklists) {
      let groups: ParsedChecklistGroup[]
      try {
        groups = parseChecklistItems(cl.items)
      } catch {
        continue
      }
      const found = findItemInGroups(groups, subItem)
      if (found && (found.value === 'มี' || found.value === 'ไม่มี')) matched.push(cl.stationId)
    }
    return matched
  }

  async getFilterOptions() {
    const [regions, provinces] = await Promise.all([
      this.prisma.station.findMany({
        where: { isTraining: false },
        select: { region: true },
        distinct: ['region'],
        orderBy: { region: 'asc' },
      }),
      // IN_SCOPE only — the admin province filter shouldn't offer provinces that only exist
      // among OUT_OF_SCOPE rows.
      this.prisma.station.findMany({
        where: { scope: 'IN_SCOPE', isTraining: false },
        select: { province: true },
        distinct: ['province'],
        orderBy: { province: 'asc' },
      }),
    ])
    // Stations with region === null (neither coords nor a recognisable province, see
    // @repo/types#deriveRegion) surface as one "ไม่ระบุ" option rather than a blank one —
    // findAll() translates that literal back to `region IS NULL` above.
    const namedRegions = regions.map(r => r.region).filter((r): r is string => r != null)
    const hasUnspecified = regions.some(r => r.region == null)
    return {
      regions:   hasUnspecified ? [...namedRegions, UNSPECIFIED_REGION] : namedRegions,
      // Always the full canonical list, regardless of which agencies currently have stations —
      // a filter option must never disappear just because its count is 0 (and, post
      // migrate-agency-names.ts's 2026-08-02 correction, DB-distinct would also leak raw
      // non-canonical company names into this dropdown).
      agencies:  [...RESPONSIBLE_AGENCIES],
      provinces: provinces.map(p => p.province).filter((p): p is string => p != null),
    }
  }

  // Session S3b, Part B — railSubtype mirrors the F2 admin filter exactly (same values/labels,
  // see @repo/types#RAIL_SUBTYPES): only meaningful alongside mode='ทางราง', ignored otherwise.
  //
  // Session F3, Part A.1 — search now goes through searchStationIds() (the SAME normalized
  // matching findAll uses) instead of the plain Prisma `contains` on nameTh/province it used
  // before. That predicate silently dropped `line` entirely — the very component that
  // distinguishes two same-named stations post-masterlist-cutover, which is exactly what the
  // auditor picker needs to tell apart. Deliberately ONE normalization for the whole app, not a
  // third ad-hoc variant: searchStationIds already covers nameTh/name/line/province with
  // whitespace normalization + ILIKE escaping.
  async searchSlim(params: { q?: string; mode?: string; railSubtype?: string; line?: string; limit: number; page: number }) {
    const limit = Math.min(params.limit, 50)
    const page  = Math.max(params.page, 1)
    const q     = params.q?.trim()
    // Resolved BEFORE the where clause since it needs its own query, exactly as in findAll().
    const searchIds = q ? await this.searchStationIds(q) : null
    const where = {
      ...(params.mode && { mode: params.mode }),
      ...(params.mode === 'ทางราง' && params.railSubtype && { railSubtype: params.railSubtype }),
      // Part A.4 — same exact-match line filter as findAll's scopeWhere, so both roles' pickers
      // narrow identically. Composes with (never overwrites) mode/railSubtype/search above.
      ...(params.line && { line: params.line }),
      ...(searchIds !== null && { id: { in: searchIds } }),
      // Session S3b, Part A.4 — the general auditor station picker never surfaces training
      // fixtures; those are reached only through the dedicated "แบบฝึกหัด" section.
      isTraining: false,
    }
    const [data, total] = await Promise.all([
      this.prisma.station.findMany({
        where,
        // Part A.1 — `line` is selected so a result row can render it: two stations sharing a
        // nameTh are only distinguishable by it.
        select: { id: true, nameTh: true, province: true, mode: true, railSubtype: true, line: true },
        orderBy: { nameTh: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.station.count({ where }),
    ])
    return { data, total, page, totalPages: Math.ceil(total / limit) }
  }

  // Session F3, Part A.4 — distinct non-empty `line` values for a mode/railSubtype scope, backing
  // the line filter control in both the admin stations filter bar and the auditor picker. ONE
  // bounded query: deriving this client-side from a page of results would only ever see the lines
  // present on that page. Empty string (the deliberate "no line" sentinel — see schema.prisma
  // Station.line) is never offered as an option. The UI shows the control only when this returns
  // a non-empty list, so a mode that gains lines later needs no code change.
  async findLines(params: { mode?: string; railSubtype?: string }): Promise<string[]> {
    const rows = await this.prisma.station.findMany({
      where: {
        ...(params.mode && { mode: params.mode }),
        ...(params.mode === 'ทางราง' && params.railSubtype && { railSubtype: params.railSubtype }),
        line: { not: '' },
        isTraining: false,
      },
      select: { line: true },
      distinct: ['line'],
      orderBy: { line: 'asc' },
    })
    return rows.map((r) => r.line)
  }

  findOne(id: string) {
    return this.prisma.station.findUniqueOrThrow({ where: { id } })
  }

  // Session S3b, Part A.5 — backs the auditor home's "แบบฝึกหัด" section: the fixed set of
  // practice stations (see seed-training-stations.ts), one per template type. Slim projection,
  // same shape searchSlim already returns, ordered by mode so the 5 cards render in a stable
  // sequence every time. Part A.3 — `line` selected here too, so a training fixture that ever
  // carries one labels identically to a real station rather than silently dropping it.
  findTrainingStations() {
    return this.prisma.station.findMany({
      where: { isTraining: true },
      select: { id: true, nameTh: true, mode: true, railSubtype: true, line: true },
      orderBy: [{ mode: 'asc' }, { railSubtype: 'asc' }],
    })
  }

  // Proximity search for the location-first auditor picker. PostGIS ST_DWithin/ST_Distance
  // over an expression-based GiST index (see prisma/migrations_manual/) — deliberately not a
  // Prisma-tracked column, since `db push` can't safely manage generated geography columns.
  // Only coordStatus=OK stations are candidates: APPROXIMATE/PENDING coords can be tens of km
  // off and would produce meaningless "nearby" results.
  async findNearby(lat: number, lng: number, limit = 20) {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string; name: string; nameTh: string; mode: string; railSubtype: string | null
      line: string
      province: string | null; region: string | null; responsibleAgency: string; lat: number; lng: number
      coordStatus: string; score: number; status: string; lastInspected: Date | null
      urgentIssues: string[]; distanceM: number
    }>>`
      SELECT id, name, "nameTh", mode, "railSubtype", line, province, region, "responsibleAgency",
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

  // Session F3, Part A.5 — station identity is the (mode, nameTh, line) composite unique index,
  // so any admin edit to one of those three can collide with an existing row. Before F3 this was
  // an unhandled P2002 surfacing as a raw 500 on a nameTh/mode edit; now every write through
  // create()/update() reports WHICH station it clashed with, in Thai, so the admin can act on it.
  // Looks the conflicting row up by the same key Postgres rejected on — never a guess.
  private async describeIdentityConflict(key: { mode: string; nameTh: string; line: string }): Promise<never> {
    const clash = await this.prisma.station.findFirst({ where: key })
    const where = [clash?.province, clash?.responsibleAgency].filter(Boolean).join(' · ')
    const lineLabel = key.line ? `สาย "${key.line}"` : 'ไม่ระบุสาย'
    throw new BadRequestException({
      code: 'STATION_IDENTITY_CONFLICT',
      message:
        `มีสถานีชื่อ "${key.nameTh}" (${key.mode}, ${lineLabel}) อยู่แล้ว` +
        (where ? ` — ${where}` : '') +
        ' กรุณาแก้ไขชื่อสถานีหรือระบุสายให้ต่างจากเดิม',
      conflictingStationId: clash?.id ?? null,
    })
  }

  // Dedupe guard: match on normalized (nameTh, mode, province) — case/whitespace
  // insensitive — regardless of responsibleAgency, since agency parsing drift
  // (e.g. an OTHER_AGENCY fallback) is what let same-station duplicates slip past the
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
    // region is derived, not user input (Session E4) — callers normally omit it; lat/lng are
    // always required here, so deriveRegion always has coordinates to work from.
    const region = dto.region?.trim() || deriveRegion({ lat: dto.lat, lng: dto.lng, province })
    // Part A.5 — '' (never null) is the deliberate "no line" sentinel; see schema.prisma.
    const line = dto.line?.trim() ?? ''
    try {
      const station = await this.prisma.station.create({
        data: { ...dto, nameTh, province, region, line, urgentIssues: [] },
      })
      return { station, deduped: false }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.describeIdentityConflict({ mode: dto.mode, nameTh, line })
      }
      throw err
    }
  }

  // Admin fix-up for name/classification/agency and, most importantly, location:
  // a manual lat/lng edit is how an APPROXIMATE (centroid) coordinate gets promoted
  // to a verified OK one so proximity checks work for that station. Both lat and lng
  // must be supplied together — a lone coordinate can't be trusted as a real fix.
  async update(id: string, dto: UpdateStationDto, adminId: string) {
    const before = await this.prisma.station.findUnique({ where: { id } })
    if (!before) throw new NotFoundException()

    const hasNewCoords = dto.lat !== undefined && dto.lng !== undefined
    // region is derived, not user input (Session E4): recompute it whenever coords or province
    // change, unless the caller explicitly supplies its own region (a deliberate override wins).
    const region = dto.region !== undefined
      ? dto.region.trim()
      : (hasNewCoords || dto.province !== undefined)
        ? deriveRegion({
            lat:      hasNewCoords ? dto.lat : before.lat,
            lng:      hasNewCoords ? dto.lng : before.lng,
            province: dto.province !== undefined ? dto.province.trim() : before.province,
          })
        : undefined
    // Part A.5 — '' (never null) is the deliberate "no line" sentinel; see schema.prisma.
    const line = dto.line !== undefined ? dto.line.trim() : undefined
    let after
    try {
      after = await this.prisma.station.update({
        where: { id },
        data: {
          ...(dto.nameTh             !== undefined && { nameTh: dto.nameTh.trim() }),
          ...(dto.mode               !== undefined && { mode: dto.mode }),
          ...(line                   !== undefined && { line }),
          ...(dto.railSubtype        !== undefined && { railSubtype: dto.railSubtype || null }),
          ...(dto.province           !== undefined && { province: dto.province.trim() }),
          ...(region                 !== undefined && { region }),
          ...(dto.responsibleAgency  !== undefined && { responsibleAgency: dto.responsibleAgency }),
          ...(hasNewCoords && {
            lat: dto.lat,
            lng: dto.lng,
            coordSource: 'MANUAL' as const,
            coordStatus: 'OK' as const,
          }),
        },
      })
    } catch (err) {
      // Part A.5 — the (mode, nameTh, line) identity collision. Reported against the values this
      // update was actually trying to land on (falling back to the row's current ones for fields
      // the caller didn't touch), so the message names the real clash.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.describeIdentityConflict({
          mode:   dto.mode   ?? before.mode,
          nameTh: dto.nameTh?.trim() ?? before.nameTh,
          line:   line       ?? before.line,
        })
      }
      throw err
    }

    await this.auditLog.log({
      userId: adminId, action: 'UPDATE', entityType: 'Station', entityId: id, before, after,
    })
    return after
  }

  // E-form redesign (Session E2, Part A) — auditor-editable build year, deliberately open to the
  // AUDITOR role (PM-confirmed: captured in the field, not master data) as well as ADMIN. Drives
  // era resolution for future checklists only (see @repo/types#resolveTemplateEras) — an
  // in-progress checklist's stamp never changes retroactively. Every change is audit-logged.
  //
  // 2026-08-05 — yearBuiltDate is an OPTIONAL exact-date refinement (ISO yyyy-mm-dd, Gregorian),
  // captured by the auditor only when they can find the real building-permit-application date.
  // Full-replace, same as yearBuilt itself (not a partial patch): omitting it clears any
  // previously-set date, so a corrected year never leaves a stale, now-inconsistent date behind.
  async updateYearBuilt(id: string, yearBuilt: number, userId: string, yearBuiltDate?: string | null) {
    if (!isValidYearBuilt(yearBuilt)) {
      throw new BadRequestException({ code: 'INVALID_YEAR_BUILT', message: 'ปี พ.ศ. ที่ก่อสร้างไม่ถูกต้อง' })
    }
    if (yearBuiltDate != null && !isValidYearBuiltDate(yearBuiltDate, yearBuilt)) {
      throw new BadRequestException({
        code: 'INVALID_YEAR_BUILT_DATE',
        message: 'วันที่ยื่นขออนุญาตก่อสร้างไม่ถูกต้อง หรือปี พ.ศ. ไม่ตรงกับปีที่ก่อสร้างที่ระบุ',
      })
    }
    const before = await this.prisma.station.findUnique({ where: { id } })
    if (!before) throw new NotFoundException()

    const after = await this.prisma.station.update({
      where: { id },
      data: { yearBuilt, yearBuiltDate: yearBuiltDate ? new Date(yearBuiltDate) : null },
    })

    await this.auditLog.log({
      userId, action: 'UPDATE_YEAR_BUILT', entityType: 'Station', entityId: id,
      before: { yearBuilt: before.yearBuilt, yearBuiltDate: before.yearBuiltDate },
      after: { yearBuilt: after.yearBuilt, yearBuiltDate: after.yearBuiltDate },
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

  // UDT-55 — admin/reviewer undoes an accidental approval. Sends the checklist back to
  // SUBMITTED (into the pending-review queue) so it can be re-decided; the auditor's data is
  // untouched. The score written on approve is dropped (mirrors unsubmitChecklist). The station's
  // denormalized score/status/lastInspected — which approveChecklist overwrote with no snapshot —
  // are recomputed from the previous latest-approved checklist, or reset to the schema defaults
  // when this was the only approved checklist.
  async revertApproval(stationId: string, checklistId: string) {
    const existing = await this.prisma.checklist.findFirst({ where: { id: checklistId, stationId } })
    if (!existing) throw new NotFoundException()
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('มีเพียงรายงานที่อนุมัติแล้วเท่านั้นที่สามารถยกเลิกการอนุมัติได้')
    }

    // Both writes (checklist status + station denorm reset) go through the tx client, and the
    // status is re-checked inside to close the race with a concurrent approve/revert — same
    // pattern approveChecklist/rejectChecklist use.
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.checklist.findFirst({ where: { id: checklistId, stationId } })
      if (!current || current.status !== 'APPROVED') {
        throw new BadRequestException('มีเพียงรายงานที่อนุมัติแล้วเท่านั้นที่สามารถยกเลิกการอนุมัติได้')
      }

      const cl = await tx.checklist.update({
        where: { id: checklistId, stationId },
        data: { status: 'SUBMITTED', score: null },
      })

      // Recompute the station denorm from the newest OTHER approved checklist for this station.
      const prevApproved = await tx.checklist.findFirst({
        where: { stationId, status: 'APPROVED', NOT: { id: checklistId } },
        orderBy: { submittedAt: 'desc' },
      })
      if (prevApproved) {
        const score  = computeScoreFromItems(prevApproved.items)
        const status = scoreToStatus(score)
        await tx.station.update({
          where: { id: stationId },
          data: { score, status, lastInspected: prevApproved.submittedAt },
        })
      } else {
        // No approved checklist remains — reset to the Station schema defaults.
        await tx.station.update({
          where: { id: stationId },
          data: { score: 0, status: 'ต้องปรับปรุง', lastInspected: null },
        })
      }
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
    // Session S3b, Part A.4 — a training checklist never rests at SUBMITTED (see
    // ChecklistsService.submit's training branch), but isTraining:false is kept here explicitly
    // rather than relying on that alone, matching every other review-queue-shaped query.
    const rows = await this.prisma.checklist.findMany({
      where: { status: 'SUBMITTED', isTraining: false },
      select: { stationId: true },
      distinct: ['stationId'],
    })
    return rows.map(r => r.stationId)
  }

  // Station masterlist cutover, import hardening (Task B3): the masterlist is closed. This
  // method may UPDATE a masterlist station's metadata/checklists but must NEVER insert a new
  // Station row — every incoming row is resolved against the masterlist via resolveStationMatch
  // (exact -> normalized -> fuzzy, scoped within mode). REVIEW/NOT_ON_MASTERLIST rows are
  // skipped (never an error that aborts the run) and recorded in a reconciliation CSV a human
  // reviews afterward (see import-reconciliation.ts, prisma/apply-import-review.ts).
  //
  // Rows are processed in fixed-size chunks: each chunk gets ONE station.findMany (every
  // masterlist station of the modes present in this chunk — the resolveStationMatch candidate
  // pool) + ONE checklist.findMany, and each ROW's writes run inside their own $transaction —
  // one bad row rolls back only itself and is reported individually, never poisoning the rest
  // of the chunk/batch.
  async batchOtpImport(rows: OtpRowDto[], adminId: string): Promise<OtpImportRowResult[]> {
    const results: OtpImportRowResult[] = new Array(rows.length)
    const reconciliation: ReconciliationRow[] = []
    const pendingPayloads: Array<{ index: number; row: OtpRowDto }> = []

    for (let chunkStart = 0; chunkStart < rows.length; chunkStart += OTP_IMPORT_CHUNK_SIZE) {
      const chunk = rows.slice(chunkStart, chunkStart + OTP_IMPORT_CHUNK_SIZE)
      const modesInChunk = [...new Set(chunk.map(row => row.station.mode))]

      const masterlistStations = await this.prisma.station.findMany({
        where: { mode: { in: modesInChunk } },
        select: { id: true, mode: true, nameTh: true, line: true, responsibleAgency: true, lastInspected: true },
      })
      const candidatesByMode = new Map<string, MasterlistStation[]>()
      for (const s of masterlistStations) {
        const arr = candidatesByMode.get(s.mode) ?? []
        arr.push(s)
        candidatesByMode.set(s.mode, arr)
      }
      const stationById = new Map(masterlistStations.map(s => [s.id, s]))

      const stationIds = masterlistStations.map(s => s.id)
      const existingChecklists = stationIds.length
        ? await this.prisma.checklist.findMany({
            where: { stationId: { in: stationIds }, status: 'APPROVED' },
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
        const nameTh = row.station.nameTh.trim()
        const match = resolveStationMatch(
          { mode: row.station.mode, nameTh },
          candidatesByMode.get(row.station.mode) ?? [],
        )
        reconciliation.push({
          index: rowIndex, nameTh, mode: row.station.mode, line: '',
          tier: match.tier, status: match.status,
          matchedStationId: match.matchedStation?.id ?? null, score: match.score,
        })

        if (match.status === 'REVIEW' || match.status === 'NOT_ON_MASTERLIST') {
          results[rowIndex] = { nameTh, index: rowIndex, skipped: true, reason: match.status }
          pendingPayloads.push({ index: rowIndex, row })
          continue
        }

        try {
          const station = stationById.get(match.matchedStation!.id)!
          results[rowIndex] = await this.importOtpRow(row, adminId, station, checklistMap)
        } catch (err) {
          results[rowIndex] = {
            nameTh: row.station.nameTh,
            index:  rowIndex,
            error:  err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ',
          }
        }
      }
    }

    if (reconciliation.length > 0) {
      writeReconciliationCsv('batch-otp', reconciliation, IMPORT_REPORTS_DIR)
    }
    if (pendingPayloads.length > 0) {
      writePendingPayloads('batch-otp', pendingPayloads, IMPORT_REPORTS_DIR)
    }

    return results
  }

  // One row's writes (checklist create/update, station metadata/score refresh) as a single
  // transaction. `station` is an already-resolved masterlist row (see resolveStationMatch in
  // batchOtpImport above) — this method never creates a Station.
  private async importOtpRow(
    row: OtpRowDto,
    adminId: string,
    station: { id: string; nameTh: string; responsibleAgency: string; lastInspected: Date | null },
    checklistMap: Map<string, { id: string; stationId: string; submittedAt: Date | null }>,
  ): Promise<{ id: string; nameTh: string }> {
    const auditDate = new Date(row.lastInspected)
    const checklistKey = `${station.id}|${auditDate.getFullYear()}`
    const existing = checklistMap.get(checklistKey)

    const result = await this.prisma.$transaction(async (tx) => {
      return applyOtpRowToStation(tx, station, row, adminId, existing)
    })

    if (!existing) {
      // Keep the in-memory map current for any LATER row in this batch targeting the same
      // (station, year) — mirrors the pre-cutover behavior for duplicate rows in one payload.
      checklistMap.set(checklistKey, { id: 'pending', stationId: station.id, submittedAt: auditDate })
    }

    await this.auditLog.log({
      userId: adminId, action: 'OTP_IMPORT', entityType: 'Station', entityId: station.id,
    })
    return result
  }

  // Export data source: one row per (station, calendar year) — the most recently
  // submitted APPROVED checklist wins if more than one exists for the same year.
  // Reused by both the "all stations" and per-station export routes so there is
  // exactly one code path pulling real assessment results for exports.
  async findAllForExport(stationId?: string) {
    // Session S3b, Part A.4 — training checklists finalize straight to APPROVED (see
    // ChecklistsService.submit) but must never appear in an export.
    const checklists = await this.prisma.checklist.findMany({
      where: { status: 'APPROVED', isTraining: false, ...(stationId && { stationId }) },
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
      ...(filters.region            && {
        region: filters.region === UNSPECIFIED_REGION ? null : filters.region,
      }),
      ...(filters.province          && { province:          filters.province }),
      ...(filters.responsibleAgency && agencyWhere(filters.responsibleAgency)),
      // Session S3b, Part A.4 — training fixtures never count toward real facility metrics.
      isTraining: false,
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
    const failingStations: { id: string; nameTh: string; province: string | null }[] = []
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
        const found = findItemInGroups(groups, filters.subItem)
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
      // Session S3b, Part A.4 — training fixtures never appear on the heatmap/map.
      where: { isTraining: false },
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
    // Session S3b, Part A.4 — training fixtures never count toward the KPI cards.
    const [total, passing, needsImprovement, failing] = await Promise.all([
      this.prisma.station.count({ where: { isTraining: false } }),
      this.prisma.station.count({ where: { status: 'ผ่านมาตรฐาน', isTraining: false } }),
      this.prisma.station.count({ where: { status: 'ต้องปรับปรุง', isTraining: false } }),
      this.prisma.station.count({ where: { status: 'ไม่ผ่าน', isTraining: false } }),
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
