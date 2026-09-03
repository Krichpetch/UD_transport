import { randomBytes, randomUUID } from 'crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type MasterCriterion } from '@prisma/client'
import type { ChecklistTemplateDefinition, TemplateAnswerType, TransportMode } from '@repo/types'
import { ChecklistTemplateValidationError, indexTemplateNodesByCode, LAW_REFERENCE_SEED } from '@repo/types'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'
import * as core from './templates.core'
import { TemplateEditError } from './templates.core'
import {
  buildFacilityGroups,
  detectConflicts,
  extendedFieldsAgree,
  flattenLeaves,
  flattenTree,
  isPropagatable,
  type CanonicalItem,
  type FacilityLoadedTemplate,
  type InstanceBreakdown,
  type ItemConflict,
  type ItemInstance,
  type TemplateRowStatus,
} from './facility-grouping.core'
import { isNodeAttached, pushMasterToInstance, snapshotWriteThroughFields, type MasterCriterionPayload, type WriteThroughFields } from './master-criteria.core'
import { TEMPLATE_MASTER_CREATE, TEMPLATE_MASTER_EDIT } from './master-criteria.service'
import type { GroupedEditDto } from './dto/grouped-edit.dto'
import type { ResolveConflictDto } from './dto/resolve-conflict.dto'
import type { AddAndPlaceDto } from './dto/add-and-place.dto'
import type { AttachNodeToGroupDto } from './dto/attach-node-to-group.dto'
import type { DeleteGroupDto } from './dto/delete-group.dto'

// Json columns need the JsonNull sentinel for "set SQL NULL" — see master-criteria.service.ts's
// own copy of this helper for why a bare JS null/undefined isn't enough.
function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue)
}

// Normalizes a WriteThroughFields snapshot (optional arrays, TemplateNode-shaped) into a full
// MasterCriterionPayload (required imageKeys/lawRefs arrays, master-row-shaped) — the same
// coercion applyMasterToNode's caller-side already assumes (master-criteria.core.ts).
function toMasterPayload(id: string, fields: WriteThroughFields): MasterCriterionPayload {
  return {
    id,
    labelTh: fields.labelTh,
    answerType: fields.answerType ?? null,
    measurements: fields.measurements ?? null,
    guidance: fields.guidance ?? null,
    imageKeys: fields.imageKeys ?? [],
    lawRefs: fields.lawRefs ?? [],
    cabinetResolution: fields.cabinetResolution ?? null,
    beyondLaw: fields.beyondLaw ?? null,
    facilityCode: fields.facilityCode ?? null,
  }
}

// Era-editor safety session, Part E — the master-ROW sibling of toMasterPayload above (which
// builds a payload from a WriteThroughFields snapshot). Needed because attachNodeToGroup, after
// atomicMasterPush guarantees the target has a master row, re-reads that row from Prisma and must
// hand pushMasterToInstance a MasterCriterionPayload, not a raw MasterCriterion. Deliberately its
// own name (not a second `toMasterPayload` overload) since the two take incompatible argument
// shapes — mirrors templates.service.ts's own identically-shaped (but not reused, per that file's
// own doc on why: apps/api's rootDir constraint keeps prisma/ scripts from importing src/) local
// helper of the same intent.
function masterRowToPayload(master: MasterCriterion): MasterCriterionPayload {
  return {
    id: master.id,
    labelTh: master.labelTh,
    answerType: master.answerType as TemplateAnswerType | null,
    measurements: master.measurements as MasterCriterionPayload['measurements'],
    guidance: master.guidance as MasterCriterionPayload['guidance'],
    imageKeys: master.imageKeys,
    lawRefs: master.lawRefs,
    cabinetResolution: master.cabinetResolution,
    beyondLaw: master.beyondLaw,
    facilityCode: master.facilityCode,
  }
}

function masterRowData(payload: MasterCriterionPayload, actorId: string) {
  return {
    labelTh: payload.labelTh,
    answerType: payload.answerType ?? null,
    measurements: jsonInput(payload.measurements),
    guidance: jsonInput(payload.guidance),
    imageKeys: payload.imageKeys,
    lawRefs: payload.lawRefs,
    cabinetResolution: payload.cabinetResolution ?? null,
    beyondLaw: payload.beyondLaw ?? null,
    facilityCode: payload.facilityCode ?? null,
    updatedBy: actorId,
  }
}

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
// Live feedback (2026-08-17) — delete-group: the symmetric counterpart, removing a canonical
// item's instances from N chosen templates at once.
export const TEMPLATE_GROUPED_DELETE = 'TEMPLATE_GROUPED_DELETE'
// Era-editor safety session, Part E — a node that WASN'T master-attached moves onto a DIFFERENT
// existing group. Distinct from TEMPLATE_MASTER_REATTACH (templates.service.ts — "back to the same
// master you detached from") so the audit trail can tell "moved to a different group" apart from an
// ordinary reattach.
export const TEMPLATE_MASTER_MOVE = 'TEMPLATE_MASTER_MOVE'

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

// Live feedback (2026-08-17) — delete-group's own resolved/skipped shapes, same module-level
// reasoning as AddAndPlaceResolved/AddAndPlaceSkipped above (nameable in the emitted .d.ts).
export interface DeleteGroupResolved {
  templateId: string
  mode: TransportMode
  variantKey: string
  nodeCode: string
  labelTh: string
}
export interface DeleteGroupSkipped {
  templateId: string
  mode: string | null
  variantKey: string | null
  reason: string
}

// Session S5-fix (round 2) — the recursive DTO shape getGroups() returns. Declared explicitly
// (rather than inferred) since a recursive `children: GroupNodeDto[]` needs a named type for
// TypeScript to resolve the self-reference.
export interface GroupNodeDto {
  id: string
  parentId: string | null
  depth: number
  labelTh: string
  isLeaf: boolean
  classification: 'SHARED' | 'MODE_SPECIFIC'
  instanceCount: number
  breakdown: InstanceBreakdown
  facilityTagged: boolean
  // Session S5-fix (round 3) — this node's own FACILITY_CATALOG code (@repo/types), undefined if
  // untagged. Used by the frontend to sort depth-0 groups by catalog order instead of document
  // order; untagged groups sort to the bottom.
  facilityCode?: number
  masterId?: string
  sortKey: number
  instances: ReturnType<typeof toInstanceDto>[]
  hasConflict: boolean
  conflictAcknowledged: boolean
  propagatable: boolean
  children: GroupNodeDto[]
}

function toInstanceDto(i: ItemInstance) {
  return {
    templateId: i.templateId,
    mode: i.mode,
    variantKey: i.variantKey,
    version: i.version,
    status: i.status,
    parentCode: i.parentCode,
    nodeCode: i.nodeCode,
    labelTh: i.labelTh,
    // Session S4b follow-up — prefill data for the grouped editor's lawRefs/era/image/hidden
    // forms. Read from THIS instance's own current node (the caller picks which instance to treat
    // as "representative" for prefill, typically instances[0]; every OTHER instance's own value
    // is available too via this same shape, for a divergence check before propagating). Meaningful
    // for a container instance too (round 2) — answerType/measurements just come back
    // empty/undefined, exactly reflecting that this node has nothing of its own to answer.
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
    private readonly minio: MinioService,
  ) {}

  // Upload-only — no node write. The per-node endpoint (templates.service.ts#addImage) commits the
  // key onto ONE node via applyEdit, which is guarded by assertNotAttached: fine for the individual
  // editor (a direct edit on an attached leaf should be rejected), but wrong here, since a group's
  // representative instance is very often ALREADY attached to a master by the time an admin adds a
  // picture to it. propagateItemEdit's 'image' field already writes the resulting key to every
  // instance through the master-aware path (propagateThroughMaster/atomicMasterPush, which reads/
  // writes the definition directly and never calls assertNotAttached) — this endpoint only needs to
  // get the bytes into MinIO and hand back the key for that call to use.
  async uploadImage(file: Express.Multer.File) {
    if (!core.IMAGE_MIME_TYPES.has(file.mimetype)) throw new BadRequestException('Invalid file type')
    const ext = file.originalname.split('.').pop() ?? 'jpg'
    const key = `${core.TEMPLATE_IMAGE_KEY_PREFIX}${randomBytes(16).toString('hex')}.${ext}`
    await this.minio.upload(file.buffer, key, file.mimetype)
    return { key }
  }

  // Session S4b, Part 5 — resolves a VersionScope into the ChecklistTemplate rows to pool. 'exact'
  // (the grouped editor's real default) behaves exactly as before this addition. 'active' reads
  // whichever row is status=ACTIVE per (mode,variantKey) — TODAY that is a mix of v1 and v3, since
  // only rail_metro's v3 has been activated; useful for a "current production blast radius" view,
  // NOT for grouping/conflict analysis (see the VersionScope doc). 'all' pools every row — analysis
  // only, never exposed as a normal default.
  //
  // RETIRED-exclusion (grouped-editing fix) — 'exact' additionally excludes RETIRED rows. 'exact' is
  // the editor's only write scope, and a single RETIRED instance in a group used to poison the whole
  // group: writeInstance/confirm/resolve all throw ForbiddenException on it (see their guards below),
  // blocking edits to the group's still-ACTIVE/DRAFT siblings. A retired template is not an edit
  // target, so it shouldn't be a group member here at all — excluding it lets the active siblings be
  // edited, while a group whose ONLY members were retired simply disappears from the editor (correct:
  // nothing there is editable). 'active' already excludes RETIRED by construction; 'all' deliberately
  // still surfaces it — that scope is the read-only comparison/analysis view, never a write path.
  private async loadTemplates(scope: VersionScope): Promise<FacilityLoadedTemplate[]> {
    const where =
      scope.kind === 'exact'
        ? { version: scope.version, status: { not: 'RETIRED' as const } }
        : scope.kind === 'active'
          ? { status: 'ACTIVE' as const }
          : {}
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

  // Session S5-fix (round 2) — the recursive tree DTO builder (depth-0 roots, each carrying its own
  // subtree via `children`). A leaf and a container are the same DTO shape (isLeaf discriminates);
  // the frontend renders/edits both uniformly, matching TemplateTree.tsx's own "every node is
  // selectable" behavior. `sortKey` orders siblings by where they actually appear in the source
  // checklist, not by id or count. Extracted to its own method (UDT-60) so getGroupsByLaw below can
  // reuse the exact same node shape for its law-bucketed `items[]`, rather than re-deriving it.
  private toGroupNodeDto(node: CanonicalItem, conflictByItem: Map<string, ItemConflict>): GroupNodeDto {
    return {
      id: node.id,
      parentId: node.parentId,
      depth: node.depth,
      labelTh: node.labelTh,
      isLeaf: node.isLeaf,
      classification: node.classification,
      instanceCount: node.instances.length,
      breakdown: node.breakdown,
      facilityTagged: node.facilityTagged,
      facilityCode: node.facilityCode,
      masterId: node.masterId,
      sortKey: node.sortKey,
      instances: node.instances.map(toInstanceDto),
      hasConflict: conflictByItem.has(node.id),
      conflictAcknowledged: conflictByItem.get(node.id)?.acknowledged ?? false,
      propagatable: isPropagatable(node),
      children: node.children.map((c) => this.toGroupNodeDto(c, conflictByItem)),
    }
  }

  async getGroups(scope: VersionScope) {
    const { result, conflicts } = await this.computeGroups(scope)
    const conflictByItem = new Map(conflicts.map((c) => [c.canonicalItemId, c]))
    return {
      stats: result.stats,
      containerGroups: result.containerGroups.map((n) => this.toGroupNodeDto(n, conflictByItem)),
    }
  }

  // UDT-60 — law-centric lens onto the SAME canonical leaves getGroups() already computes: no new
  // persisted data model, this just re-buckets the existing grouped-editor leaves by the law codes
  // present in each one's `lawRefs` (leaf-only, same invariant propagateItemEdit's field guard and
  // GroupedItemEditDialog rely on — see this file's propagateItemEdit doc). A leaf can legitimately
  // require more than one law and so appears under more than one bucket; a leaf with no lawRefs at
  // all surfaces under `unassigned` instead of silently vanishing from this view. Editing happens
  // through the SAME propagateItemEdit endpoint (field 'lawRefs'/'era') the grouped editor already
  // uses — this endpoint is read-only, a different lens on the same writable items.
  async getGroupsByLaw(scope: VersionScope) {
    const { result, conflicts } = await this.computeGroups(scope)
    const conflictByItem = new Map(conflicts.map((c) => [c.canonicalItemId, c]))
    const leaves = flattenLeaves(result.containerGroups)

    const byCode = new Map<string, CanonicalItem[]>()
    const unassigned: CanonicalItem[] = []
    for (const leaf of leaves) {
      const lawRefs = leaf.instances[0]?.node.lawRefs ?? []
      if (lawRefs.length === 0) {
        unassigned.push(leaf)
        continue
      }
      for (const code of lawRefs) {
        if (!byCode.has(code)) byCode.set(code, [])
        byCode.get(code)!.push(leaf)
      }
    }

    const laws = LAW_REFERENCE_SEED.map((law) => {
      const items = (byCode.get(law.code) ?? []).map((n) => this.toGroupNodeDto(n, conflictByItem))
      return {
        code: law.code,
        nameTh: law.nameTh,
        ministry: law.ministry,
        buddhistYear: law.buddhistYear,
        effectiveYear: law.effectiveYear ?? null,
        effectiveDate: law.effectiveDate ?? null,
        isFloor: law.isFloor ?? false,
        itemCount: items.length,
        items,
      }
    })

    return {
      laws,
      unassigned: {
        itemCount: unassigned.length,
        items: unassigned.map((n) => this.toGroupNodeDto(n, conflictByItem)),
      },
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

  // Session S5-fix (round 2) — searches the WHOLE tree (any depth, leaf or container), not just
  // the old flat leaf list, since every node (not only leaves) is now an independent edit/propagate
  // target (label/images/lawRefs/hidden at minimum — see propagateItemEdit's doc).
  private async findCanonicalItem(scope: VersionScope, canonicalItemId: string): Promise<{ item: CanonicalItem; conflict?: ItemConflict }> {
    const { result, conflicts } = await this.computeGroups(scope)
    const item = flattenTree(result.containerGroups).find((it) => it.id === canonicalItemId)
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

  // Session S5-fix, Part B — promote-on-edit. The grouped editor is now the ONLY surface for master
  // criteria (Part A removed the standalone /admin/master-criteria page). Editing a canonical item
  // that has no master yet transparently creates one — seeded from the group's current, already
  // conflict-free values (isPropagatable is the SAME gate a plain propagate always used, and still
  // guards promotion: a live conflict blocks exactly as before, never auto-picks a side) — links
  // every instance to it, then applies the admin's edit through the master's atomic push. One user
  // action, two internal steps, in one transaction (mirrors master-criteria.service.ts#update's own
  // shape). Editing an already-promoted item reuses its existing masterId, no re-fuzzy-match.
  //
  // Session S5-fix (round 2) — this now applies at ANY depth, not just leaves: a pure container
  // node (isLeaf: false, no answerType anywhere) is just as promotable, for its label/images
  // fields.
  //
  // Session S5-fix (round 4) — 'measurement'/'era'/'guidance'/'lawRefs' are ALL leaf-only, rejected
  // up front on a non-leaf item rather than silently no-op'ing. lawRefs joined this list because
  // facility-tagging.ts documents it as a leaf-only concept throughout this codebase (a container's
  // own lawRefs is never seed-tagged and has zero effect on era-resolution.ts#isItemApplicable,
  // which only ever reads it off a node WITH answerType) — offering it on a container was
  // misleading (an always-empty checkbox row that looked like "no law enforced" rather than "not
  // applicable at this level") and, worse, primed the wholesale push below to blast that empty
  // value over sibling containers the moment ANY other field got edited.
  //
  // Also round 4 — extendedFieldsAgree is a SECOND gate alongside isPropagatable, checked for every
  // non-'hidden' field: isPropagatable/leafDataSignature only compares answerType+measurements, so
  // a leaf item can be "propagatable" while its instances still diverge in lawRefs/facilityCode/
  // cabinetResolution/beyondLaw — none of which the fuzzy conflict engine was ever asked to
  // compare. Without this, editing something as unrelated as the LABEL would wholesale-push
  // whichever instance happened to be "representative"'s lawRefs over every other instance,
  // silently discarding real era-override/law-applicability data nobody touched.
  //
  // 'hidden' is the one remaining GroupedEditField the master doesn't own (master-criteria.core.ts's
  // WriteThroughFields is deliberately 9 fields, not 10 — visibility may legitimately differ per
  // instance even for an otherwise-identical criterion); it always goes through the plain
  // per-instance write path below, promoted or not, and never creates or touches a master, so
  // neither gate above applies to it.
  async propagateItemEdit(scope: VersionScope, canonicalItemId: string, actorId: string, dto: GroupedEditDto) {
    const { item } = await this.findCanonicalItem(scope, canonicalItemId)
    if ((dto.field === 'measurement' || dto.field === 'era' || dto.field === 'guidance' || dto.field === 'lawRefs') && !item.isLeaf) {
      throw new BadRequestException(`field "${dto.field}" only applies to a leaf item — this node is a container with its own sub-items`)
    }

    // UDT-61, Part 2 — a single-instance item exists in exactly one template: there is no second
    // instance to fan out to, and no shared MasterCriterion is warranted (a master models data
    // that's SHARED across instances — see propagateThroughMaster's doc). Route straight to the
    // same plain per-instance write path 'hidden' already used below; it degrades correctly to "one
    // write, one audit row" when item.instances has exactly one element. This used to be a hard
    // BadRequestException ("รายการนี้มีอยู่ในแบบประเมินเดียว ไม่มีที่ให้เผยแพร่การแก้ไข") — a single-
    // mode item was, until now, permanently uneditable from this endpoint.
    if (item.instances.length === 1) {
      return this.propagateDirectFieldEdit(item, actorId, dto)
    }

    if (!isPropagatable(item)) {
      throw new BadRequestException({
        code: 'ITEM_NOT_PROPAGATABLE',
        message: 'รายการนี้มีข้อมูลไม่ตรงกันระหว่างแบบประเมิน ต้องแก้ไขความขัดแย้งก่อนจึงจะเผยแพร่การแก้ไขพร้อมกันได้',
      })
    }

    if (dto.field === 'hidden') {
      return this.propagateDirectFieldEdit(item, actorId, dto)
    }
    if (!extendedFieldsAgree(item)) {
      throw new BadRequestException({
        code: 'ITEM_NOT_PROPAGATABLE',
        message:
          'ข้อยกเว้นทางกฎหมาย (lawRefs) หรือหมวดหมู่สิ่งอำนวยความสะดวกของรายการนี้ไม่ตรงกันระหว่างแบบประเมิน — การแก้ไขผ่านต้นแบบจะเขียนทับค่าที่ต่างกันนี้ กรุณาแก้ไขให้ตรงกันทีละแบบประเมินก่อน (ผ่านหน้าแก้ไขรายละเอียดแบบประเมิน) แล้วค่อยกลับมาแก้ไขตามกลุ่ม',
      })
    }
    return this.propagateThroughMaster(item, actorId, dto)
  }

  // Unchanged since before Session S5-fix — every field used to write this way; kept exactly for
  // 'hidden', the one field the master doesn't model (see propagateItemEdit's doc above).
  private async propagateDirectFieldEdit(item: CanonicalItem, actorId: string, dto: GroupedEditDto) {
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
      await this.writeInstance(instance, actorId, TEMPLATE_GROUPED_EDIT, correlationId, { field: dto.field, canonicalItemId: item.id }, (def) =>
        applyGroupedPatch(def, instance.nodeCode, dto),
      )
      wrote++
    }

    return {
      correlationId,
      field: dto.field,
      // 'hidden' never touches a master — same result shape as atomicMasterPush's return so
      // propagateItemEdit's two branches type as one consistent union, not two incompatible ones.
      masterId: undefined as string | undefined,
      promoted: false,
      wroteCount: wrote,
      targets: item.instances.map(toInstanceDto),
    }
  }

  // Session S5-fix, Part B — computes the edit's resulting node state ONCE (by applying it, via the
  // same field-specific templates.core.ts functions every other edit path already uses, to a
  // representative instance's OWN current definition — any instance works, isPropagatable already
  // guarantees they agree on answerType/measurements), then pushes that as the master's new
  // write-through snapshot to every instance atomically, creating the master on first use. This
  // necessarily converges every write-through field (not just the one edited) across all instances —
  // the same "attaching means make me match the master" invariant attachMaster already established
  // (templates.service.ts), now reached automatically instead of only via a manual attach.
  private async propagateThroughMaster(item: CanonicalItem, actorId: string, dto: GroupedEditDto) {
    const representative = item.instances[0]!
    const repRow = await this.prisma.checklistTemplate.findUnique({ where: { id: representative.templateId } })
    if (!repRow) throw new NotFoundException(`template ${representative.templateId} not found`)
    const repDef = repRow.definition as unknown as ChecklistTemplateDefinition

    let patchedDef: ChecklistTemplateDefinition
    try {
      patchedDef = applyGroupedPatch(repDef, representative.nodeCode, dto).definition
    } catch (err) {
      if (err instanceof TemplateEditError || err instanceof ChecklistTemplateValidationError) {
        throw new BadRequestException(`${representative.mode} ${representative.variantKey} ${representative.nodeCode}: ${(err as Error).message}`)
      }
      throw err
    }
    const patchedNode = indexTemplateNodesByCode(patchedDef).get(representative.nodeCode)!
    const fields = snapshotWriteThroughFields(patchedNode)

    const correlationId = randomUUID()
    return this.atomicMasterPush(item.masterId ?? null, fields, item, actorId, correlationId, dto.field)
  }

  // Part B's atomic core: create-or-update the MasterCriterion row, then push it to every instance
  // of `item`, all inside one $transaction — a bad patch (rejected only once pushMasterToInstance's
  // parseTemplateDefinition actually runs against a real instance) rolls back everything, including
  // the master row itself. Same "raw tx client, never AuditLogService" convention
  // master-criteria.service.ts#update already established for the identical reason (AuditLogService
  // has no tx-scoped variant).
  private async atomicMasterPush(
    existingMasterId: string | null,
    fields: WriteThroughFields,
    item: CanonicalItem,
    actorId: string,
    correlationId: string,
    field: string,
  ) {
    let wrote = 0

    let masterId: string
    try {
      masterId = await this.prisma.$transaction(async (tx) => {
        const payloadFields = toMasterPayload('', fields)
        let id: string
        if (existingMasterId) {
          const existing = await tx.masterCriterion.findUnique({ where: { id: existingMasterId } })
          if (!existing) throw new NotFoundException(`master criterion ${existingMasterId} not found`)
          await tx.masterCriterion.update({ where: { id: existingMasterId }, data: masterRowData(payloadFields, actorId) })
          await tx.auditLog.create({
            data: {
              userId: actorId,
              action: TEMPLATE_MASTER_EDIT,
              entityType: 'MasterCriterion',
              entityId: existingMasterId,
              before: { correlationId, canonicalItemId: item.id, field } as unknown as Prisma.InputJsonValue,
              after: { correlationId, canonicalItemId: item.id, field, value: fields } as unknown as Prisma.InputJsonValue,
            },
          })
          id = existingMasterId
        } else {
          const created = await tx.masterCriterion.create({ data: masterRowData(payloadFields, actorId) })
          await tx.auditLog.create({
            data: {
              userId: actorId,
              action: TEMPLATE_MASTER_CREATE,
              entityType: 'MasterCriterion',
              entityId: created.id,
              before: Prisma.JsonNull,
              after: { correlationId, canonicalItemId: item.id, field, promotedFrom: 'facility-grouped-editor', value: fields } as unknown as Prisma.InputJsonValue,
            },
          })
          id = created.id
        }

        const payload: MasterCriterionPayload = { ...payloadFields, id }

        const byTemplate = new Map<string, ItemInstance[]>()
        for (const inst of item.instances) {
          if (!byTemplate.has(inst.templateId)) byTemplate.set(inst.templateId, [])
          byTemplate.get(inst.templateId)!.push(inst)
        }
        for (const [templateId, instances] of byTemplate) {
          const row = await tx.checklistTemplate.findUnique({ where: { id: templateId } })
          if (!row) throw new NotFoundException(`template ${templateId} not found`)
          if (row.status === 'RETIRED') {
            throw new ForbiddenException(`template ${instances[0]!.mode} ${instances[0]!.variantKey} is RETIRED; grouped editing is disabled`)
          }
          let evolvingDef = row.definition as unknown as ChecklistTemplateDefinition
          const rowResults: { nodeCode: string; before: unknown; after: unknown }[] = []
          for (const inst of instances) {
            const result = pushMasterToInstance(evolvingDef, inst.nodeCode, payload, { setMasterId: true, clearDetached: false })
            evolvingDef = result.definition
            rowResults.push({ nodeCode: inst.nodeCode, before: result.before, after: result.after })
          }
          await tx.checklistTemplate.update({ where: { id: templateId }, data: { definition: evolvingDef as unknown as Prisma.InputJsonValue } })
          for (const r of rowResults) {
            await tx.auditLog.create({
              data: {
                userId: actorId,
                action: TEMPLATE_GROUPED_EDIT,
                entityType: 'ChecklistTemplate',
                entityId: templateId,
                before: { correlationId, nodeCode: r.nodeCode, masterId: id, field, canonicalItemId: item.id, value: r.before } as unknown as Prisma.InputJsonValue,
                after: { correlationId, nodeCode: r.nodeCode, masterId: id, field, canonicalItemId: item.id, value: r.after } as unknown as Prisma.InputJsonValue,
              },
            })
            wrote++
          }
        }
        return id
      })
    } catch (err) {
      if (err instanceof TemplateEditError || err instanceof ChecklistTemplateValidationError) {
        throw new BadRequestException(err.message)
      }
      throw err
    }

    return {
      correlationId,
      field,
      masterId,
      promoted: existingMasterId === null,
      wroteCount: wrote,
      targets: item.instances.map(toInstanceDto),
    }
  }

  // Era-editor safety session, Part E — moves a node that ISN'T currently master-attached onto a
  // DIFFERENT existing canonical item's group. Reuses atomicMasterPush unchanged to ensure the
  // TARGET has a masterId (promoting it from its current representative snapshot if this is its
  // first-ever attach, exactly as an ordinary grouped edit would) — then links the source node to
  // that resolved masterId via the same pushMasterToInstance primitive attachMaster already uses
  // (templates.service.ts). Clears `standalone` defensively: a standalone-flagged node is invisible
  // to ALL grouping (eligible() filters it out before either clustering path runs — see
  // facility-grouping.core.ts), so leaving it set after attaching would silently vanish the node
  // from the tree despite the master link existing underneath.
  //
  // Scope decision (documented, not asked): offered only for a source node that is NOT currently
  // master-attached — mirrors the existing UI moment (MasterAttachedBanner's reattach affordance
  // only shows for a detached node) and keeps attachMaster's existing "already attached — detach
  // first" guard unchanged rather than adding an implicit detach-then-attach path.
  async attachNodeToGroup(scope: VersionScope, targetCanonicalItemId: string, sourceTemplateId: string, sourceNodeCode: string, actorId: string) {
    const sourceRow = await this.prisma.checklistTemplate.findUnique({ where: { id: sourceTemplateId } })
    if (!sourceRow) throw new NotFoundException(`template ${sourceTemplateId} not found`)
    if (sourceRow.status === 'RETIRED') throw new ForbiddenException('template is RETIRED; editing is disabled')
    const sourceDefBefore = sourceRow.definition as unknown as ChecklistTemplateDefinition
    if (isNodeAttached(sourceDefBefore, sourceNodeCode)) {
      throw new BadRequestException(`node "${sourceNodeCode}" is already attached to a master — detach first`)
    }

    const { item: target } = await this.findCanonicalItem(scope, targetCanonicalItemId)
    if (target.instances.some((i) => i.templateId === sourceTemplateId && i.nodeCode === sourceNodeCode)) {
      throw new BadRequestException('node is already a member of this group')
    }

    const correlationId = randomUUID()

    // Ensure the target has a masterId, converging its OWN current members — unchanged reuse.
    const representative = target.instances[0]!
    const repRow = await this.prisma.checklistTemplate.findUnique({ where: { id: representative.templateId } })
    if (!repRow) throw new NotFoundException(`template ${representative.templateId} not found`)
    const repDef = repRow.definition as unknown as ChecklistTemplateDefinition
    const repNode = indexTemplateNodesByCode(repDef).get(representative.nodeCode)!
    const fields = snapshotWriteThroughFields(repNode)
    const pushResult = await this.atomicMasterPush(target.masterId ?? null, fields, target, actorId, correlationId, 'attach-move')

    // Re-fetch the source row AFTER the target push commits, rather than reusing the pre-push
    // snapshot above — the real motivating case (an item repeating multiple times within one
    // template, e.g. rail_metro's A1.4-5) often has the source and target SHARE a template row, so
    // atomicMasterPush may have already updated this exact row as one of the target's own
    // instances. Building the source write on a stale snapshot would silently clobber that write
    // the moment this function does its own separate update below.
    const freshSourceRow = await this.prisma.checklistTemplate.findUnique({ where: { id: sourceTemplateId } })
    if (!freshSourceRow) throw new NotFoundException(`template ${sourceTemplateId} not found`)
    let sourceDef = freshSourceRow.definition as unknown as ChecklistTemplateDefinition

    // Clear standalone (if set) + link the source node to the now-guaranteed master.
    sourceDef = core.editStandalone(sourceDef, sourceNodeCode, false).definition
    const master = await this.prisma.masterCriterion.findUnique({ where: { id: pushResult.masterId } })
    if (!master) throw new NotFoundException(`master criterion ${pushResult.masterId} not found`)
    const result = pushMasterToInstance(sourceDef, sourceNodeCode, masterRowToPayload(master), { setMasterId: true, clearDetached: true })

    await this.prisma.checklistTemplate.update({
      where: { id: sourceTemplateId },
      data: { definition: result.definition as unknown as Prisma.InputJsonValue },
    })
    await this.auditLog.log({
      userId: actorId,
      action: TEMPLATE_MASTER_MOVE,
      entityType: 'ChecklistTemplate',
      entityId: sourceTemplateId,
      before: { nodeCode: sourceNodeCode, masterId: null, correlationId, targetCanonicalItemId, value: result.before },
      after: { nodeCode: sourceNodeCode, masterId: pushResult.masterId, correlationId, targetCanonicalItemId, value: result.after },
    })

    return { id: sourceTemplateId, definition: result.definition, masterId: pushResult.masterId }
  }

  // Part 4.1 — collapses the confirmed-flag review queue: confirming a canonical measurement
  // confirms every instance that carries that measurement key in one action. Never reached for a
  // pure container node in practice — getGroupedReviewQueue only ever iterates leaf nodes — but the
  // loop below is naturally a no-op if it were (no instance has that measurement key).
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
  //
  // Session S5-fix (round 2) — the anchor is now ONE id (`anchorNodeId`) into the unified tree
  // instead of two mutually-exclusive fields: since a leaf and a container are the same node type
  // now, "insert before/after this node" resolves identically regardless of depth — the node's own
  // `parentCode` is always the code to splice into (addPositionedChildNode already tries a group
  // lookup before a node lookup, so a depth-0 anchor's parentCode — a GROUP code — and a deeper
  // anchor's parentCode — a NODE code — both just work).
  async addAndPlace(scope: VersionScope, dto: AddAndPlaceDto, actorId: string) {
    const { result } = await this.computeGroups(scope)

    const anchor = flattenTree(result.containerGroups).find((n) => n.id === dto.anchorNodeId)
    if (!anchor) throw new NotFoundException(`unknown anchorNodeId "${dto.anchorNodeId}"`)
    const anchorLabel = anchor.labelTh
    const instanceFor = (templateId: string): { intoCode: string; anchorCode: string } | undefined => {
      const inst = anchor.instances.find((i) => i.templateId === templateId)
      return inst ? { intoCode: inst.parentCode, anchorCode: inst.nodeCode } : undefined
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
    // unless the caller already supplied lawRefs explicitly, which wins. Shared with
    // templates.service.ts#addTopLevelItem via core.resolveFacilityCodeDefaults.
    const facilityDefaults = core.resolveFacilityCodeDefaults(dto.content.facilityCode, dto.content.lawRefs)
    if (!facilityDefaults) throw new BadRequestException(`unknown facilityCode ${dto.content.facilityCode}`)
    const { lawRefs, cabinetResolution, beyondLaw } = facilityDefaults

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

  // Live feedback (2026-08-17) — delete-group: the symmetric counterpart to addAndPlace above,
  // removing a canonical item's instances from N chosen templates in one action instead of opening
  // each template's own individual editor to delete one at a time (real motivating case: an
  // admin-added item that turned out to be a near-duplicate typo of an already-correct one, sitting
  // in 3 templates). Same preview -> confirm two-step, same per-target skip-with-reason convention
  // as addAndPlace. A target is skipped (never guessed past) when: the template row doesn't exist,
  // this canonical item has no instance in it (already gone, or never there), the row isn't a DRAFT
  // (STRUCTURE_EDIT_REQUIRES_DRAFT — deletion is structural, same gate as every other structural
  // edit), or the instance is master-attached (assertNotAttached's own reasoning applies here too:
  // deleting a linked leaf out from under its master without detaching first would leave the
  // master's own instance list silently short one member).
  async deleteGroup(scope: VersionScope, dto: DeleteGroupDto, actorId: string) {
    const { result } = await this.computeGroups(scope)

    const item = flattenTree(result.containerGroups).find((n) => n.id === dto.canonicalItemId)
    if (!item) throw new NotFoundException(`unknown canonicalItemId "${dto.canonicalItemId}"`)

    const rows = await this.prisma.checklistTemplate.findMany({ where: { id: { in: dto.targetTemplateIds } } })
    const rowById = new Map(rows.map((r) => [r.id, r]))

    const resolved: DeleteGroupResolved[] = []
    const skipped: DeleteGroupSkipped[] = []

    for (const templateId of dto.targetTemplateIds) {
      const row = rowById.get(templateId)
      if (!row) {
        skipped.push({ templateId, mode: null, variantKey: null, reason: 'ไม่พบแบบประเมินนี้' })
        continue
      }
      const inst = item.instances.find((i) => i.templateId === templateId)
      if (!inst) {
        skipped.push({ templateId, mode: row.mode, variantKey: row.variantKey, reason: 'ไม่พบรายการนี้ในแบบประเมินนี้ (อาจถูกลบไปแล้ว)' })
        continue
      }
      if (row.status !== 'DRAFT') {
        skipped.push({ templateId, mode: row.mode, variantKey: row.variantKey, reason: 'ไม่ใช่เวอร์ชันร่าง — สร้างเวอร์ชันร่างใหม่ก่อน' })
        continue
      }
      const def = row.definition as unknown as ChecklistTemplateDefinition
      if (isNodeAttached(def, inst.nodeCode)) {
        skipped.push({ templateId, mode: row.mode, variantKey: row.variantKey, reason: 'รายการนี้เชื่อมโยงกับรายการต้นแบบ กรุณาแยกออกก่อนลบ' })
        continue
      }
      resolved.push({ templateId, mode: row.mode as TransportMode, variantKey: row.variantKey, nodeCode: inst.nodeCode, labelTh: inst.labelTh })
    }

    if (!dto.confirm) {
      return { correlationId: null as string | null, wroteCount: 0, resolved, skipped }
    }
    if (resolved.length === 0) {
      throw new BadRequestException('ไม่มีเป้าหมายที่ลบได้ — ทุกแบบประเมินถูกข้าม ดูเหตุผลใน skipped[]')
    }

    const correlationId = randomUUID()
    for (const target of resolved) {
      await this.writeStructuralDelete(target.templateId, target.nodeCode, actorId, correlationId)
    }

    return { correlationId: correlationId as string | null, wroteCount: resolved.length, resolved, skipped }
  }

  // Structural-delete write for ONE target, gated exactly like writeStructuralAdd above
  // (DRAFT-only, same error code the frontend already renders a message for).
  private async writeStructuralDelete(templateId: string, nodeCode: string, actorId: string, correlationId: string): Promise<void> {
    const row = await this.prisma.checklistTemplate.findUnique({ where: { id: templateId } })
    if (!row) throw new NotFoundException(`template ${templateId} not found`)
    if (row.status !== 'DRAFT') {
      throw new ForbiddenException({ code: 'STRUCTURE_EDIT_REQUIRES_DRAFT', message: 'โครงสร้างแก้ไขได้ในเวอร์ชันร่างเท่านั้น' })
    }
    const def = row.definition as unknown as ChecklistTemplateDefinition

    let result: { definition: ChecklistTemplateDefinition; deletedCode: string; subtreeLeafCount: number }
    try {
      result = core.deleteNode(def, nodeCode)
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
      action: TEMPLATE_GROUPED_DELETE,
      entityType: 'ChecklistTemplate',
      entityId: templateId,
      before: { correlationId, nodeCode, subtreeLeafCount: result.subtreeLeafCount },
      after: { correlationId, deleted: true },
    })
  }

  // Only ever iterates LEAF nodes (result.canonicalItems is already flattenLeaves' output — see
  // facility-grouping.core.ts) — a container has no measurements to confirm, so it can never
  // appear here regardless of depth.
  async getGroupedReviewQueue(scope: VersionScope) {
    const { result } = await this.computeGroups(scope)
    const rows: {
      canonicalItemId: string
      containerGroupId: string | null
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
          containerGroupId: item.parentId,
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
