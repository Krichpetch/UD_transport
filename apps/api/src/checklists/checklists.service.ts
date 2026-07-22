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
  filterApplicableItems,
  resolveVariantKey,
  STANDARD_VARIANT_KEY,
  type ChecklistTemplateDefinition,
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
  private resolveEraStamp(templateDef: ChecklistTemplateDefinition | undefined, yearBuilt: number | null) {
    if (!templateDef) {
      return { resolvedDef: undefined, appliedYearBuilt: yearBuilt, appliedLawRefs: null as Record<string, string> | null }
    }
    const { resolved, appliedLawRefs } = resolveTemplateEras(templateDef, yearBuilt)
    return {
      resolvedDef: resolved,
      appliedYearBuilt: yearBuilt,
      appliedLawRefs: Object.keys(appliedLawRefs).length > 0 ? appliedLawRefs : null,
    }
  }

  // Part A.6 — GET template-for-audit: returns the mode's ACTIVE template with every byLaw value
  // already resolved to a flat value (the client never sees or picks between eras). Resolves
  // against an in-progress DRAFT's own stamp when one exists (an audit already underway must not
  // have its thresholds shift under it if the station's yearBuilt is corrected later — see
  // Checklist.appliedYearBuilt doc); otherwise resolves live against the station's current
  // yearBuilt, since no stamp exists yet.
  //
  // `preview` (Part B.2, admin/dev-only — the controller only honors this for ADMIN callers)
  // serves the mode's v2 DRAFT definition instead, for the gated v2-preview renderer. This is
  // read-only rendering support ONLY — v2 is never ACTIVE, so no real checklist is ever created
  // or submitted against it; saveDraft/submit always stamp/validate against the ACTIVE template.
  async getTemplateForAudit(stationId: string, auditorId: string, preview?: boolean) {
    const station = await this.stations.findOne(stationId)
    // Preview always targets the station's resolved variant's v2 DRAFT (Session E3, Part A) — no
    // fallback to 'standard' here: if the resolved variant has no v2 DRAFT yet (e.g. rail_metro's
    // workbook hasn't been authored), preview degrades to the same "no template" response as any
    // other missing template, rather than silently showing a different variant's form.
    const template = preview
      ? await this.prisma.checklistTemplate.findFirst({
          where: { mode: station.mode, variantKey: resolveVariantKey(station.mode as TransportMode, station.railSubtype).variantKey, version: 2 },
        })
      : await this.getActiveTemplate(station.mode, station.railSubtype)
    if (!template) return { template: null, templateId: null, templateVersion: null, appliedYearBuilt: station.yearBuilt, appliedLawRefs: null, eraUnresolved: false, preview: !!preview }

    const draft = preview ? null : await this.prisma.checklist.findFirst({ where: { stationId, auditorId, status: 'DRAFT' } })
    const yearBuilt = draft?.appliedYearBuilt ?? station.yearBuilt ?? null
    const templateDef = template.definition as unknown as ChecklistTemplateDefinition
    // Item redaction (Session E2 follow-up) BEFORE value resolution: a criterion the build year
    // predates is removed from the tree entirely (product decision — "hide the item", see
    // @repo/types#filterApplicableItems), so appliedLawRefs below only ever names laws actually
    // relevant to what the auditor can see.
    const filtered = filterApplicableItems(templateDef, yearBuilt)
    const { resolved, appliedLawRefs, eraUnresolved } = resolveTemplateEras(filtered, yearBuilt)

    return {
      template: resolved,
      templateId: template.id,
      templateVersion: template.version,
      appliedYearBuilt: yearBuilt,
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
  private validateItemsPayload(items: unknown, templateDef?: ChecklistTemplateDefinition): void {
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

  // Part D — one DRAFT per (stationId, auditorId), enforced by a partial unique index (see
  // migrations/*_checklist_draft_submit_uniqueness — Prisma's schema DSL can't declare a
  // WHERE-scoped unique constraint, so it isn't visible to `.upsert()`). This does a plain
  // find-then-create/update like before, but a concurrent double-create now loses cleanly via
  // the real DB constraint (P2002) instead of racing on a read-then-write check — the loser
  // falls back to updating the row the winner just created.
  async saveDraft(stationId: string, auditorId: string, items: unknown, finalThoughts?: string) {
    const station = await this.stations.findOne(stationId)
    const template = await this.getActiveTemplate(station.mode, station.railSubtype)
    this.validateItemsPayload(items, template?.definition as ChecklistTemplateDefinition | undefined)

    const existing = await this.prisma.checklist.findFirst({
      where: { stationId, auditorId, status: 'DRAFT' },
    })

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
      const { appliedYearBuilt, appliedLawRefs } = this.resolveEraStamp(
        template?.definition as ChecklistTemplateDefinition | undefined,
        station.yearBuilt,
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
            appliedLawRefs: appliedLawRefs === null ? Prisma.JsonNull : toJson(appliedLawRefs),
            finalThoughts: finalThoughts ?? null,
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

    await this.auditLog.log({
      userId: auditorId,
      action: 'SAVE_DRAFT',
      entityType: 'Checklist',
      entityId: checklist.id,
      after: { stationId, status: 'DRAFT' },
    })
    return checklist
  }

  // Proximity gate — recomputes distance server-side; a client "isNear" flag is never trusted.
  //   - coordStatus=OK station: GPS required, must be within PROXIMITY_RADIUS_M or the submit
  //     is rejected (frontend is expected to save the work as a draft on this error).
  //   - coordStatus!=OK station (APPROXIMATE/PENDING): can't be distance-gated (coords may be
  //     tens of km off) — allowed through, but locationVerified=false so the app can still show
  //     an "unverified location" warning.
  //   - Dev/staging bypass: a server-side env switch (APP_ENV + PROXIMITY_BYPASS), never a
  //     client-supplied flag — isProximityBypassActive() is the sole authority and is itself
  //     fail-closed in production (see validateEnv). Any bypassRequested the client sends is
  //     ignored outright.
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
    this.validateItemsPayload(items, templateDef)

    // Reuse the auditor's in-progress DRAFT's era stamp when one exists — that's the resolution
    // the auditor was actually answering against (via GET template-for-audit) while filling the
    // form; a direct submit with no prior draft stamps fresh from the station's yearBuilt now.
    // Either way this is the ONE resolution used for both the stamp and the auto-graded score
    // below — never two separate passes that could disagree (Part A.6/A.7).
    const existingDraft = await this.prisma.checklist.findFirst({ where: { stationId, auditorId, status: 'DRAFT' } })
    const { resolvedDef, appliedYearBuilt, appliedLawRefs } = this.resolveEraStamp(
      templateDef,
      existingDraft?.appliedYearBuilt ?? station.yearBuilt,
    )

    const bypassAllowed = isProximityBypassActive()

    let distanceM: number | null = null
    let locationVerified = false

    if (bypassAllowed) {
      // Genuinely unverified — bypass skips the check, it doesn't fake a passing one.
      locationVerified = false
    } else if (station.coordStatus !== 'OK') {
      locationVerified = false
    } else {
      if (gps?.lat == null || gps?.lng == null) {
        throw new ForbiddenException({
          code: 'LOCATION_REQUIRED',
          message: 'ต้องเปิดใช้งาน GPS เพื่อส่งรายงาน',
        })
      }
      distanceM = await this.stations.distanceToStationMeters(stationId, gps.lat, gps.lng)
      if (distanceM === null || distanceM > PROXIMITY_RADIUS_M) {
        throw new BadRequestException({
          code: 'OUT_OF_RANGE',
          message: 'คุณอยู่นอกพื้นที่สถานี ไม่สามารถส่งรายงานได้',
          distanceM,
        })
      }
      locationVerified = true
    }

    // Re-derive score server-side; never trust the client-supplied value. Passing the ERA-
    // RESOLVED template def (not the raw ACTIVE one) lets measured presence_standard leaves
    // auto-grade against the correct era's thresholds, including tiered byLaw criteria.
    const score = computeScoreFromItems(items, resolvedDef)

    let checklist
    try {
      checklist = await this.prisma.checklist.create({
        data: {
          stationId,
          auditorId,
          items: toJson(items),
          appliedYearBuilt,
          appliedLawRefs: appliedLawRefs === null ? Prisma.JsonNull : toJson(appliedLawRefs),
          score,
          status: 'SUBMITTED',
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
