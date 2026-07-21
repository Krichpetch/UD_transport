import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { ChecklistStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { StationsService } from '../stations/stations.service'
import { AuditLogService } from '../audit/audit.service'
import { isProximityBypassActive } from '../config/validate-env'
import { computeScoreFromItems } from './scoring'
import {
  parseChecklistItems,
  ChecklistItemsParseError,
  resolveTemplateEras,
  filterApplicableItems,
  type ChecklistTemplateDefinition,
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
  ) {}

  findDraft(stationId: string, auditorId: string) {
    return this.prisma.checklist.findFirst({
      where: { stationId, auditorId, status: ChecklistStatus.DRAFT },
    })
  }

  async findLatest(stationId: string) {
    const cl = await this.prisma.checklist.findFirst({
      where: { stationId, status: { in: [ChecklistStatus.SUBMITTED, ChecklistStatus.APPROVED, ChecklistStatus.REJECTED] } },
      orderBy: { submittedAt: 'desc' },
      include: { auditor: { select: { username: true } } },
    })
    if (!cl) return null
    const { auditor, ...rest } = cl
    return { ...rest, auditorUsername: auditor?.username ?? null }
  }

  findAll(stationId: string) {
    return this.prisma.checklist.findMany({
      where: { stationId },
      orderBy: { createdAt: 'desc' },
      include: { auditor: { select: { id: true, username: true } } },
    })
  }

  // E-form redesign (Part A.4) — the mode's current ACTIVE (variantKey='standard') template.
  // Used both to stamp new checklists at creation and to structurally validate incoming items
  // against real codes (Part B/C). Returns null if none exists yet (e.g. seed-templates.ts
  // hasn't run in this environment) — callers degrade gracefully rather than blocking submission
  // on template metadata being present.
  private getActiveTemplate(mode: string) {
    return this.prisma.checklistTemplate.findFirst({
      where: { mode, variantKey: 'standard', status: 'ACTIVE' },
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
    const template = preview
      ? await this.prisma.checklistTemplate.findFirst({ where: { mode: station.mode, variantKey: 'standard', version: 2 } })
      : await this.getActiveTemplate(station.mode)
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
    try {
      parseChecklistItems(items, templateDef)
    } catch (err) {
      if (err instanceof ChecklistItemsParseError) {
        // err.message is "{path}: {description}" and the description names the offending code
        // value itself (e.g. `unknown item code "A1.99" for this template`) — err.path alone is
        // only the structural path, not the code, so the full message is what the 400 must carry.
        throw new BadRequestException({ code: 'INVALID_ITEMS', message: `รูปแบบข้อมูลรายการตรวจสอบไม่ถูกต้อง: ${err.message}`, path: err.path })
      }
      throw err
    }
  }

  // Part D — one DRAFT per (stationId, auditorId), enforced by a partial unique index (see
  // migrations/*_checklist_draft_submit_uniqueness — Prisma's schema DSL can't declare a
  // WHERE-scoped unique constraint, so it isn't visible to `.upsert()`). This does a plain
  // find-then-create/update like before, but a concurrent double-create now loses cleanly via
  // the real DB constraint (P2002) instead of racing on a read-then-write check — the loser
  // falls back to updating the row the winner just created.
  async saveDraft(stationId: string, auditorId: string, items: unknown, finalThoughts?: string) {
    const station = await this.stations.findOne(stationId)
    const template = await this.getActiveTemplate(station.mode)
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
    const template = await this.getActiveTemplate(station.mode)
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
    return checklist
  }
}
