import { randomUUID } from 'crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { ChecklistTemplateDefinition, TransportMode } from '@repo/types'
import { ChecklistTemplateValidationError, FACILITY_CATALOG } from '@repo/types'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'
import * as core from './templates.core'
import { TemplateEditError } from './templates.core'
import {
  buildFacilityGroups,
  detectConflicts,
  isPropagatable,
  type CanonicalItem,
  type FacilityLoadedTemplate,
  type ItemConflict,
  type ItemInstance,
  type TemplateRowStatus,
} from './facility-grouping.core'
import type { GroupedEditDto } from './dto/grouped-edit.dto'
import type { ResolveConflictDto } from './dto/resolve-conflict.dto'
import type { AddAndPlaceDto } from './dto/add-and-place.dto'

// Session S4b — three audit-action names for the grouped editor, distinct from S3a/S3b's
// TEMPLATE_THRESHOLD_EDIT/TEMPLATE_STRUCTURE_EDIT/etc (templates.service.ts): every row a
// propagated edit touches is audited under one of these, all sharing a `correlationId` in the
// audit before/after payload so a bulk edit's full blast radius is reconstructable from the audit
// log alone (Part 3.2: "traceable and reversible in principle").
export const TEMPLATE_CONFLICT_RESOLVE = 'TEMPLATE_CONFLICT_RESOLVE'
export const TEMPLATE_GROUPED_EDIT = 'TEMPLATE_GROUPED_EDIT'
export const TEMPLATE_GROUPED_CONFIRM = 'TEMPLATE_GROUPED_CONFIRM'
// Session S4b-fix, Fix 3 — add-and-place: one NEW item, written to N templates at a chosen position.
export const TEMPLATE_GROUPED_ADD = 'TEMPLATE_GROUPED_ADD'

// Session S4b, Part 5 — which ChecklistTemplate rows the grouping/impact/conflict engine pools.
// 'exact' (a single version number) is the grouped editor's actual default — the v1/v2 -> v3
// migration means "whichever version is ACTUALLY status=ACTIVE per (mode,variantKey)" is a MIX
// today (rail_metro on v3, everything else still on v1), and pooling that mix through a text/
// answerType-based grouping engine built for v3's deep tree would manufacture nonsense conflicts
// between v1's flat `choice` leaves and v3's `presence_standard` re-authoring of the same
// question — see facility-grouping.spec.ts's 'all'-scope comparison test. 'active' and 'all' exist
// for that comparison/analysis use case, not as alternate defaults.
export type VersionScope = { kind: 'exact'; version: number } | { kind: 'active' } | { kind: 'all' }

// Session S4b-fix, Fix 3 — module-level (not method-local) so they're nameable in the emitted
// .d.ts; a method-local `interface` inside addAndPlace compiled fine under jest's transpile-only
// path but failed `tsc --noEmit`'s declaration check (TS4053/4055) since a public method's return
// type can never reference a name private to its own function body.
export interface AddAndPlaceResolved {
  templateId: string
  mode: TransportMode
  variantKey: string
  containerCode: string
  anchorCode: string
  // Present only once actually written (confirm:true) — absent on a confirm:false preview, so the
  // return shape is the SAME object type either way rather than two shapes union-inferred from
  // addAndPlace's two return statements.
  code?: string
}
export interface AddAndPlaceSkipped {
  templateId: string
  mode: string | null
  variantKey: string | null
  reason: string
}

function toInstanceDto(i: ItemInstance) {
  return {
    templateId: i.templateId,
    mode: i.mode,
    variantKey: i.variantKey,
    version: i.version,
    status: i.status,
    containerCode: i.containerCode,
    nodeCode: i.nodeCode,
    labelTh: i.labelTh,
    // Session S4b follow-up — prefill data for the grouped editor's lawRefs/era/image/hidden
    // forms. Read from THIS instance's own current node (the caller picks which instance to treat
    // as "representative" for prefill, typically instances[0]; every OTHER instance's own value
    // is available too via this same shape, for a divergence check before propagating).
    answerType: i.node.answerType,
    facilityCode: i.node.facilityCode,
    lawRefs: i.node.lawRefs ?? [],
    beyondLaw: i.node.beyondLaw ?? false,
    hidden: i.node.hidden ?? false,
    imageKeys: i.node.imageKeys ?? [],
    measurements: (i.node.measurements ?? []).map((m) => ({
      key: m.key,
      operator: m.operator,
      value: m.value ?? null,
      value2: m.value2 ?? null,
      unit: m.unit,
      tiers: m.tiers ?? null,
      byLaw: m.byLaw ?? null,
      autoGrade: m.autoGrade,
      sourceText: m.sourceText ?? null,
      confirmed: m.confirmed ?? false,
    })),
  }
}

@Injectable()
export class FacilityGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Session S4b, Part 5 — resolves a VersionScope into the ChecklistTemplate rows to pool. 'exact'
  // (the grouped editor's real default) behaves exactly as before this addition. 'active' reads
  // whichever row is status=ACTIVE per (mode,variantKey) — TODAY that is a mix of v1 and v3, since
  // only rail_metro's v3 has been activated; useful for a "current production blast radius" view,
  // NOT for grouping/conflict analysis (see the VersionScope doc). 'all' pools every row — analysis
  // only, never exposed as a normal default.
  private async loadTemplates(scope: VersionScope): Promise<FacilityLoadedTemplate[]> {
    const where = scope.kind === 'exact' ? { version: scope.version } : scope.kind === 'active' ? { status: 'ACTIVE' as const } : {}
    const rows = await this.prisma.checklistTemplate.findMany({
      where,
      orderBy: [{ mode: 'asc' }, { variantKey: 'asc' }, { version: 'asc' }],
    })
    if (rows.length === 0) throw new NotFoundException(`no ChecklistTemplate rows matched scope ${JSON.stringify(scope)}`)
    return rows.map((row) => ({
      templateId: row.id,
      mode: row.mode as TransportMode,
      variantKey: row.variantKey,
      version: row.version,
      status: row.status as TemplateRowStatus,
      definition: row.definition as unknown as ChecklistTemplateDefinition,
    }))
  }

  private async computeGroups(scope: VersionScope) {
    const templates = await this.loadTemplates(scope)
    const result = buildFacilityGroups(templates)
    const conflicts = detectConflicts(result)
    return { templates, result, conflicts }
  }

  async getGroups(scope: VersionScope) {
    const { result, conflicts } = await this.computeGroups(scope)
    const conflictByItem = new Map(conflicts.map((c) => [c.canonicalItemId, c]))
    return {
      stats: result.stats,
      containerGroups: result.containerGroups.map((g) => ({
        id: g.id,
        labelTh: g.labelTh,
        facilityTagged: g.facilityTagged,
        instanceCount: g.instances.length,
        breakdown: g.breakdown,
        instances: g.instances.map((i) => ({
          templateId: i.templateId,
          mode: i.mode,
          variantKey: i.variantKey,
          version: i.version,
          status: i.status,
          containerCode: i.containerCode,
        })),
      })),
      canonicalItems: result.canonicalItems.map((item) => ({
        id: item.id,
        containerGroupId: item.containerGroupId,
        labelTh: item.labelTh,
        classification: item.classification,
        instanceCount: item.instances.length,
        breakdown: item.breakdown,
        instances: item.instances.map(toInstanceDto),
        hasConflict: conflictByItem.has(item.id),
        conflictAcknowledged: conflictByItem.get(item.id)?.acknowledged ?? false,
        propagatable: isPropagatable(item),
      })),
    }
  }

  async getConflicts(scope: VersionScope) {
    const { conflicts } = await this.computeGroups(scope)
    return conflicts.map((c) => ({
      canonicalItemId: c.canonicalItemId,
      containerGroupId: c.containerGroupId,
      labelTh: c.labelTh,
      acknowledged: c.acknowledged,
      variants: c.variants.map((v) => ({ signature: v.signature, instances: v.instances.map(toInstanceDto) })),
    }))
  }

  private async findCanonicalItem(scope: VersionScope, canonicalItemId: string): Promise<{ item: CanonicalItem; conflict?: ItemConflict }> {
    const { result, conflicts } = await this.computeGroups(scope)
    const item = result.canonicalItems.find((it) => it.id === canonicalItemId)
    if (!item) {
      throw new NotFoundException(
        `unknown canonical item id "${canonicalItemId}" for scope ${JSON.stringify(scope)} — the grouping may have shifted since it was last fetched (a concurrent edit changed item text/order); refresh and retry`,
      )
    }
    return { item, conflict: conflicts.find((c) => c.canonicalItemId === canonicalItemId) }
  }

  // One write + one audit row per (templateId, nodeCode), all sharing `correlationId` — see the
  // module doc. Mirrors templates.service.ts#applyEdit's RETIRED-only gate exactly, just looped
  // across N rows instead of one.
  private async writeInstance(
    instance: ItemInstance,
    actorId: string,
    action: string,
    correlationId: string,
    extra: Record<string, unknown>,
    edit: (def: ChecklistTemplateDefinition) => { definition: ChecklistTemplateDefinition; before: unknown; after: unknown },
  ): Promise<void> {
    const row = await this.prisma.checklistTemplate.findUnique({ where: { id: instance.templateId } })
    if (!row) throw new NotFoundException(`template ${instance.templateId} not found`)
    if (row.status === 'RETIRED') {
      throw new ForbiddenException(`template ${instance.mode} ${instance.variantKey} is RETIRED; grouped editing is disabled`)
    }
    const def = row.definition as unknown as ChecklistTemplateDefinition

    let result: { definition: ChecklistTemplateDefinition; before: unknown; after: unknown }
    try {
      result = edit(def)
    } catch (err) {
      if (err instanceof TemplateEditError || err instanceof ChecklistTemplateValidationError) {
        throw new BadRequestException(`${instance.mode} ${instance.variantKey} ${instance.nodeCode}: ${(err as Error).message}`)
      }
      throw err
    }

    await this.prisma.checklistTemplate.update({
      where: { id: instance.templateId },
      data: { definition: result.definition as unknown as Prisma.InputJsonValue },
    })

    await this.auditLog.log({
      userId: actorId,
      action,
      entityType: 'ChecklistTemplate',
      entityId: instance.templateId,
      before: { correlationId, nodeCode: instance.nodeCode, ...extra, value: result.before },
      after: { correlationId, nodeCode: instance.nodeCode, ...extra, value: result.after },
    })
  }

  // Part 3.2 — edit a canonical item ONCE, write it to every instance. GATED on isPropagatable:
  // a live conflict or a lone (mode-specific) instance both refuse here, never silently pick a
  // side. The frontend already has the exact target list from getGroups()'s `instances[]` — this
  // endpoint performs the write, it doesn't need to hand back a separate preview.
  async propagateItemEdit(scope: VersionScope, canonicalItemId: string, actorId: string, dto: GroupedEditDto) {
    const { item } = await this.findCanonicalItem(scope, canonicalItemId)
    if (!isPropagatable(item)) {
      throw new BadRequestException({
        code: 'ITEM_NOT_PROPAGATABLE',
        message:
          item.instances.length < 2
            ? 'รายการนี้มีอยู่ในแบบประเมินเดียว ไม่มีที่ให้เผยแพร่การแก้ไข'
            : 'รายการนี้มีข้อมูลไม่ตรงกันระหว่างแบบประเมิน ต้องแก้ไขความขัดแย้งก่อนจึงจะเผยแพร่การแก้ไขพร้อมกันได้',
      })
    }

    const correlationId = randomUUID()
    let wrote = 0

    for (const instance of item.instances) {
      // 'remove' on an image key an instance never had would otherwise throw partway through the
      // fan-out (removeImageKey is intentionally strict — see templates.core.ts), aborting the
      // remaining writes. Skip it here, same defensive pattern as resolveConflict's "already
      // matches the winner" skip — a no-op for that instance, not a failure for the whole batch.
      if (dto.field === 'image' && dto.imageOp === 'remove' && !instance.node.imageKeys?.includes(dto.imageKey ?? '')) {
        continue
      }
      await this.writeInstance(instance, actorId, TEMPLATE_GROUPED_EDIT, correlationId, { field: dto.field, canonicalItemId }, (def) =>
        applyGroupedPatch(def, instance.nodeCode, dto),
      )
      wrote++
    }

    return {
      correlationId,
      field: dto.field,
      wroteCount: wrote,
      targets: item.instances.map(toInstanceDto),
    }
  }

  // Part 4.1 — collapses the confirmed-flag review queue: confirming a canonical measurement
  // confirms every instance that carries that measurement key in one action.
  async confirmGroupedMeasurement(scope: VersionScope, canonicalItemId: string, measurementKey: string, actorId: string) {
    const { item } = await this.findCanonicalItem(scope, canonicalItemId)
    const correlationId = randomUUID()
    let wrote = 0
    for (const instance of item.instances) {
      const hasMeasurement = instance.node.measurements?.some((m) => m.key === measurementKey)
      if (!hasMeasurement) continue
      await this.writeInstance(
        instance,
        actorId,
        TEMPLATE_GROUPED_CONFIRM,
        correlationId,
        { measurementKey, canonicalItemId, confirmOnly: true },
        (def) => core.confirmMeasurement(def, instance.nodeCode, measurementKey),
      )
      wrote++
    }
    return { correlationId, wroteCount: wrote }
  }

  // Part 2.2 — the conflict-resolution gate itself. 'split' stamps every divergent instance
  // acknowledged (no data changes — see acknowledgeConflictSplit's doc); 'winner' copies one
  // variant's exact answerType+measurements onto every instance that doesn't already match it,
  // which is self-resolving: the next getConflicts() call finds no divergence left for this item.
  async resolveConflict(scope: VersionScope, canonicalItemId: string, actorId: string, dto: ResolveConflictDto) {
    const { item, conflict } = await this.findCanonicalItem(scope, canonicalItemId)
    if (!conflict) throw new BadRequestException('this canonical item has no live conflict to resolve')

    const correlationId = randomUUID()

    if (dto.resolution === 'split') {
      for (const instance of item.instances) {
        await this.writeInstance(
          instance,
          actorId,
          TEMPLATE_CONFLICT_RESOLVE,
          correlationId,
          { canonicalItemId, resolution: 'split', notes: dto.notes ?? null },
          (def) => core.acknowledgeConflictSplit(def, instance.nodeCode),
        )
      }
      return { correlationId, resolution: 'split' as const, wroteCount: item.instances.length }
    }

    if (!dto.winnerSignature) throw new BadRequestException('winnerSignature is required when resolution="winner"')
    const winnerVariant = conflict.variants.find((v) => v.signature === dto.winnerSignature)
    if (!winnerVariant) throw new BadRequestException('winnerSignature does not match any current variant of this conflict — refresh and retry')
    const sourceNode = winnerVariant.instances[0]!.node

    let wrote = 0
    for (const instance of item.instances) {
      const alreadyMatches =
        instance.node.answerType === sourceNode.answerType &&
        JSON.stringify(instance.node.measurements ?? []) === JSON.stringify(sourceNode.measurements ?? [])
      if (alreadyMatches) continue
      await this.writeInstance(
        instance,
        actorId,
        TEMPLATE_CONFLICT_RESOLVE,
        correlationId,
        { canonicalItemId, resolution: 'winner', winnerSignature: dto.winnerSignature },
        (def) => core.overwriteLeafData(def, instance.nodeCode, sourceNode),
      )
      wrote++
    }
    return { correlationId, resolution: 'winner' as const, wroteCount: wrote }
  }

  // Part 4 — the S3a review queue, collapsed by canonical item: N physical unconfirmed rows
  // sharing the same (container group, item text, measurement key) become ONE queue row carrying
  // an instance count. Per-template confirmed/total counters (Part 4.2) still come from
  // templates.service.ts#reviewQueue unchanged — this is the additional grouped VIEW, not a
  // replacement for the activation-gate metric.
  // Session S4b-fix, Fix 3 — add-and-place: create ONE new item and apply it to N templates at a
  // chosen position, resolving the insertion point + anchor PER TARGET rather than requiring the
  // caller to know each template's own codes. `dto.confirm: false` resolves and reports without
  // writing (the frontend's preview step); `true` performs the writes, gated exactly like the
  // individual structural editor (DRAFT-only — see templates.service.ts#applyStructuralEdit's doc)
  // since this IS a structural add, just fanned out. A target where the anchor has no instance in
  // that template, or the template isn't a DRAFT, is SKIPPED with a reason — never guessed at.
  async addAndPlace(scope: VersionScope, dto: AddAndPlaceDto, actorId: string) {
    const { result } = await this.computeGroups(scope)

    // Resolves, per target templateId, which node/group to insert INTO (`intoCode`) and which
    // sibling to insert before/after (`anchorCode`) — see AddAndPlaceDto's doc for why the anchor
    // can be either a canonical (leaf) item or a container group (a top-level item in its own
    // right, like TTRS). Both instance shapes already carry a (parent, own) code pair; this just
    // picks the right one, once, rather than duplicating the whole resolve loop per anchor kind.
    let anchorLabel: string
    let instanceFor: (templateId: string) => { intoCode: string; anchorCode: string } | undefined
    if (dto.anchorItemId) {
      const anchorItem = result.canonicalItems.find((it) => it.id === dto.anchorItemId)
      if (!anchorItem) throw new NotFoundException(`unknown anchorItemId "${dto.anchorItemId}"`)
      anchorLabel = anchorItem.labelTh
      instanceFor = (templateId) => {
        const inst = anchorItem.instances.find((i) => i.templateId === templateId)
        return inst ? { intoCode: inst.containerCode, anchorCode: inst.nodeCode } : undefined
      }
    } else if (dto.anchorContainerGroupId) {
      const anchorGroup = result.containerGroups.find((g) => g.id === dto.anchorContainerGroupId)
      if (!anchorGroup) throw new NotFoundException(`unknown anchorContainerGroupId "${dto.anchorContainerGroupId}"`)
      anchorLabel = anchorGroup.labelTh
      instanceFor = (templateId) => {
        const inst = anchorGroup.instances.find((i) => i.templateId === templateId)
        return inst ? { intoCode: inst.groupCode, anchorCode: inst.containerCode } : undefined
      }
    } else {
      throw new BadRequestException('either anchorItemId or anchorContainerGroupId is required')
    }

    const rows = await this.prisma.checklistTemplate.findMany({ where: { id: { in: dto.targetTemplateIds } } })
    const rowById = new Map(rows.map((r) => [r.id, r]))

    const resolved: AddAndPlaceResolved[] = []
    const skipped: AddAndPlaceSkipped[] = []

    for (const templateId of dto.targetTemplateIds) {
      const row = rowById.get(templateId)
      if (!row) {
        skipped.push({ templateId, mode: null, variantKey: null, reason: 'ไม่พบแบบประเมินนี้' })
        continue
      }
      const inst = instanceFor(templateId)
      if (!inst) {
        skipped.push({ templateId, mode: row.mode, variantKey: row.variantKey, reason: `ไม่พบรายการอ้างอิง "${anchorLabel}" ในแบบประเมินนี้ (ไม่แน่ใจตำแหน่ง)` })
        continue
      }
      if (row.status !== 'DRAFT') {
        skipped.push({ templateId, mode: row.mode, variantKey: row.variantKey, reason: 'ไม่ใช่เวอร์ชันร่าง — สร้างเวอร์ชันร่างใหม่ก่อน' })
        continue
      }
      resolved.push({ templateId, mode: row.mode as TransportMode, variantKey: row.variantKey, containerCode: inst.intoCode, anchorCode: inst.anchorCode })
    }

    // facilityCode -> lawRefs/cabinetResolution/beyondLaw, same resolution tagContainers would do —
    // unless the caller already supplied lawRefs explicitly, which wins.
    let lawRefs = dto.content.lawRefs
    let cabinetResolution: boolean | undefined
    let beyondLaw: boolean | undefined
    if (dto.content.facilityCode !== undefined) {
      const entry = FACILITY_CATALOG.find((e) => e.code === dto.content.facilityCode)
      if (!entry) throw new BadRequestException(`unknown facilityCode ${dto.content.facilityCode}`)
      if (!lawRefs) lawRefs = [...entry.lawRefs]
      cabinetResolution = entry.cabinetResolution
      beyondLaw = entry.beyondLaw
    }

    if (!dto.confirm) {
      return { correlationId: null as string | null, wroteCount: 0, resolved, skipped }
    }
    if (resolved.length === 0) {
      throw new BadRequestException('ไม่มีเป้าหมายที่เขียนได้ — ทุกแบบประเมินถูกข้าม ดูเหตุผลใน skipped[]')
    }

    const correlationId = randomUUID()
    const written: AddAndPlaceResolved[] = []
    for (const target of resolved) {
      const code = await this.writeStructuralAdd(target.templateId, actorId, correlationId, {
        containerCode: target.containerCode,
        anchorCode: target.anchorCode,
        side: dto.side,
        content: { ...dto.content, lawRefs, cabinetResolution, beyondLaw },
      })
      written.push({ ...target, code })
    }

    return { correlationId: correlationId as string | null, wroteCount: written.length, resolved: written, skipped }
  }

  // Structural-add write for ONE target, gated exactly like TemplatesAdminService#applyStructuralEdit
  // (DRAFT-only — a bare ForbiddenException with the same error code so the frontend can render the
  // same message it already has for that gate). Kept local to this service rather than reused from
  // TemplatesAdminService since that service has no notion of a fan-out correlationId.
  private async writeStructuralAdd(
    templateId: string,
    actorId: string,
    correlationId: string,
    spec: { containerCode: string; anchorCode: string; side: 'before' | 'after'; content: core.AddPositionedChildPatch },
  ): Promise<string> {
    const row = await this.prisma.checklistTemplate.findUnique({ where: { id: templateId } })
    if (!row) throw new NotFoundException(`template ${templateId} not found`)
    if (row.status !== 'DRAFT') {
      throw new ForbiddenException({ code: 'STRUCTURE_EDIT_REQUIRES_DRAFT', message: 'โครงสร้างแก้ไขได้ในเวอร์ชันร่างเท่านั้น' })
    }
    const def = row.definition as unknown as ChecklistTemplateDefinition

    let result: { definition: ChecklistTemplateDefinition; code: string }
    try {
      result = core.addPositionedChildNode(def, spec.containerCode, spec.anchorCode, spec.side, spec.content)
    } catch (err) {
      if (err instanceof TemplateEditError || err instanceof ChecklistTemplateValidationError) {
        throw new BadRequestException(`${templateId}: ${(err as Error).message}`)
      }
      throw err
    }

    await this.prisma.checklistTemplate.update({
      where: { id: templateId },
      data: { definition: result.definition as unknown as Prisma.InputJsonValue },
    })

    await this.auditLog.log({
      userId: actorId,
      action: TEMPLATE_GROUPED_ADD,
      entityType: 'ChecklistTemplate',
      entityId: templateId,
      before: { correlationId, containerCode: spec.containerCode, anchorCode: spec.anchorCode, side: spec.side },
      after: { correlationId, newCode: result.code, labelTh: spec.content.labelTh },
    })

    return result.code
  }

  async getGroupedReviewQueue(scope: VersionScope) {
    const { result } = await this.computeGroups(scope)
    const rows: {
      canonicalItemId: string
      containerGroupId: string
      labelTh: string
      // Fix 2 — a representative code (lowest by the frontend's natural-sort order among the
      // instances carrying this measurement) so the queue can be read/sorted in checklist order
      // instead of grouping-engine order; purely a display aid, never used to identify a write
      // target (propagation still fans out to every instance via canonicalItemId, unchanged).
      sampleNodeCode: string
      measurementKey: string
      operator: string
      unit: string
      value: number | null
      instanceCount: number
      unconfirmedCount: number
    }[] = []

    for (const item of result.canonicalItems) {
      const measurementKeys = new Set<string>()
      for (const inst of item.instances) for (const m of inst.node.measurements ?? []) measurementKeys.add(m.key)

      for (const key of measurementKeys) {
        const withKey = item.instances.filter((inst) => inst.node.measurements?.some((m) => m.key === key))
        const unconfirmed = withKey.filter((inst) => !inst.node.measurements!.find((m) => m.key === key)!.confirmed)
        if (unconfirmed.length === 0) continue
        const sample = unconfirmed[0]!.node.measurements!.find((m) => m.key === key)!
        rows.push({
          canonicalItemId: item.id,
          containerGroupId: item.containerGroupId,
          labelTh: item.labelTh,
          sampleNodeCode: unconfirmed[0]!.nodeCode,
          measurementKey: key,
          operator: sample.operator,
          unit: sample.unit,
          value: sample.value ?? null,
          instanceCount: withKey.length,
          unconfirmedCount: unconfirmed.length,
        })
      }
    }

    const totalUnconfirmedRows = rows.reduce((sum, r) => sum + r.unconfirmedCount, 0)
    return { rows, totalUnconfirmedRows, distinctRows: rows.length }
  }
}

function applyGroupedPatch(def: ChecklistTemplateDefinition, nodeCode: string, dto: GroupedEditDto) {
  switch (dto.field) {
    case 'measurement': {
      if (!dto.measurementKey || !dto.measurement) throw new TemplateEditError('measurementKey and measurement are required for field="measurement"')
      return core.editMeasurementValue(def, nodeCode, dto.measurementKey, dto.measurement as core.MeasurementValuePatch)
    }
    case 'guidance': {
      if (!dto.guidance) throw new TemplateEditError('guidance is required for field="guidance"')
      return core.editGuidance(def, nodeCode, dto.guidance.text, dto.guidance.reference)
    }
    case 'lawRefs': {
      if (!dto.lawRefs) throw new TemplateEditError('lawRefs is required for field="lawRefs"')
      return core.editLawRefs(def, nodeCode, dto.lawRefs.lawRefs, dto.lawRefs.beyondLaw)
    }
    case 'hidden': {
      if (!dto.hidden) throw new TemplateEditError('hidden is required for field="hidden"')
      return core.editHidden(def, nodeCode, dto.hidden.hidden)
    }
    case 'label': {
      if (!dto.label) throw new TemplateEditError('label is required for field="label"')
      return core.editNodeLabel(def, nodeCode, dto.label.labelTh, dto.label.num)
    }
    case 'era': {
      if (!dto.measurementKey || !dto.era) throw new TemplateEditError('measurementKey and era are required for field="era"')
      return core.editEraOverride(def, nodeCode, dto.measurementKey, dto.era.lawCode, (dto.era.entry ?? null) as core.EraEntryPatch | null)
    }
    case 'image': {
      if (!dto.imageKey) throw new TemplateEditError('imageKey is required for field="image"')
      return dto.imageOp === 'remove' ? core.removeImageKey(def, nodeCode, dto.imageKey) : core.addImageKey(def, nodeCode, dto.imageKey)
    }
    default:
      throw new TemplateEditError(`unknown field "${dto.field as string}"`)
  }
}
