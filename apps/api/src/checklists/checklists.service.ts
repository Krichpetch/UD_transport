import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ChecklistStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { StationsService } from '../stations/stations.service'
import { AuditLogService } from '../audit/audit.service'
import { MinioService } from '../minio/minio.service'
import { isProximityBypassActive } from '../config/validate-env'
import { computeScoreFromItems } from './scoring'
import {
  parseChecklistItems,
  ChecklistItemsParseError,
  resolveTemplateEras,
  markApplicability,
  resolveVariantKey,
  STANDARD_VARIANT_KEY,
  walkTemplateLeaves,
  computeStoredProgress,
  type ChecklistTemplateDefinition,
  type TemplateNode,
  type ParsedChecklistGroup,
  type StoredChecklistNode,
  type TransportMode,
} from '@repo/types'

// Prisma's Json columns want InputJsonValue; `items` arrives already structurally validated by
// validateItemsPayload (parseChecklistItems) below — this is a single named bridge for the
// TS/Prisma interop gap, never a blind cast of unvalidated input.
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

// 2026-08-05 — era-resolution.ts's date-aware comparison (isLawInForce) works in ISO yyyy-mm-dd
// strings; Prisma reads/writes a real Date object for a @db.Date column. One narrow conversion
// point rather than scattering .toISOString().slice(0, 10) across every call site below.
function toIsoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

const PROXIMITY_RADIUS_M = 1000
// Part C — explicit size bound on the items payload, rather than relying solely on the global
// 10mb body cap (main.ts) which is shared across every route.
const MAX_ITEMS_JSON_BYTES = 512 * 1024
// Session E3, Part C.1 — hard cap enforced server-side; the upload UI disables adding past this
// too, but client trust is not enforcement (a direct API call must be rejected the same way).
const MAX_PHOTOS_PER_ITEM = 5
// Statuses an AUDITOR may still edit their own submission's evidence photos on — DRAFT (still
// filling the form) and REJECTED (returned for fixes, Session E3 Part B). Never SUBMITTED/
// APPROVED — those are the record of what was actually reviewed.
const PHOTO_EDITABLE_STATUSES = ['DRAFT', 'REJECTED'] as const

export interface SubmitGps {
  lat: number
  lng: number
  accuracy?: number
}

@Injectable()
export class ChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stations: StationsService,
    private readonly auditLog: AuditLogService,
    private readonly minio: MinioService,
  ) {}

  async findDraft(stationId: string, auditorId: string) {
    const cl = await this.prisma.checklist.findFirst({
      where: { stationId, auditorId, status: ChecklistStatus.DRAFT },
    })
    if (!cl) return null
    return { ...cl, items: await this.refreshPhotoUrls(cl.items) }
  }

  async findLatest(stationId: string) {
    const cl = await this.prisma.checklist.findFirst({
      where: { stationId, status: { in: [ChecklistStatus.SUBMITTED, ChecklistStatus.APPROVED, ChecklistStatus.REJECTED] } },
      orderBy: { submittedAt: 'desc' },
      include: { auditor: { select: { username: true } } },
    })
    if (!cl) return null
    const { auditor, ...rest } = cl
    return {
      ...rest,
      items: await this.refreshPhotoUrls(rest.items),
      auditorUsername: auditor?.username ?? null,
      respondsToChecklistId: await this.findResubmitSource(cl.id),
    }
  }

  async findAll(stationId: string) {
    const rows = await this.prisma.checklist.findMany({
      where: { stationId },
      orderBy: { createdAt: 'desc' },
      include: { auditor: { select: { id: true, username: true } } },
    })
    return Promise.all(rows.map(async (cl) => ({ ...cl, items: await this.refreshPhotoUrls(cl.items) })))
  }

  // Part E (W2-S1) — paginated variant for the admin station-detail History tab. A separate
  // method from findAll() above on purpose: findAll's existing callers (the resubmission
  // marker, the stations-list approve button's flag check) need to scan the FULL history for a
  // specific row, not a page of it — paginating that endpoint's default behavior would silently
  // break those lookups once a station accumulates enough checklists. Same envelope shape
  // StationsService.findAll already returns for the stations list.
  async findAllPaginated(stationId: string, page: number, limit: number) {
    const [total, rows] = await Promise.all([
      this.prisma.checklist.count({ where: { stationId } }),
      this.prisma.checklist.findMany({
        where: { stationId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          auditor: { select: { id: true, username: true } },
          template: { select: { variantKey: true } },
        },
      }),
    ])
    const data = await Promise.all(rows.map(async (cl) => ({ ...cl, items: await this.refreshPhotoUrls(cl.items) })))
    return { data, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) }
  }

  // Session E3, Part C.4 — every photo read path re-presigns the GET URL fresh rather than
  // trusting the `url` baked into the stored ChecklistPhoto at upload time. Root cause of the
  // "revisit preview" bug: MinioService.getPresignedUrl expires in 1 hour by default, and that
  // one-shot URL was being persisted verbatim into Checklist.items forever — any photo viewed more
  // than an hour after upload (i.e. essentially every SENT checklist reopened later) 404'd. The
  // object KEY is what's actually stable (ChecklistPhoto.id, set at upload time in
  // uploads.controller.ts) — this re-derives the URL from that key on every read, never from the
  // stored url. Defensive against malformed/legacy rows (optional chaining throughout, never
  // throws) since this runs on every checklist read, including pre-existing pilot data.
  private async refreshPhotoUrls(items: unknown): Promise<unknown> {
    if (!Array.isArray(items)) return items
    const groups = items as Record<string, unknown>[]

    const photoIds = new Set<string>()
    const collect = (nodes: unknown): void => {
      if (!Array.isArray(nodes)) return
      for (const raw of nodes) {
        const n = raw as Record<string, unknown>
        if (Array.isArray(n?.photos)) {
          for (const p of n.photos as Record<string, unknown>[]) {
            if (typeof p?.id === 'string') photoIds.add(p.id)
          }
        }
        if (Array.isArray(n?.subItems)) collect(n.subItems)
      }
    }
    for (const g of groups) collect(g?.items)
    if (photoIds.size === 0) return items

    const freshUrls = new Map<string, string>()
    await Promise.all([...photoIds].map(async (id) => {
      try {
        freshUrls.set(id, await this.minio.getPresignedUrl(id))
      } catch {
        // Leave this photo's stale stored url in place rather than failing the whole read —
        // one bad/missing object must never take down the checklist view.
      }
    }))

    const rewriteNodes = (nodes: unknown): unknown => {
      if (!Array.isArray(nodes)) return nodes
      return nodes.map((raw) => {
        const n = raw as Record<string, unknown>
        const patch: Record<string, unknown> = {}
        if (Array.isArray(n?.photos)) {
          patch.photos = (n.photos as Record<string, unknown>[]).map((p) =>
            typeof p?.id === 'string' && freshUrls.has(p.id) ? { ...p, url: freshUrls.get(p.id) } : p,
          )
        }
        if (Array.isArray(n?.subItems)) patch.subItems = rewriteNodes(n.subItems)
        return { ...n, ...patch }
      })
    }

    return groups.map((g) => (Array.isArray(g?.items) ? { ...g, items: rewriteNodes(g.items) } : g))
  }

  // E-form redesign (Part A.4; Session E3, Part A) — the mode's current ACTIVE template for this
  // station's variant (mode + railSubtype -> variantKey, see @repo/types#resolveVariantKey). Used
  // both to stamp new checklists at creation and to structurally validate incoming items against
  // real codes (Part B/C). Falls back to the mode's 'standard' ACTIVE template when no ACTIVE row
  // exists for the resolved variant — today that's every rail station, since only the v1 parity
  // anchor (variantKey='standard') is ever ACTIVE; a variant-specific row only takes over once one
  // is actually activated (out of scope this session — see Part A's decision note). Returns null
  // if no ACTIVE template exists at all yet (e.g. seed-templates.ts hasn't run) — callers degrade
  // gracefully rather than blocking submission on template metadata being present.
  //
  // Session S3b, Part A.3 — training stations resolve through this SAME method, with no
  // special-casing: a tutorial always gets whatever template is currently ACTIVE for its
  // (mode, railSubtype), never a hardcoded version. Today that's v1 everywhere; the moment a v2/
  // v3 variant is activated for a mode, every tutorial of that type switches to it automatically,
  // same as every real audit does.
  private async getActiveTemplate(mode: string, railSubtype?: string | null) {
    const { variantKey } = resolveVariantKey(mode as TransportMode, railSubtype)
    if (variantKey !== STANDARD_VARIANT_KEY) {
      const variant = await this.prisma.checklistTemplate.findFirst({
        where: { mode, variantKey, status: 'ACTIVE' },
      })
      if (variant) return variant
    }
    return this.prisma.checklistTemplate.findFirst({
      where: { mode, variantKey: STANDARD_VARIANT_KEY, status: 'ACTIVE' },
    })
  }

  // E-form redesign (Session E2, Part A) — resolves a template's byLaw-varying measurements
  // against a build year, once, so both the score re-derivation and the appliedLawRefs stamp
  // come from the exact same resolution (never two separate passes that could disagree).
  // `templateDef` may be undefined (no ACTIVE template yet) — degrades to an empty stamp,
  // matching every other getActiveTemplate() call site's graceful-degradation convention.
  //
  // 2026-08-05 — `buildDate` (ISO yyyy-mm-dd, Gregorian) is the optional exact-date refinement;
  // passed straight through to markApplicability/resolveTemplateEras, which fall back to the
  // pre-existing year-only comparison whenever it's absent (the overwhelmingly common case).
  private resolveEraStamp(templateDef: ChecklistTemplateDefinition | undefined, yearBuilt: number | null, buildDate?: string | null) {
    if (!templateDef) {
      return { resolvedDef: undefined, appliedYearBuilt: yearBuilt, appliedYearBuiltDate: buildDate ?? null, appliedLawRefs: null as Record<string, string> | null }
    }
    // Part C — item redaction marked BEFORE value resolution, same ordering/schemaVersion gate as
    // getTemplateForAudit, so submit's score/persisted-flags and the audit-time template the
    // auditor actually saw always agree on which leaves applied.
    const marked = templateDef.schemaVersion === 1 ? templateDef : markApplicability(templateDef, yearBuilt, undefined, buildDate)
    const { resolved, appliedLawRefs } = resolveTemplateEras(marked, yearBuilt, undefined, buildDate)
    return {
      resolvedDef: resolved,
      appliedYearBuilt: yearBuilt,
      appliedYearBuiltDate: buildDate ?? null,
      appliedLawRefs: Object.keys(appliedLawRefs).length > 0 ? appliedLawRefs : null,
    }
  }

  // Part C.4/C.5 — bakes each leaf's applicable:false (already resolved onto resolvedDef by
  // resolveEraStamp above, keyed by code) onto the matching STORED node once, at submit time,
  // using the checklist's own frozen appliedYearBuilt/resolvedDef. Frozen forever after: scoring
  // never needs a template lookup again to know whether a stored leaf counts (see
  // StoredChecklistNode.applicable's doc) — this is also what makes cross-checklist aggregation
  // (dashboards summing many checklists' items) correct without threading yearBuilt through every
  // scoring call site.
  private applyRedactionFlags(groups: ParsedChecklistGroup[], resolvedDef: ChecklistTemplateDefinition): ParsedChecklistGroup[] {
    const leafIndex = new Map<string, TemplateNode>()
    for (const leaf of walkTemplateLeaves(resolvedDef)) leafIndex.set(leaf.code, leaf)
    const tagNode = (n: StoredChecklistNode): StoredChecklistNode => ({
      ...n,
      ...(leafIndex.get(n.id)?.applicable === false ? { applicable: false } : {}),
      ...(n.subItems ? { subItems: n.subItems.map(tagNode) } : {}),
    })
    return groups.map((g) => ({ ...g, items: g.items.map(tagNode) }))
  }

  // Part A.6 — GET template-for-audit: returns the mode's ACTIVE template with every byLaw value
  // already resolved to a flat value (the client never sees or picks between eras). Resolves
  // against an in-progress DRAFT's own stamp when one exists (an audit already underway must not
  // have its thresholds shift under it if the station's yearBuilt is corrected later — see
  // Checklist.appliedYearBuilt doc); otherwise resolves live against the station's current
  // yearBuilt, since no stamp exists yet.
  //
  // `preview` (Part B.2, admin/dev-only — the controller only honors this for ADMIN callers)
  // skips draft hydration for read-only rendering support ONLY — no real checklist is ever
  // created or submitted against a preview; saveDraft/submit always stamp/validate against the
  // ACTIVE template. `versionOverride` (admin station-list "preview" button, Session E4) lets the
  // caller pin a specific template version (e.g. an un-activated v3 DRAFT) instead of whatever is
  // currently ACTIVE — with no override, preview renders the ACTIVE template, same as a real audit.
  // `yearBuiltOverride` (Session F1 follow-up) — ADMIN preview-only (controller rejects it outside
  // `preview` mode): lets the admin pick any build year to see era redaction/value resolution
  // react live, WITHOUT touching the real station's yearBuilt or writing anything anywhere — this
  // is purely a resolution-input substitution for one read, never persisted. `buildDateOverride`
  // (2026-08-05, ISO yyyy-mm-dd Gregorian) is its exact-date companion — lets an admin preview the
  // two same-Buddhist-year law cutovers (PSD_2555 vs MOT_2556, both พ.ศ. 2556) separately; same
  // preview-only, never-persisted contract as yearBuiltOverride.
  async getTemplateForAudit(stationId: string, auditorId: string, preview?: boolean, versionOverride?: number, yearBuiltOverride?: number, buildDateOverride?: string) {
    const station = await this.stations.findOne(stationId)
    const template = versionOverride != null
      ? await this.prisma.checklistTemplate.findFirst({
          where: { mode: station.mode, variantKey: resolveVariantKey(station.mode as TransportMode, station.railSubtype).variantKey, version: versionOverride },
        })
      : await this.getActiveTemplate(station.mode, station.railSubtype)
    if (!template) return { template: null, templateId: null, templateVersion: null, appliedYearBuilt: station.yearBuilt, appliedLawRefs: null, eraUnresolved: false, preview: !!preview }

    const draft = preview ? null : await this.prisma.checklist.findFirst({ where: { stationId, auditorId, status: 'DRAFT' } })
    const yearBuilt = preview && yearBuiltOverride != null ? yearBuiltOverride : (draft?.appliedYearBuilt ?? station.yearBuilt ?? null)
    const buildDate = preview && yearBuiltOverride != null
      ? (buildDateOverride ?? null)
      : (draft ? toIsoDate(draft.appliedYearBuiltDate) : toIsoDate(station.yearBuiltDate))
    const templateDef = template.definition as unknown as ChecklistTemplateDefinition
    // Item redaction (Session F1, Part C) BEFORE value resolution: a criterion the build year
    // predates is flagged applicable:false rather than removed (see @repo/types#markApplicability —
    // supersedes the older delete-based filterApplicableItems for THIS endpoint; the client stays
    // dumb and renders the flagged items as a collapsed footer note, never an answerable row).
    // Scope is v2/v3 templates only (Part C.2) — v1 live forms render full and unfiltered, gated
    // here by schemaVersion rather than relying on v1 templates simply never carrying lawRefs tags.
    const marked = templateDef.schemaVersion === 1 ? templateDef : markApplicability(templateDef, yearBuilt, undefined, buildDate)
    const { resolved, appliedLawRefs, eraUnresolved } = resolveTemplateEras(marked, yearBuilt, undefined, buildDate)

    return {
      template: resolved,
      templateId: template.id,
      templateVersion: template.version,
      appliedYearBuilt: yearBuilt,
      appliedYearBuiltDate: buildDate,
      appliedLawRefs: Object.keys(appliedLawRefs).length > 0 ? appliedLawRefs : null,
      eraUnresolved,
      preview: !!preview,
    }
  }

  // Part C — size-bounds the payload explicitly, then runs it through @repo/types'
  // parseChecklistItems (Part B), the single structural validator for both v1 and v2 shapes.
  // A thrown ChecklistItemsParseError becomes a 400 naming the offending path/code; `templateDef`
  // is omitted when no ACTIVE template was found, in which case only shape (not code identity)
  // is checked — same graceful-degradation as getActiveTemplate above.
  private validateItemsPayload(items: unknown, templateDef?: ChecklistTemplateDefinition): ParsedChecklistGroup[] {
    const json = JSON.stringify(items ?? null)
    if (Buffer.byteLength(json, 'utf-8') > MAX_ITEMS_JSON_BYTES) {
      throw new BadRequestException({ code: 'ITEMS_TOO_LARGE', message: 'ข้อมูลรายการตรวจสอบมีขนาดใหญ่เกินไป' })
    }
    let groups: ParsedChecklistGroup[]
    try {
      groups = parseChecklistItems(items, templateDef)
    } catch (err) {
      if (err instanceof ChecklistItemsParseError) {
        // err.message is "{path}: {description}" and the description names the offending code
        // value itself (e.g. `unknown item code "A1.99" for this template`) — err.path alone is
        // only the structural path, not the code, so the full message is what the 400 must carry.
        throw new BadRequestException({ code: 'INVALID_ITEMS', message: `รูปแบบข้อมูลรายการตรวจสอบไม่ถูกต้อง: ${err.message}`, path: err.path })
      }
      throw err
    }
    this.assertPhotoLimits(groups)
    return groups
  }

  // Session E3, Part C.1 — server-side enforcement of the 5-photos-per-item cap. The upload UI
  // disables adding past this too, but that's UX only; a direct draft/submit call with more than
  // 5 photos on one item must still be rejected here.
  private assertPhotoLimits(groups: ParsedChecklistGroup[]): void {
    const visit = (nodes: StoredChecklistNode[]): void => {
      for (const n of nodes) {
        if (n.photos && n.photos.length > MAX_PHOTOS_PER_ITEM) {
          throw new BadRequestException({
            code: 'PHOTOS_LIMIT_EXCEEDED',
            message: `รายการ ${n.id} มีรูปภาพเกิน ${MAX_PHOTOS_PER_ITEM} รูป`,
            itemId: n.id,
          })
        }
        if (n.subItems) visit(n.subItems)
      }
    }
    for (const g of groups) visit(g.items)
  }

  // Session F1, Part B.2 — server-side guarantee behind the auditor's client-side confirm-to-start
  // lock (Part B.1): a checklist is never CREATED (fresh DRAFT or a direct SUBMITTED with no prior
  // draft) without a resolvable build year, since that year is what era resolution (Part C) and
  // era-value resolution (Session E2) both key off — an unstamped checklist would resolve
  // provisionally forever with no way to correct it after the fact (stamps are frozen, never
  // recomputed). Never checked when reusing an EXISTING draft/stamp — that checklist was already
  // created under this same gate, so its stamp is guaranteed non-null already.
  private assertYearBuiltPresent(yearBuilt: number | null | undefined): void {
    if (yearBuilt == null) {
      throw new BadRequestException({
        code: 'YEAR_BUILT_REQUIRED',
        message: 'ต้องระบุปีที่ก่อสร้างของสถานีก่อนเริ่มบันทึกการตรวจสอบ',
      })
    }
  }

  // Part D — one DRAFT per (stationId, auditorId), enforced by a partial unique index (see
  // migrations/*_checklist_draft_submit_uniqueness — Prisma's schema DSL can't declare a
  // WHERE-scoped unique constraint, so it isn't visible to `.upsert()`). This does a plain
  // find-then-create/update like before, but a concurrent double-create now loses cleanly via
  // the real DB constraint (P2002) instead of racing on a read-then-write check — the loser
  // falls back to updating the row the winner just created.
  //
  // Session F3, Part H.1 — CREATING a draft is "starting an inspection", so it now runs the
  // proximity gate (see runProximityGate). UPDATING an existing draft is deliberately ungated:
  // once started on-site, the auditor may keep working — and autosaving — from anywhere.
  async saveDraft(stationId: string, auditorId: string, items: unknown, finalThoughts?: string, gps?: SubmitGps) {
    const station = await this.stations.findOne(stationId)
    const template = await this.getActiveTemplate(station.mode, station.railSubtype)
    this.validateItemsPayload(items, template?.definition as ChecklistTemplateDefinition | undefined)

    const existing = await this.prisma.checklist.findFirst({
      where: { stationId, auditorId, status: 'DRAFT' },
    })
    // Part H.1 — gate BEFORE the year-built assertion has any side effect, and only on creation.
    // Both are start-time preconditions; order between them is not significant, but the gate must
    // never run on the update path.
    const startGate = existing ? null : await this.runProximityGate(station, gps)
    if (!existing) this.assertYearBuiltPresent(station.yearBuilt)

    let checklist
    if (existing) {
      checklist = await this.prisma.checklist.update({
        where: { id: existing.id },
        // Part D — drafts persist finalThoughts too (cold-reload resume restores it); undefined
        // (field omitted from the request) leaves the stored value untouched rather than nulling
        // it out on every autosave tick that doesn't happen to include it.
        data: { items: toJson(items), ...(finalThoughts !== undefined && { finalThoughts }), updatedAt: new Date() },
      })
    } else {
      // Stamped once at creation and never touched again — see Checklist.templateId /
      // appliedYearBuilt doc. Meaningful even with no ACTIVE template (appliedYearBuilt alone).
      const { appliedYearBuilt, appliedYearBuiltDate, appliedLawRefs } = this.resolveEraStamp(
        template?.definition as ChecklistTemplateDefinition | undefined,
        station.yearBuilt,
        toIsoDate(station.yearBuiltDate),
      )
      try {
        checklist = await this.prisma.checklist.create({
          data: {
            stationId,
            auditorId,
            items: toJson(items),
            status: 'DRAFT',
            // Stamped once at creation and never touched again — see Checklist.templateId doc.
            templateId: template?.id,
            templateVersion: template?.version,
            appliedYearBuilt,
            appliedYearBuiltDate: appliedYearBuiltDate ? new Date(appliedYearBuiltDate) : null,
            appliedLawRefs: appliedLawRefs === null ? Prisma.JsonNull : toJson(appliedLawRefs),
            finalThoughts: finalThoughts ?? null,
            // Session F3, Part H.3 — the start-time GPS audit trail, stamped once here. This
            // draft's creation is the moment presence at the station was actually proven.
            ...(startGate ? this.startGpsColumns(startGate, gps) : {}),
            // Part A — stamped from the station at creation, never recomputed (see schema doc).
            isTraining: station.isTraining,
          },
        })
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const winner = await this.prisma.checklist.findFirstOrThrow({ where: { stationId, auditorId, status: 'DRAFT' } })
          checklist = await this.prisma.checklist.update({
            where: { id: winner.id },
            data: { items: toJson(items), ...(finalThoughts !== undefined && { finalThoughts }), updatedAt: new Date() },
          })
        } else {
          throw err
        }
      }
    }

    // Session F3, Part H.5 — a distinct START event, logged only on creation and carrying the
    // measured distance. This is what an admin reads to answer "was this auditor actually at the
    // station when they started?" after the fact — SAVE_DRAFT fires on every autosave tick and
    // says nothing about location, so it can't answer that question.
    if (startGate) {
      await this.auditLog.log({
        userId: auditorId,
        action: 'START_CHECKLIST',
        entityType: 'Checklist',
        entityId: checklist.id,
        after: {
          stationId,
          distanceM:         startGate.distanceM,
          locationVerified:  startGate.locationVerified,
          proximityBypassed: startGate.bypassAllowed,
        },
      })
    }

    await this.auditLog.log({
      userId: auditorId,
      action: 'SAVE_DRAFT',
      entityType: 'Checklist',
      entityId: checklist.id,
      after: { stationId, status: 'DRAFT' },
    })
    return checklist
  }

  // ── Proximity gate (Session F3, Part H — gates the START, not the submit) ──────────────────
  //
  // สนข. 2026-08-03: an inspection may only be STARTED at the station, but once started it lives
  // in a DRAFT that can be finished and submitted from anywhere ("เน้นวัดๆไปก่อนแล้วค่อยมาเพิ่มรูป
  // ทีหลัง"). So this ladder now runs on the two paths that CREATE a checklist row —
  // saveDraft()'s create branch and a submit() with no prior draft — and on nothing else.
  // Updating an existing draft, and submitting one, are deliberately ungated.
  //
  // Every rung is preserved exactly as it was in submit() before F3:
  //   - training station: skipped entirely (Station.isTraining, server-side, never a client flag).
  //     locationVerified stays null so a training row is visibly distinct from a real
  //     "gate ran, coords unverified" case.
  //   - dev/staging bypass: a server-side env switch (APP_ENV + PROXIMITY_BYPASS), never a
  //     client-supplied flag — isProximityBypassActive() is the sole authority and is itself
  //     fail-closed in production (see validateEnv). Any bypassRequested the client sends is
  //     ignored outright. Genuinely unverified: bypass skips the check, it doesn't fake a pass.
  //   - coordStatus!=OK station (APPROXIMATE/PENDING): can't be distance-gated (coords may be
  //     tens of km off) — allowed through with locationVerified=false so the app can still show
  //     an "unverified location" warning.
  //   - coordStatus=OK station: GPS required, and must be within PROXIMITY_RADIUS_M.
  //
  // Distance is always recomputed server-side; a client "isNear" flag is never trusted.
  // Throws (403 LOCATION_REQUIRED / 400 OUT_OF_RANGE) exactly as submit() used to.
  private async runProximityGate(
    station: { id: string; isTraining: boolean; coordStatus: string },
    gps: SubmitGps | undefined,
  ): Promise<{ distanceM: number | null; locationVerified: boolean | null; bypassAllowed: boolean }> {
    const bypassAllowed = isProximityBypassActive()

    if (station.isTraining) return { distanceM: null, locationVerified: null, bypassAllowed }
    if (bypassAllowed)      return { distanceM: null, locationVerified: false, bypassAllowed }
    if (station.coordStatus !== 'OK') return { distanceM: null, locationVerified: false, bypassAllowed }

    if (gps?.lat == null || gps?.lng == null) {
      throw new ForbiddenException({
        code: 'LOCATION_REQUIRED',
        message: 'ต้องเปิดใช้งาน GPS เพื่อเริ่มการตรวจประเมิน',
      })
    }
    const distanceM = await this.stations.distanceToStationMeters(station.id, gps.lat, gps.lng)
    if (distanceM === null || distanceM > PROXIMITY_RADIUS_M) {
      throw new BadRequestException({
        code: 'OUT_OF_RANGE',
        message: 'คุณอยู่นอกพื้นที่สถานี ไม่สามารถเริ่มการตรวจประเมินได้',
        distanceM,
      })
    }
    return { distanceM, locationVerified: true, bypassAllowed }
  }

  // Part H.3/H.5 — the start-time audit trail. Columns are stamped once at creation and never
  // touched again (see schema.prisma), and the same distance is written to AuditLog so an admin
  // can answer "was this auditor actually at the station when they started?" without reading the
  // checklist row itself.
  private startGpsColumns(
    gate: { distanceM: number | null; locationVerified: boolean | null; bypassAllowed: boolean },
    gps: SubmitGps | undefined,
  ) {
    return {
      startGpsLat:            gps?.lat ?? null,
      startGpsLng:            gps?.lng ?? null,
      startGpsAccuracy:       gps?.accuracy ?? null,
      startGpsDistanceM:      gate.distanceM,
      startLocationVerified:  gate.locationVerified,
      startProximityBypassed: gate.bypassAllowed,
    }
  }

  async submit(
    stationId: string,
    auditorId: string,
    items: unknown,
    _clientScore?: number,
    gps?: SubmitGps,
    finalThoughts?: string,
  ) {
    const station = await this.stations.findOne(stationId)
    const template = await this.getActiveTemplate(station.mode, station.railSubtype)
    const templateDef = template?.definition as ChecklistTemplateDefinition | undefined
    const parsedGroups = this.validateItemsPayload(items, templateDef)

    // Reuse the auditor's in-progress DRAFT's era stamp when one exists — that's the resolution
    // the auditor was actually answering against (via GET template-for-audit) while filling the
    // form; a direct submit with no prior draft stamps fresh from the station's yearBuilt now.
    // Either way this is the ONE resolution used for both the stamp and the auto-graded score
    // below — never two separate passes that could disagree (Part A.6/A.7).
    const existingDraft = await this.prisma.checklist.findFirst({ where: { stationId, auditorId, status: 'DRAFT' } })
    // Part B.2 — same gate as saveDraft, checked against whichever stamp this submit will
    // actually use (the existing draft's frozen stamp, or the station's current year when
    // submitting fresh with no prior draft).
    this.assertYearBuiltPresent(existingDraft?.appliedYearBuilt ?? station.yearBuilt)
    const { resolvedDef, appliedYearBuilt, appliedYearBuiltDate, appliedLawRefs } = this.resolveEraStamp(
      templateDef,
      existingDraft?.appliedYearBuilt ?? station.yearBuilt,
      existingDraft ? toIsoDate(existingDraft.appliedYearBuiltDate) : toIsoDate(station.yearBuiltDate),
    )

    // Part C.4/C.5 — bake redaction flags onto the STORED items ONCE here, using this checklist's
    // own frozen stamp, never trusting whatever (if anything) the client already set. Persisted
    // this way (not just used transiently for scoring) so a later admin/dashboard read never needs
    // to re-resolve era/law data to know which leaves counted — see applyRedactionFlags's doc.
    const taggedGroups = resolvedDef && resolvedDef.schemaVersion !== 1
      ? this.applyRedactionFlags(parsedGroups, resolvedDef)
      : parsedGroups

    // Session F3, Part H.1/H.2 — the proximity gate runs ONLY when this submit is also a START,
    // i.e. there is no prior DRAFT for this (station, auditor). That path genuinely can create an
    // inspection from nothing, so it is gated exactly as draft creation is.
    //
    // When a draft DOES exist, the gate has already run (at draft creation) and this submit is
    // deliberately ungated — that is the whole point of the change: work started on-site may be
    // finished and submitted from anywhere.
    //
    // Submit-time GPS is still recorded whenever the client supplies it (below), but it is no
    // longer a gate and no longer proves presence — see the schema doc on startGps*.
    const isStart = !existingDraft
    const startGate = isStart
      ? await this.runProximityGate(station, gps)
      : null

    // Submit-time distance is computed for the audit trail only, never to reject. Skipped for
    // training rows and when no GPS was offered, matching the pre-F3 "nothing to record" cases.
    let distanceM: number | null = startGate?.distanceM ?? null
    if (!isStart && !station.isTraining && gps?.lat != null && gps?.lng != null) {
      distanceM = await this.stations.distanceToStationMeters(stationId, gps.lat, gps.lng)
    }
    const bypassAllowed = startGate?.bypassAllowed ?? isProximityBypassActive()
    // Preserves the pre-F3 semantics of this column: whether the SUBMIT-time reading was verified.
    // For a resumed draft nothing was verified at submit time, which is exactly the honest answer.
    const locationVerified: boolean | null = station.isTraining
      ? null
      : startGate
        ? startGate.locationVerified
        : false

    // Re-derive score server-side; never trust the client-supplied value. Passing the ERA-
    // RESOLVED template def (not the raw ACTIVE one) lets measured presence_standard leaves
    // auto-grade against the correct era's thresholds, including tiered byLaw criteria. Scored
    // against taggedGroups (redaction flags baked in, Part C.4) so an era-redacted leaf is
    // excluded from every denominator even if it somehow carries a stray answer value.
    const score = computeScoreFromItems(taggedGroups, resolvedDef)

    let checklist
    try {
      checklist = await this.prisma.checklist.create({
        data: {
          stationId,
          auditorId,
          items: toJson(taggedGroups),
          appliedYearBuilt,
          appliedYearBuiltDate: appliedYearBuiltDate ? new Date(appliedYearBuiltDate) : null,
          appliedLawRefs: appliedLawRefs === null ? Prisma.JsonNull : toJson(appliedLawRefs),
          score,
          // Part A.2 — a training submission auto-finalizes straight to APPROVED, never resting
          // at SUBMITTED: it must never appear in the admin review queue (every "pending review"
          // query filters status=SUBMITTED), and skipping SUBMITTED entirely means the
          // one-pending-SUBMITTED partial unique index is never engaged, so the same tutorial can
          // be run again immediately (see the partial-index doc on the Checklist model).
          status: station.isTraining ? 'APPROVED' : 'SUBMITTED',
          submittedAt: new Date(),
          templateId: template?.id,
          templateVersion: template?.version,
          finalThoughts: finalThoughts ?? null,
          gpsLat:      gps?.lat ?? null,
          gpsLng:      gps?.lng ?? null,
          gpsAccuracy: gps?.accuracy ?? null,
          gpsDistanceM: distanceM,
          locationVerified,
          proximityBypassed: bypassAllowed,
          // Part H.3 — a no-prior-draft submit IS a start, so it carries the start-time trail too.
          // A resumed draft leaves these null on the SUBMITTED row; the proof of presence lives on
          // the DRAFT row that was gated at creation (linked by (stationId, auditorId)).
          ...(startGate ? this.startGpsColumns(startGate, gps) : {}),
          isTraining: station.isTraining,
        },
      })
    } catch (err) {
      // Part D — at most one pending-review (SUBMITTED, not yet APPROVED/REJECTED) checklist per
      // (stationId, auditorId), enforced by a partial unique index. Replaces the Session-2
      // 10-minute read-then-write stopgap: this is a permanent constraint, not a time window —
      // a second submit is rejected until the first is actually reviewed, by design (Part D.2).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'DUPLICATE_SUBMIT',
          message: 'คุณมีรายงานที่รอการตรวจสอบอยู่แล้วสำหรับสถานีนี้ กรุณารอผลการตรวจสอบก่อนส่งใหม่',
        })
      }
      throw err
    }

    // Part H.5 — a fresh submit with no prior draft IS a start (nothing was created before it),
    // so it gets the same START event the draft-creation path writes.
    if (startGate) {
      await this.auditLog.log({
        userId: auditorId,
        action: 'START_CHECKLIST',
        entityType: 'Checklist',
        entityId: checklist.id,
        after: {
          stationId,
          distanceM:         startGate.distanceM,
          locationVerified:  startGate.locationVerified,
          proximityBypassed: startGate.bypassAllowed,
          viaDirectSubmit:   true,
        },
      })
    }

    await this.auditLog.log({
      userId: auditorId,
      action: 'SUBMIT_CHECKLIST',
      entityType: 'Checklist',
      entityId: checklist.id,
      after: { stationId, status: 'SUBMITTED', score },
    })

    // Session E3, Part B.3 — resubmit-after-rejection linkage. reviewNotes on a DRAFT is ONLY
    // ever set by StationsService.rejectChecklist's draft-carry-forward (see that method's doc) —
    // its presence on the draft this submit just consumed is exactly the signal that this
    // resubmission is fixing a rejection, not an ordinary first-time submit. The link is recorded
    // in AuditLog (before/after checklist ids) rather than a new Checklist column — the REJECTED
    // row itself stays untouched as permanent history (Part B.3's requirement), and the admin
    // review page resolves the "resubmission of <link>" marker by querying this log entry (Part
    // B.4 / findResubmitSource below). The draft's reviewNotes is cleared afterward so a LATER,
    // unrelated resubmit against the same lingering draft doesn't re-link to this same old
    // rejection a second time.
    if (existingDraft?.reviewNotes) {
      const priorRejected = await this.prisma.checklist.findFirst({
        where: { stationId, auditorId, status: 'REJECTED' },
        orderBy: { reviewedAt: 'desc' },
      })
      if (priorRejected) {
        await this.auditLog.log({
          userId: auditorId,
          action: 'RESUBMIT_AFTER_REJECTION',
          entityType: 'Checklist',
          entityId: checklist.id,
          before: { checklistId: priorRejected.id },
          after: { checklistId: checklist.id },
        })
      }
      await this.prisma.checklist.update({ where: { id: existingDraft.id }, data: { reviewNotes: null } })
    }

    return checklist
  }

  // Session E3, Part B.4 — admin review page's "resubmission of <link>" marker. Looks up the
  // RESUBMIT_AFTER_REJECTION AuditLog entry this checklist's submit wrote (see above), if any.
  // Returns null for every ordinary (non-resubmission) checklist — the common case — with exactly
  // one indexed AuditLog query (entityId is indexed; see schema.prisma AuditLog @@index).
  async findResubmitSource(checklistId: string): Promise<string | null> {
    const log = await this.prisma.auditLog.findFirst({
      where: { action: 'RESUBMIT_AFTER_REJECTION', entityType: 'Checklist', entityId: checklistId },
      orderBy: { createdAt: 'desc' },
    })
    const before = log?.before as { checklistId?: string } | null
    return before?.checklistId ?? null
  }

  // Session F1, Part E — "งานของฉัน" (my work): every checklist belonging to this auditor, newest
  // first, optionally filtered by status. ONE paginated endpoint per Part E.3 — auditor-scoped by
  // construction (`where.auditorId` is always the JWT-authenticated caller's own id, never a
  // caller-supplied value — an auditor can never query another auditor's rows through this
  // method, structurally, not just by convention). Bounded (page/limit), never returns the raw
  // `items` blob (list view only needs a DRAFT's progress, computed via computeStoredProgress —
  // no template fan-out, see that function's doc — everything else just needs status/dates).
  async findMyChecklists(auditorId: string, page: number, limit: number, status?: ChecklistStatus) {
    const where = { auditorId, ...(status ? { status } : {}) }
    const [total, rows] = await Promise.all([
      this.prisma.checklist.count({ where }),
      this.prisma.checklist.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, stationId: true, status: true,
          createdAt: true, updatedAt: true, submittedAt: true, reviewedAt: true, reviewNotes: true,
          score: true, items: true, isTraining: true,
          station: { select: { nameTh: true, line: true, mode: true, railSubtype: true, province: true } },
        },
      }),
    ])
    const data = rows.map(({ items, ...row }) => ({
      ...row,
      // Progress is only meaningful for a DRAFT still being filled — SUBMITTED/APPROVED/REJECTED
      // rows are complete records, not in-progress work.
      progress: row.status === 'DRAFT' ? computeStoredProgress(items) : null,
    }))
    return { data, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) }
  }

  // Session F1, Part E.2 — "ทำต่อ"/read-only detail behind the my-work list. Ownership scoped in
  // the SAME query as the existence check (BOLA-safe — a checklist that isn't this auditor's 404s
  // exactly like one that doesn't exist, never a 403 confirming it exists under someone else).
  // Photo URLs re-presigned fresh, same convention as every other read path (see refreshPhotoUrls).
  async findMyChecklistDetail(auditorId: string, id: string) {
    const cl = await this.prisma.checklist.findFirst({
      where: { id, auditorId },
      include: { station: { select: { nameTh: true, line: true, mode: true, railSubtype: true, province: true } } },
    })
    if (!cl) throw new NotFoundException()
    return { ...cl, items: await this.refreshPhotoUrls(cl.items) }
  }

  // Session E3, Part B.1 — "งานที่ถูกตีกลับ" (returned work) on the auditor home. A REJECTED
  // checklist only belongs on this list while it's still the LATEST checklist this auditor has
  // for that station — once resubmitted, a newer SUBMITTED/APPROVED/REJECTED row exists for the
  // same (stationId, auditorId) and this same DISTINCT-ON-stationId pattern picks that one
  // instead (mirrors StationsService.computeMetrics' "one row per station, most recent of
  // SUBMITTED/APPROVED/REJECTED" convention, scoped to one auditor instead of all of them).
  private latestPerStationForAuditor<S extends Prisma.ChecklistSelect>(auditorId: string, select: S) {
    return this.prisma.checklist.findMany({
      where: { auditorId, status: { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] } },
      select,
      distinct: ['stationId'],
      orderBy: [{ stationId: 'asc' }, { submittedAt: 'desc' }],
    })
  }

  // Cheap dedicated query for the auditor home's badge count — selects only scalar columns, never
  // the items JSON blob, so this is safe to call on every page load (Part B.1's explicit
  // requirement: "not a full list fetch").
  async countMyRejected(auditorId: string): Promise<number> {
    const rows = await this.latestPerStationForAuditor(auditorId, { status: true })
    return rows.filter((r) => r.status === 'REJECTED').length
  }

  // The full list, fetched only when the auditor actually opens the returned-work section.
  async findMyRejected(auditorId: string) {
    const rows = await this.latestPerStationForAuditor(auditorId, {
      id: true,
      stationId: true,
      status: true,
      reviewNotes: true,
      reviewedAt: true,
      station: { select: { nameTh: true, province: true, mode: true } },
    })
    return rows
      .filter((r) => r.status === 'REJECTED')
      .map(({ status: _status, ...r }) => r)
  }

  // Session E3, Part C.3 — auditor removes a photo they uploaded (wrong-evidence case). Ownership
  // (auditorId must match) and ID scoping (stationId/checklistId) happen in the SAME query as the
  // status check, closing the same BOLA class of gap the existing setItemFlag/rejectChecklist
  // guards close — a checklist that doesn't belong to this auditor 404s exactly like one that
  // doesn't exist, never a 403 that would confirm its existence. Editable only while DRAFT or
  // REJECTED (Part C.3's explicit scope) — never after submission, which is the reviewed record.
  async deletePhoto(stationId: string, checklistId: string, auditorId: string, itemId: string, photoId: string) {
    const cl = await this.prisma.checklist.findFirst({ where: { id: checklistId, stationId, auditorId } })
    if (!cl) throw new NotFoundException()
    if (!PHOTO_EDITABLE_STATUSES.includes(cl.status as typeof PHOTO_EDITABLE_STATUSES[number])) {
      throw new BadRequestException({ code: 'CHECKLIST_NOT_EDITABLE', message: 'ไม่สามารถลบรูปภาพได้ในสถานะนี้' })
    }

    const groups = parseChecklistItems(cl.items)
    let itemFound = false
    let removedPhoto: { id: string } | undefined
    const updateNode = (n: StoredChecklistNode): StoredChecklistNode => {
      if (n.id === itemId) {
        itemFound = true
        const photos = n.photos ?? []
        removedPhoto = photos.find((p) => p.id === photoId)
        return { ...n, photos: photos.filter((p) => p.id !== photoId) }
      }
      if (n.subItems) return { ...n, subItems: n.subItems.map(updateNode) }
      return n
    }
    const updatedGroups: ParsedChecklistGroup[] = groups.map((g) => ({ ...g, items: g.items.map(updateNode) }))
    if (!itemFound) throw new NotFoundException('checklist item not found')
    if (!removedPhoto) throw new NotFoundException('photo not found on this item')

    const updated = await this.prisma.checklist.update({
      where: { id: checklistId },
      data: { items: toJson(updatedGroups) },
    })

    // Best-effort: the checklist's own record of the photo is already gone (the update above is
    // the source of truth) — a transient MinIO failure here leaves an orphaned object, a storage
    // cost, not a correctness gap. Never construct the object URL client-side; this is the only
    // path that removes the underlying object.
    try {
      await this.minio.remove(photoId)
    } catch {
      // orphaned object — acceptable, see comment above
    }

    await this.auditLog.log({
      userId: auditorId,
      action: 'DELETE_PHOTO',
      entityType: 'Checklist',
      entityId: checklistId,
      before: { itemId, photoId },
      after: { itemId },
    })

    return { ...updated, items: await this.refreshPhotoUrls(updated.items) }
  }
}
