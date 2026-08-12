// Session S5, Part D — master/reference criterion CRUD + the atomic auto-push. See
// master-criteria.core.ts's module doc for the pure write-through mechanics this wraps with
// Prisma/audit-log plumbing, and schema.prisma's MasterCriterion doc for the model.
//
// Deliberately a SEPARATE service/controller from TemplatesAdminService/FacilityGroupsService —
// this resource's identity (a MasterCriterion row) isn't scoped to one ChecklistTemplate the way
// every other admin/templates endpoint is, and a push here can touch instances across every
// mode/variant/version at once, unlike the grouped editor's VersionScope-bounded propagate. Detach/
// attach (Part C.2/C.3) stay on TemplatesAdminService instead, since those ARE single-template,
// single-node writes — see templates.service.ts's detachFromMaster/attachToMaster.
import { randomUUID } from 'crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type MasterCriterion as MasterCriterionRow } from '@prisma/client'
import type { ChecklistTemplateDefinition } from '@repo/types'
import { ChecklistTemplateValidationError } from '@repo/types'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'
import { TemplateEditError } from './templates.core'
import { findAttachedNodes, findDetachedNodes, pushMasterToInstance, type MasterCriterionPayload } from './master-criteria.core'
import type { CreateMasterCriterionDto } from './dto/create-master-criterion.dto'
import type { EditMasterCriterionDto } from './dto/edit-master-criterion.dto'

export const TEMPLATE_MASTER_CREATE = 'TEMPLATE_MASTER_CREATE'
// Shared by both the MasterCriterion row's own audit row and every per-instance push write this
// edit fans out to (entityType distinguishes them: 'MasterCriterion' vs 'ChecklistTemplate') — same
// "one action name, many entities, one correlationId" convention facility-groups.service.ts's
// TEMPLATE_GROUPED_EDIT already uses for its fan-out.
export const TEMPLATE_MASTER_EDIT = 'TEMPLATE_MASTER_EDIT'
// Part G — the dry-run migration script's audit action once a real (non-dry-run) run creates a
// master + links instances. Defined here (not locally in the script) so the audit trail uses the
// same constant regardless of whether a master was created via this bulk migration or the ordinary
// create()/attach flow above ever grows a scripted equivalent.
export const TEMPLATE_MASTER_MIGRATE = 'TEMPLATE_MASTER_MIGRATE'

function toPayload(row: MasterCriterionRow): MasterCriterionPayload {
  return {
    id: row.id,
    labelTh: row.labelTh,
    answerType: row.answerType as MasterCriterionPayload['answerType'],
    measurements: row.measurements as MasterCriterionPayload['measurements'],
    guidance: row.guidance as MasterCriterionPayload['guidance'],
    imageKeys: row.imageKeys,
    lawRefs: row.lawRefs,
    cabinetResolution: row.cabinetResolution,
    beyondLaw: row.beyondLaw,
    facilityCode: row.facilityCode,
  }
}

// Json columns need the JsonNull sentinel for "set SQL NULL" — a bare JS `null`/`undefined` would
// either be rejected or (for `undefined`) silently skip the field, which is wrong here since an
// update always writes every field of the merged patch (see `update` below).
function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue)
}

interface TemplateRow {
  id: string
  mode: string
  variantKey: string
  version: number
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  definition: ChecklistTemplateDefinition
}

export interface InstanceRef {
  templateId: string
  mode: string
  variantKey: string
  version: number
  status: TemplateRow['status']
  nodeCode: string
  labelTh: string
}

@Injectable()
export class MasterCriteriaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async loadAllTemplates(): Promise<TemplateRow[]> {
    const rows = await this.prisma.checklistTemplate.findMany({})
    return rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      variantKey: r.variantKey,
      version: r.version,
      status: r.status as TemplateRow['status'],
      definition: r.definition as unknown as ChecklistTemplateDefinition,
    }))
  }

  private async loadMaster(id: string): Promise<MasterCriterionRow> {
    const row = await this.prisma.masterCriterion.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`master criterion ${id} not found`)
    return row
  }

  // ---- read (Part F browse/detail view) ----

  async list() {
    const [masters, templates] = await Promise.all([
      this.prisma.masterCriterion.findMany({ orderBy: { createdAt: 'asc' } }),
      this.loadAllTemplates(),
    ])
    return masters.map((m) => {
      let attachedCount = 0
      let detachedCount = 0
      for (const t of templates) {
        attachedCount += findAttachedNodes(t.definition, m.id).length
        detachedCount += findDetachedNodes(t.definition, m.id).length
      }
      return {
        id: m.id,
        labelTh: m.labelTh,
        answerType: m.answerType,
        facilityCode: m.facilityCode,
        updatedAt: m.updatedAt,
        updatedBy: m.updatedBy,
        attachedCount,
        detachedCount,
      }
    })
  }

  // Part D2/F.3 — detached instances are returned alongside attached ones, never a separate
  // resource, so the master facility editor can render its "แยกออกแล้ว" subsection from one fetch.
  async get(id: string) {
    const master = await this.loadMaster(id)
    const templates = await this.loadAllTemplates()
    const attached: InstanceRef[] = []
    const detached: InstanceRef[] = []
    for (const t of templates) {
      for (const { nodeCode, node } of findAttachedNodes(t.definition, id)) {
        attached.push({ templateId: t.id, mode: t.mode, variantKey: t.variantKey, version: t.version, status: t.status, nodeCode, labelTh: node.labelTh })
      }
      for (const { nodeCode, node } of findDetachedNodes(t.definition, id)) {
        detached.push({ templateId: t.id, mode: t.mode, variantKey: t.variantKey, version: t.version, status: t.status, nodeCode, labelTh: node.labelTh })
      }
    }
    return {
      id: master.id,
      labelTh: master.labelTh,
      answerType: master.answerType,
      measurements: master.measurements,
      guidance: master.guidance,
      imageKeys: master.imageKeys,
      lawRefs: master.lawRefs,
      cabinetResolution: master.cabinetResolution,
      beyondLaw: master.beyondLaw,
      facilityCode: master.facilityCode,
      updatedAt: master.updatedAt,
      updatedBy: master.updatedBy,
      attached,
      detached,
    }
  }

  // ---- create ----

  async create(dto: CreateMasterCriterionDto, actorId: string) {
    const created = await this.prisma.masterCriterion.create({
      data: {
        labelTh: dto.labelTh,
        answerType: dto.answerType,
        measurements: jsonInput(dto.measurements),
        guidance: jsonInput(dto.guidance),
        imageKeys: dto.imageKeys ?? [],
        lawRefs: dto.lawRefs ?? [],
        cabinetResolution: dto.cabinetResolution,
        beyondLaw: dto.beyondLaw,
        facilityCode: dto.facilityCode,
        updatedBy: actorId,
      },
    })
    await this.auditLog.log({
      userId: actorId,
      action: TEMPLATE_MASTER_CREATE,
      entityType: 'MasterCriterion',
      entityId: created.id,
      before: null,
      after: toPayload(created),
    })
    return created
  }

  // ---- edit + atomic auto-push (Part D) ----
  //
  // Everything — the MasterCriterion row's own update, every attached instance's write, and every
  // AuditLog row (master + per-instance) — happens inside ONE prisma.$transaction: a bad patch (a
  // measurement shape parseTemplateDefinition rejects, discovered only once the push actually runs
  // against a real instance) throws mid-callback, and Prisma rolls back everything, including the
  // master row itself — there is no partially-applied master edit. RETIRED instances are SKIPPED
  // (reported in `skippedRetired`, never silently), not written and not a reason to fail the whole
  // push — a dead template shouldn't be able to hold every other live one hostage (mirrors
  // TemplatesAdminService#applyEdit's RETIRED guard's intent, applied per-instance here instead of
  // per-request since a push necessarily spans many instances at once).
  async update(id: string, dto: EditMasterCriterionDto, actorId: string) {
    const existing = await this.loadMaster(id)
    const before = toPayload(existing)

    const patched: MasterCriterionPayload = {
      id,
      labelTh: dto.labelTh ?? before.labelTh,
      answerType: dto.answerType !== undefined ? dto.answerType : before.answerType,
      measurements: dto.measurements !== undefined ? (dto.measurements as MasterCriterionPayload['measurements']) : before.measurements,
      guidance: dto.guidance !== undefined ? dto.guidance : before.guidance,
      imageKeys: dto.imageKeys !== undefined ? dto.imageKeys : before.imageKeys,
      lawRefs: dto.lawRefs !== undefined ? dto.lawRefs : before.lawRefs,
      cabinetResolution: dto.cabinetResolution !== undefined ? dto.cabinetResolution : before.cabinetResolution,
      beyondLaw: dto.beyondLaw !== undefined ? dto.beyondLaw : before.beyondLaw,
      facilityCode: dto.facilityCode !== undefined ? dto.facilityCode : before.facilityCode,
    }

    const correlationId = randomUUID()
    const pushResults: (InstanceRef & { before: unknown; after: unknown })[] = []
    const skippedRetired: { templateId: string; mode: string; variantKey: string; nodeCode: string }[] = []

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.masterCriterion.update({
          where: { id },
          data: {
            labelTh: patched.labelTh,
            answerType: patched.answerType ?? null,
            measurements: jsonInput(patched.measurements),
            guidance: jsonInput(patched.guidance),
            imageKeys: patched.imageKeys,
            lawRefs: patched.lawRefs,
            cabinetResolution: patched.cabinetResolution ?? null,
            beyondLaw: patched.beyondLaw ?? null,
            facilityCode: patched.facilityCode ?? null,
            updatedBy: actorId,
          },
        })
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: TEMPLATE_MASTER_EDIT,
            entityType: 'MasterCriterion',
            entityId: id,
            before: { correlationId, value: before } as unknown as Prisma.InputJsonValue,
            after: { correlationId, value: patched } as unknown as Prisma.InputJsonValue,
          },
        })

        const rows = await tx.checklistTemplate.findMany({})
        for (const row of rows) {
          const def = row.definition as unknown as ChecklistTemplateDefinition
          const targets = findAttachedNodes(def, id)
          if (targets.length === 0) continue

          if (row.status === 'RETIRED') {
            for (const t of targets) skippedRetired.push({ templateId: row.id, mode: row.mode, variantKey: row.variantKey, nodeCode: t.nodeCode })
            continue
          }

          let evolvingDef = def
          const rowResults: (InstanceRef & { before: unknown; after: unknown })[] = []
          for (const { nodeCode } of targets) {
            const result = pushMasterToInstance(evolvingDef, nodeCode, patched, { setMasterId: false, clearDetached: false })
            evolvingDef = result.definition
            rowResults.push({
              templateId: row.id,
              mode: row.mode,
              variantKey: row.variantKey,
              version: row.version,
              status: row.status as TemplateRow['status'],
              nodeCode,
              labelTh: patched.labelTh,
              before: result.before,
              after: result.after,
            })
          }

          await tx.checklistTemplate.update({ where: { id: row.id }, data: { definition: evolvingDef as unknown as Prisma.InputJsonValue } })
          for (const r of rowResults) {
            await tx.auditLog.create({
              data: {
                userId: actorId,
                action: TEMPLATE_MASTER_EDIT,
                entityType: 'ChecklistTemplate',
                entityId: row.id,
                before: { correlationId, nodeCode: r.nodeCode, masterId: id, value: r.before } as Prisma.InputJsonValue,
                after: { correlationId, nodeCode: r.nodeCode, masterId: id, value: r.after } as Prisma.InputJsonValue,
              },
            })
          }
          pushResults.push(...rowResults)
        }
      })
    } catch (err) {
      if (err instanceof TemplateEditError || err instanceof ChecklistTemplateValidationError) {
        throw new BadRequestException(err.message)
      }
      throw err
    }

    // Part 1b — informational only, computed AFTER the transaction commits; never gates the write
    // above (the write already happened by the time this runs). A slightly-stale count under
    // concurrent submits is an acceptable tradeoff for an admin-facing number, not a correctness
    // boundary — the actual push was already atomic.
    const activeTemplateIds = [...new Set(pushResults.filter((r) => r.status === 'ACTIVE').map((r) => r.templateId))]
    const activeRegrade = await Promise.all(
      activeTemplateIds.map(async (templateId) => {
        const sample = pushResults.find((r) => r.templateId === templateId)!
        const count = await this.prisma.checklist.count({ where: { templateId, status: { not: 'DRAFT' } } })
        return { templateId, mode: sample.mode, variantKey: sample.variantKey, version: sample.version, count }
      }),
    )

    // Part D2 — informational count of instances that WON'T mirror this edit, never blocked.
    const templatesAfter = await this.loadAllTemplates()
    let detachedCount = 0
    for (const t of templatesAfter) detachedCount += findDetachedNodes(t.definition, id).length

    return {
      master: await this.loadMaster(id),
      correlationId,
      wroteCount: pushResults.length,
      skippedRetired,
      activeRegrade,
      detachedCount,
    }
  }
}
