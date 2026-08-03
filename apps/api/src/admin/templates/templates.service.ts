import { randomBytes } from 'crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { ChecklistTemplateDefinition } from '@repo/types'
import { ChecklistTemplateValidationError } from '@repo/types'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'
import * as core from './templates.core'
import { TemplateEditError } from './templates.core'
import type { EditMeasurementDto } from './dto/edit-measurement.dto'
import type { EditEraDto } from './dto/edit-era.dto'
import type { EditGuidanceDto } from './dto/edit-guidance.dto'
import type { SetQuestionTypeDto } from './dto/set-question-type.dto'
import type { AddChildDto } from './dto/add-child.dto'
import type { ReorderNodeDto } from './dto/reorder-node.dto'
import type { EditLawRefsDto } from './dto/edit-law-refs.dto'
import type { EditLabelDto } from './dto/edit-label.dto'

// Three audit-action names for W2-S3a (Parts B/C/E): value edits and guidance text share
// TEMPLATE_THRESHOLD_EDIT (Part E: "audit-logged under the threshold-edit action family"), era
// overrides get their own TEMPLATE_ERA_EDIT (Part C.2), image attach/detach get their own
// TEMPLATE_IMAGE_EDIT (distinct object, not a "value", but still audit-logged per Part D.2).
export const TEMPLATE_THRESHOLD_EDIT = 'TEMPLATE_THRESHOLD_EDIT'
export const TEMPLATE_ERA_EDIT = 'TEMPLATE_ERA_EDIT'
export const TEMPLATE_IMAGE_EDIT = 'TEMPLATE_IMAGE_EDIT'
// Session S3b — structural editing (Part C, DRAFT-only) and lawRefs editing (Part D, DRAFT+ACTIVE).
export const TEMPLATE_CLONE_TO_DRAFT = 'TEMPLATE_CLONE_TO_DRAFT'
export const TEMPLATE_STRUCTURE_EDIT = 'TEMPLATE_STRUCTURE_EDIT'
export const TEMPLATE_LAWREFS_EDIT = 'TEMPLATE_LAWREFS_EDIT'

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const TEMPLATE_IMAGE_KEY_PREFIX = 'template-images/'

@Injectable()
export class TemplatesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly minio: MinioService,
  ) {}

  private async loadRow(templateId: string) {
    const row = await this.prisma.checklistTemplate.findUnique({ where: { id: templateId } })
    if (!row) throw new NotFoundException(`template ${templateId} not found`)
    return row
  }

  // Every mutating method funnels through here: loads the row, refuses RETIRED (Part A.3 —
  // "RETIRED templates: view only, editing affordances absent" enforced server-side too, not
  // just hidden in the UI), runs `edit` against the current definition, persists the revalidated
  // result, and writes one AuditLog row. `edit` may throw TemplateEditError or
  // ChecklistTemplateValidationError — both are translated to 400s below rather than leaking as
  // 500s, matching this repo's "seed scripts fail loudly" convention applied to an HTTP boundary.
  private async applyEdit<T extends { definition: ChecklistTemplateDefinition; before: unknown; after: unknown }>(
    templateId: string,
    actorId: string,
    action: string,
    nodeCode: string,
    extra: Record<string, unknown>,
    edit: (def: ChecklistTemplateDefinition) => T,
  ): Promise<{ id: string; definition: ChecklistTemplateDefinition }> {
    const row = await this.loadRow(templateId)
    if (row.status === 'RETIRED') throw new ForbiddenException('template is RETIRED; editing is disabled')
    const def = row.definition as unknown as ChecklistTemplateDefinition

    let result: T
    try {
      result = edit(def)
    } catch (err) {
      if (err instanceof TemplateEditError || err instanceof ChecklistTemplateValidationError) {
        throw new BadRequestException(err.message)
      }
      throw err
    }

    await this.prisma.checklistTemplate.update({
      where: { id: templateId },
      data: { definition: result.definition as unknown as Prisma.InputJsonValue },
    })

    await this.auditLog.log({
      userId: actorId,
      action,
      entityType: 'ChecklistTemplate',
      entityId: templateId,
      before: { nodeCode, ...extra, value: result.before },
      after: { nodeCode, ...extra, value: result.after },
    })

    return { id: templateId, definition: result.definition }
  }

  // Session S3b, Part C.1 — the structural gate: everything routed through this (clone/type
  // switch/add-child/reorder/delete) requires the target template to be a DRAFT. Value edits
  // above keep using applyEdit's RETIRED-only gate, unchanged — structural mutation is strictly
  // narrower, not a replacement for it.
  private async applyStructuralEdit<T extends { definition: ChecklistTemplateDefinition; before?: unknown; after?: unknown }>(
    templateId: string,
    actorId: string,
    action: string,
    extra: Record<string, unknown>,
    edit: (def: ChecklistTemplateDefinition) => T,
  ): Promise<T> {
    const row = await this.loadRow(templateId)
    if (row.status !== 'DRAFT') {
      throw new ForbiddenException({
        code: 'STRUCTURE_EDIT_REQUIRES_DRAFT',
        message: 'โครงสร้างแก้ไขได้ในเวอร์ชันร่างเท่านั้น — สร้างเวอร์ชันร่างใหม่ก่อน',
      })
    }
    const def = row.definition as unknown as ChecklistTemplateDefinition

    let result: T
    try {
      result = edit(def)
    } catch (err) {
      if (err instanceof TemplateEditError || err instanceof ChecklistTemplateValidationError) {
        throw new BadRequestException(err.message)
      }
      throw err
    }

    await this.prisma.checklistTemplate.update({
      where: { id: templateId },
      data: { definition: result.definition as unknown as Prisma.InputJsonValue },
    })

    await this.auditLog.log({
      userId: actorId,
      action,
      entityType: 'ChecklistTemplate',
      entityId: templateId,
      before: { ...extra, value: result.before },
      after: { ...extra, value: result.after },
    })

    return result
  }

  // Session S3b, Part C.1 — "สร้างเวอร์ชันร่างใหม่": clones an ACTIVE template's definition into a
  // new (mode, variantKey, version+1, status DRAFT) row. Only ACTIVE may be cloned this way — a
  // DRAFT is already editable, and cloning a RETIRED one back to life isn't part of this flow.
  async cloneToDraft(templateId: string, actorId: string) {
    const row = await this.loadRow(templateId)
    if (row.status !== 'ACTIVE') {
      throw new BadRequestException('only an ACTIVE template can be cloned into a new draft version')
    }
    const agg = await this.prisma.checklistTemplate.aggregate({
      where: { mode: row.mode, variantKey: row.variantKey },
      _max: { version: true },
    })
    const newVersion = Math.max(agg._max.version ?? 0, row.version) + 1

    const created = await this.prisma.checklistTemplate.create({
      data: {
        mode: row.mode,
        variantKey: row.variantKey,
        version: newVersion,
        status: 'DRAFT',
        definition: row.definition as Prisma.InputJsonValue,
        notes: `Cloned from v${row.version} (${row.id}) for structural editing`,
      },
    })

    await this.auditLog.log({
      userId: actorId,
      action: TEMPLATE_CLONE_TO_DRAFT,
      entityType: 'ChecklistTemplate',
      entityId: created.id,
      before: { sourceTemplateId: row.id, sourceVersion: row.version },
      after: { newTemplateId: created.id, newVersion },
    })

    return created
  }

  async editLabel(templateId: string, nodeCode: string, dto: EditLabelDto, actorId: string) {
    return this.applyStructuralEdit(
      templateId,
      actorId,
      TEMPLATE_STRUCTURE_EDIT,
      { nodeCode, op: 'editLabel' },
      (def) => core.editNodeLabel(def, nodeCode, dto.labelTh, dto.num),
    )
  }

  async reorderMeasurement(templateId: string, nodeCode: string, measurementKey: string, dto: ReorderNodeDto, actorId: string) {
    return this.applyStructuralEdit(
      templateId,
      actorId,
      TEMPLATE_STRUCTURE_EDIT,
      { nodeCode, measurementKey, op: 'reorderMeasurement', direction: dto.direction },
      (def) => ({ ...core.reorderMeasurement(def, nodeCode, measurementKey, dto.direction), before: null, after: null }),
    )
  }

  async setQuestionType(templateId: string, nodeCode: string, dto: SetQuestionTypeDto, actorId: string) {
    return this.applyStructuralEdit(
      templateId,
      actorId,
      TEMPLATE_STRUCTURE_EDIT,
      { nodeCode, op: 'setQuestionType' },
      (def) => core.setNodeQuestionType(def, nodeCode, dto.type, dto.confirmDowngrade ?? false),
    )
  }

  async addMeasurement(templateId: string, nodeCode: string, dto: EditMeasurementDto, actorId: string) {
    const result = await this.applyStructuralEdit(
      templateId,
      actorId,
      TEMPLATE_STRUCTURE_EDIT,
      { nodeCode, op: 'addMeasurement' },
      (def) => {
        const r = core.addMeasurement(def, nodeCode, dto)
        return { definition: r.definition, before: null, after: r.after }
      },
    )
    return { id: templateId, definition: result.definition, key: result.after.key }
  }

  async addChild(templateId: string, parentCode: string, dto: AddChildDto, actorId: string) {
    const result = await this.applyStructuralEdit(
      templateId,
      actorId,
      TEMPLATE_STRUCTURE_EDIT,
      { parentCode, op: 'addChild' },
      (def) => {
        const r = core.addChildNode(def, parentCode, dto)
        return { definition: r.definition, before: null, after: { code: r.code } }
      },
    )
    return { id: templateId, definition: result.definition, code: result.after.code }
  }

  async reorderNode(templateId: string, nodeCode: string, dto: ReorderNodeDto, actorId: string) {
    return this.applyStructuralEdit(
      templateId,
      actorId,
      TEMPLATE_STRUCTURE_EDIT,
      { nodeCode, op: 'reorder', direction: dto.direction },
      (def) => ({ ...core.reorderNode(def, nodeCode, dto.direction), before: null, after: null }),
    )
  }

  async deleteNode(templateId: string, nodeCode: string, actorId: string) {
    return this.applyStructuralEdit(
      templateId,
      actorId,
      TEMPLATE_STRUCTURE_EDIT,
      { nodeCode, op: 'delete' },
      (def) => {
        const r = core.deleteNode(def, nodeCode)
        return { definition: r.definition, before: { subtreeLeafCount: r.subtreeLeafCount }, after: null }
      },
    )
  }

  // Session S3b, Part D — lawRefs editing, DRAFT AND ACTIVE (uses applyEdit's RETIRED-only gate,
  // never applyStructuralEdit's DRAFT-only one — this is applicability data, not structure).
  async editLawRefs(templateId: string, nodeCode: string, dto: EditLawRefsDto, actorId: string) {
    if (dto.lawRefs.length > 0) {
      const known = await this.prisma.lawReference.findMany({ where: { code: { in: dto.lawRefs } }, select: { code: true } })
      const knownCodes = new Set(known.map((l) => l.code))
      const unknown = dto.lawRefs.filter((c) => !knownCodes.has(c))
      if (unknown.length > 0) throw new BadRequestException(`unknown LawReference code(s): ${unknown.join(', ')}`)
    }
    return this.applyEdit(
      templateId,
      actorId,
      TEMPLATE_LAWREFS_EDIT,
      nodeCode,
      { field: 'lawRefs' },
      (def) => core.editLawRefs(def, nodeCode, dto.lawRefs, dto.beyondLaw),
    )
  }

  async list() {
    const rows = await this.prisma.checklistTemplate.findMany({
      orderBy: [{ mode: 'asc' }, { variantKey: 'asc' }, { version: 'asc' }],
    })
    return rows.map((row) => {
      const def = row.definition as unknown as ChecklistTemplateDefinition
      return {
        id: row.id,
        mode: row.mode,
        variantKey: row.variantKey,
        version: row.version,
        status: row.status,
        notes: row.notes,
        createdAt: row.createdAt,
        summary: core.summarizeTemplate(def),
      }
    })
  }

  async get(templateId: string) {
    const row = await this.loadRow(templateId)
    const def = row.definition as unknown as ChecklistTemplateDefinition
    const stampedChecklistCount = await this.prisma.checklist.count({ where: { templateId } })
    return {
      id: row.id,
      mode: row.mode,
      variantKey: row.variantKey,
      version: row.version,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      definition: def,
      summary: core.summarizeTemplate(def),
      stampedChecklistCount,
    }
  }

  // Part B.3 review queue — all unconfirmed measurements across templates, filterable by
  // mode/variantKey, with per-template AND overall progress counters (the in-app replacement for
  // threshold_review.csv / the activation-gate metric). RETIRED rows are included for visibility
  // (the counter should reflect reality) but their rows are not offered an edit affordance
  // client-side, same as the read view.
  async reviewQueue(filter: { mode?: string; variantKey?: string }) {
    const rows = await this.prisma.checklistTemplate.findMany({
      where: {
        ...(filter.mode ? { mode: filter.mode } : {}),
        ...(filter.variantKey ? { variantKey: filter.variantKey } : {}),
      },
      orderBy: [{ mode: 'asc' }, { variantKey: 'asc' }, { version: 'asc' }],
    })

    let overallConfirmed = 0
    let overallTotal = 0
    const perTemplate = rows.map((row) => {
      const def = row.definition as unknown as ChecklistTemplateDefinition
      const summary = core.summarizeTemplate(def)
      overallConfirmed += summary.confirmedCount
      overallTotal += summary.measurementCount
      return {
        templateId: row.id,
        mode: row.mode,
        variantKey: row.variantKey,
        version: row.version,
        status: row.status,
        confirmed: summary.confirmedCount,
        total: summary.measurementCount,
      }
    })

    const queueRows = rows.flatMap((row) => {
      const def = row.definition as unknown as ChecklistTemplateDefinition
      return core.unconfirmedMeasurementRows(def).map((r) => ({
        templateId: row.id,
        mode: row.mode,
        variantKey: row.variantKey,
        version: row.version,
        status: row.status,
        ...r,
      }))
    })

    return {
      overall: { confirmed: overallConfirmed, total: overallTotal },
      perTemplate,
      rows: queueRows,
    }
  }

  async editMeasurement(templateId: string, nodeCode: string, measurementKey: string, dto: EditMeasurementDto, actorId: string) {
    return this.applyEdit(
      templateId,
      actorId,
      TEMPLATE_THRESHOLD_EDIT,
      nodeCode,
      { measurementKey },
      (def) => core.editMeasurementValue(def, nodeCode, measurementKey, dto),
    )
  }

  async confirmMeasurement(templateId: string, nodeCode: string, measurementKey: string, actorId: string) {
    return this.applyEdit(
      templateId,
      actorId,
      TEMPLATE_THRESHOLD_EDIT,
      nodeCode,
      { measurementKey, confirmOnly: true },
      (def) => core.confirmMeasurement(def, nodeCode, measurementKey),
    )
  }

  async editEra(templateId: string, nodeCode: string, measurementKey: string, dto: EditEraDto, actorId: string) {
    // dto.entry is deliberately shallow-typed (unknown[] tiers) — the real shape check happens
    // downstream in core.editEraOverride's parseTemplateDefinition call, same DTO-boundary
    // convention as EditMeasurementDto.
    const entry = (dto.entry ?? null) as core.EraEntryPatch | null
    if (entry !== null) {
      const law = await this.prisma.lawReference.findUnique({ where: { code: dto.lawCode } })
      if (!law) throw new BadRequestException(`unknown LawReference code "${dto.lawCode}"`)
    }
    return this.applyEdit(
      templateId,
      actorId,
      TEMPLATE_ERA_EDIT,
      nodeCode,
      { measurementKey, lawCode: dto.lawCode },
      (def) => core.editEraOverride(def, nodeCode, measurementKey, dto.lawCode, entry),
    )
  }

  async editGuidance(templateId: string, nodeCode: string, dto: EditGuidanceDto, actorId: string) {
    return this.applyEdit(
      templateId,
      actorId,
      TEMPLATE_THRESHOLD_EDIT,
      nodeCode,
      { field: 'guidance' },
      (def) => core.editGuidance(def, nodeCode, dto.text, dto.reference),
    )
  }

  async addImage(templateId: string, nodeCode: string, file: Express.Multer.File, actorId: string) {
    if (!IMAGE_MIME_TYPES.has(file.mimetype)) throw new BadRequestException('Invalid file type')
    const ext = file.originalname.split('.').pop() ?? 'jpg'
    const key = `${TEMPLATE_IMAGE_KEY_PREFIX}${randomBytes(16).toString('hex')}.${ext}`

    const result = await this.applyEdit(
      templateId,
      actorId,
      TEMPLATE_IMAGE_EDIT,
      nodeCode,
      { field: 'imageKeys', op: 'add' },
      (def) => core.addImageKey(def, nodeCode, key),
    )
    // Upload AFTER the definition write succeeds (incl. cap check + revalidation) — if the cap
    // check throws, nothing is ever put in the bucket, so there's no orphaned object to clean up.
    await this.minio.upload(file.buffer, key, file.mimetype)
    return { ...result, key }
  }

  async removeImage(templateId: string, nodeCode: string, key: string, actorId: string) {
    if (!key.startsWith(TEMPLATE_IMAGE_KEY_PREFIX)) throw new BadRequestException('Invalid key')
    const result = await this.applyEdit(
      templateId,
      actorId,
      TEMPLATE_IMAGE_EDIT,
      nodeCode,
      { field: 'imageKeys', op: 'remove' },
      (def) => core.removeImageKey(def, nodeCode, key),
    )
    await this.minio.remove(key)
    return result
  }

  async exportTemplate(templateId: string) {
    const row = await this.loadRow(templateId)
    const def = row.definition as unknown as ChecklistTemplateDefinition
    return {
      id: row.id,
      mode: row.mode,
      variantKey: row.variantKey,
      version: row.version,
      definition: def,
      eraOverridesExtract: core.deriveEraOverridesExtract(def),
    }
  }
}
