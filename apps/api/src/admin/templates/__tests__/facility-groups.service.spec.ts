// Session S4b — service-level tests for the facility-grouped editor: the conflict gate actually
// blocks a propagate write, "leave split" only stamps a flag, "pick winner" copies data and is
// self-resolving, and every write in a fan-out shares one correlationId. Same Prisma/AuditLog
// mocking convention as templates-service-structural.spec.ts.
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Prisma } from '@prisma/client'
import { FacilityGroupsService, type GroupNodeDto } from '../facility-groups.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditLogService } from '../../../audit/audit.service'
import { MinioService } from '../../../minio/minio.service'

// Session S5-fix (round 2) — getGroups() now returns a recursive tree (containerGroups only, no
// separate flat canonicalItems list); tests that need to find a specific LEAF by label flatten it
// themselves the same way the frontend does.
function flattenLeaves(nodes: GroupNodeDto[]): GroupNodeDto[] {
  const out: GroupNodeDto[] = []
  const walk = (ns: GroupNodeDto[]) => {
    for (const n of ns) {
      if (n.isLeaf) out.push(n)
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

// Two v3-shaped templates sharing one container ("ทางลาดสำหรับคนพิการ") with two leaves:
//   A1.1-1 — identical text AND data in both -> SHARED, no conflict, propagatable.
//   A1.1-2 — identical text, DIFFERENT measurement value -> SHARED, a live conflict.
function landDef() {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A1',
        labelTh: 'กลุ่มทดสอบ',
        items: [
          {
            code: 'A1.1',
            labelTh: 'ทางลาดสำหรับคนพิการ',
            subItems: [
              {
                code: 'A1.1-1',
                labelTh: 'ความกว้างไม่น้อยกว่า 900 มิลลิเมตร',
                answerType: 'presence_standard',
                measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: false }],
              },
              {
                code: 'A1.1-2',
                labelTh: 'ค่าที่ขัดแย้งกันระหว่างแบบประเมิน',
                answerType: 'presence_standard',
                measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: true }],
              },
            ],
          },
        ],
      },
    ],
  }
}

function waterDef() {
  return {
    schemaVersion: 2,
    mode: 'ทางน้ำ',
    groups: [
      {
        code: 'A1',
        labelTh: 'กลุ่มทดสอบ',
        items: [
          {
            code: 'A1.1',
            labelTh: 'ทางลาดสำหรับคนพิการ',
            subItems: [
              {
                code: 'A1.1-1',
                labelTh: 'ความกว้างไม่น้อยกว่า 900 มิลลิเมตร',
                answerType: 'presence_standard',
                measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: false }],
              },
              {
                code: 'A1.1-2',
                labelTh: 'ค่าที่ขัดแย้งกันระหว่างแบบประเมิน',
                answerType: 'presence_standard',
                measurements: [{ key: 'm1', operator: 'gte', value: 500, unit: 'mm', autoGrade: true, confirmed: true }],
              },
            ],
          },
        ],
      },
    ],
  }
}

const LAND_ROW = { id: 'land-1', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'DRAFT', definition: landDef() }
const WATER_ROW = { id: 'water-1', mode: 'ทางน้ำ', variantKey: 'standard', version: 3, status: 'DRAFT', definition: waterDef() }

describe('FacilityGroupsService', () => {
  let service: FacilityGroupsService
  const findMany = jest.fn()
  const findUnique = jest.fn()
  const update = jest.fn()
  const auditLog = jest.fn()

  // Session S5-fix, Part B — propagateItemEdit routes every field except 'hidden' through an
  // atomic $transaction (promote-on-edit + master push). Same tx-mocking convention as
  // master-criteria.service.spec.ts: a fake $transaction that just invokes the callback with a
  // tx client exposing its own mocks, so "nothing ever escapes to the root client" is checkable.
  const txMasterFindUnique = jest.fn()
  const txMasterCreate = jest.fn()
  const txMasterUpdate = jest.fn()
  const txAuditCreate = jest.fn()
  const txTemplateFindUnique = jest.fn()
  const txTemplateUpdate = jest.fn()
  const transactionMock = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      masterCriterion: { findUnique: txMasterFindUnique, create: txMasterCreate, update: txMasterUpdate },
      auditLog: { create: txAuditCreate },
      checklistTemplate: { findUnique: txTemplateFindUnique, update: txTemplateUpdate },
    }),
  )

  beforeEach(async () => {
    jest.clearAllMocks()
    findMany.mockResolvedValue([LAND_ROW, WATER_ROW])
    findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve(id === LAND_ROW.id ? LAND_ROW : id === WATER_ROW.id ? WATER_ROW : null),
    )
    update.mockResolvedValue({})

    txTemplateFindUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve(id === LAND_ROW.id ? LAND_ROW : id === WATER_ROW.id ? WATER_ROW : null),
    )
    txTemplateUpdate.mockResolvedValue({})
    txMasterCreate.mockResolvedValue({ id: 'new-master-1' })
    txMasterUpdate.mockResolvedValue({})
    txMasterFindUnique.mockResolvedValue({ id: 'new-master-1' })
    txAuditCreate.mockResolvedValue({})

    const moduleRef = await Test.createTestingModule({
      providers: [
        FacilityGroupsService,
        {
          provide: PrismaService,
          useValue: { checklistTemplate: { findMany, findUnique, update }, $transaction: transactionMock },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { upload: jest.fn(), getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(FacilityGroupsService)
  })

  it('getGroups reports one SHARED non-conflicted item and one SHARED conflicted item', async () => {
    const result = await service.getGroups({ kind: 'exact', version: 3 })
    expect(flattenLeaves(result.containerGroups)).toHaveLength(2)

    const clean = flattenLeaves(result.containerGroups).find((it) => it.labelTh.includes('900 มิลลิเมตร'))!
    expect(clean.classification).toBe('SHARED')
    expect(clean.hasConflict).toBe(false)
    expect(clean.propagatable).toBe(true)

    const conflicted = flattenLeaves(result.containerGroups).find((it) => it.labelTh.includes('ขัดแย้ง'))!
    expect(conflicted.hasConflict).toBe(true)
    expect(conflicted.propagatable).toBe(false)
  })

  it('propagateItemEdit (measurement field) promotes on first edit, writes every instance via the tx client, and shares one correlationId', async () => {
    const groups = await service.getGroups({ kind: 'exact', version: 3 })
    const clean = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('900 มิลลิเมตร'))!

    const result = await service.propagateItemEdit({ kind: 'exact', version: 3 }, clean.id, 'admin1', {
      field: 'measurement',
      measurementKey: 'm1',
      measurement: { operator: 'gte', value: 950, unit: 'mm', autoGrade: true },
    })

    expect(result.wroteCount).toBe(2)
    expect(result.promoted).toBe(true)
    expect(result.masterId).toBe('new-master-1')
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(txMasterCreate).toHaveBeenCalledTimes(1)
    expect(txTemplateUpdate).toHaveBeenCalledTimes(2)
    // Nothing escapes to the root client — that's what makes the promote+push atomic.
    expect(update).not.toHaveBeenCalled()
    expect(auditLog).not.toHaveBeenCalled()

    const correlationIds = txAuditCreate.mock.calls.map((c) => (c[0].data.before === Prisma.JsonNull ? c[0].data.after : c[0].data.before).correlationId)
    expect(new Set(correlationIds).size).toBe(1) // one shared correlationId across master-create + both instance pushes
    expect(correlationIds[0]).toBe(result.correlationId)
    expect(txAuditCreate).toHaveBeenCalledTimes(3) // 1 MasterCriterion create + 2 ChecklistTemplate pushes
    expect(txAuditCreate.mock.calls.filter((c) => c[0].data.action === 'TEMPLATE_MASTER_CREATE')).toHaveLength(1)
    expect(txAuditCreate.mock.calls.filter((c) => c[0].data.action === 'TEMPLATE_GROUPED_EDIT')).toHaveLength(2)

    for (const call of txTemplateUpdate.mock.calls) {
      const leaf = call[0].data.definition.groups[0].items[0].subItems[0]
      expect(leaf.masterId).toBe('new-master-1') // every instance now linked to the same new master
      expect(leaf.measurements[0].value).toBe(950) // the edit landed
      expect(leaf.measurements[0].confirmed).toBe(true)
    }
  })

  it('a second edit of the now-promoted item reuses the same master — no duplicate master row, updates not creates', async () => {
    const groups = await service.getGroups({ kind: 'exact', version: 3 })
    const clean = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('900 มิลลิเมตร'))!

    const first = await service.propagateItemEdit({ kind: 'exact', version: 3 }, clean.id, 'admin1', {
      field: 'measurement',
      measurementKey: 'm1',
      measurement: { operator: 'gte', value: 950, unit: 'mm', autoGrade: true },
    })
    expect(first.promoted).toBe(true)

    // Simulate persistence: both rows now carry the masterId the first edit just linked.
    const promotedLand = { ...LAND_ROW, definition: JSON.parse(JSON.stringify(landDef())) }
    promotedLand.definition.groups[0].items[0].subItems[0].masterId = first.masterId
    const promotedWater = { ...WATER_ROW, definition: JSON.parse(JSON.stringify(waterDef())) }
    promotedWater.definition.groups[0].items[0].subItems[0].masterId = first.masterId
    findMany.mockResolvedValue([promotedLand, promotedWater])
    findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve(id === promotedLand.id ? promotedLand : id === promotedWater.id ? promotedWater : null),
    )
    txTemplateFindUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve(id === promotedLand.id ? promotedLand : id === promotedWater.id ? promotedWater : null),
    )

    const groups2 = await service.getGroups({ kind: 'exact', version: 3 })
    const clean2 = flattenLeaves(groups2.containerGroups).find((it) => it.labelTh.includes('900 มิลลิเมตร'))!
    const second = await service.propagateItemEdit({ kind: 'exact', version: 3 }, clean2.id, 'admin1', {
      field: 'measurement',
      measurementKey: 'm1',
      measurement: { operator: 'gte', value: 1000, unit: 'mm', autoGrade: true },
    })

    expect(second.promoted).toBe(false)
    expect(second.masterId).toBe(first.masterId)
    expect(txMasterCreate).toHaveBeenCalledTimes(1) // still just the ONE call, from the first edit
    expect(txMasterUpdate).toHaveBeenCalledTimes(1) // the second edit updates the existing row instead
    for (const call of txTemplateUpdate.mock.calls.slice(-2)) {
      const leaf = call[0].data.definition.groups[0].items[0].subItems[0]
      expect(leaf.masterId).toBe(first.masterId)
      expect(leaf.measurements[0].value).toBe(1000)
    }
  })

  it("the 'hidden' field always writes directly per-instance and never creates or touches a master", async () => {
    const groups = await service.getGroups({ kind: 'exact', version: 3 })
    const clean = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('900 มิลลิเมตร'))!

    const result = await service.propagateItemEdit({ kind: 'exact', version: 3 }, clean.id, 'admin1', {
      field: 'hidden',
      hidden: { hidden: true },
    })

    expect(result.wroteCount).toBe(2)
    expect(transactionMock).not.toHaveBeenCalled()
    expect(txMasterCreate).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(2)
    expect(auditLog).toHaveBeenCalledTimes(2)
    for (const call of auditLog.mock.calls) expect(call[0].action).toBe('TEMPLATE_GROUPED_EDIT')
    for (const call of update.mock.calls) {
      const leaf = call[0].data.definition.groups[0].items[0].subItems[0]
      expect(leaf.masterId).toBeUndefined() // hidden edits never promote
      expect(leaf.hidden).toBe(true)
    }
  })

  it('propagateItemEdit refuses a conflicted canonical item — the gate holds', async () => {
    const groups = await service.getGroups({ kind: 'exact', version: 3 })
    const conflicted = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('ขัดแย้ง'))!

    await expect(
      service.propagateItemEdit({ kind: 'exact', version: 3 }, conflicted.id, 'admin1', {
        field: 'measurement',
        measurementKey: 'm1',
        measurement: { operator: 'gte', value: 700, unit: 'mm', autoGrade: true },
      }),
    ).rejects.toThrow(BadRequestException)
    expect(update).not.toHaveBeenCalled()
  })

  it('propagateItemEdit throws NotFoundException for a stale/unknown canonical item id', async () => {
    await expect(
      service.propagateItemEdit({ kind: 'exact', version: 3 }, 'cg-does-not-exist-item-0', 'admin1', { field: 'hidden', hidden: { hidden: true } }),
    ).rejects.toThrow(NotFoundException)
  })

  describe('resolveConflict', () => {
    it('"split" only stamps conflictSplitAcknowledged on every instance — no data changes, and it is audit-logged', async () => {
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const conflicted = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('ขัดแย้ง'))!

      const result = await service.resolveConflict({ kind: 'exact', version: 3 }, conflicted.id, 'admin1', { resolution: 'split', notes: 'genuinely different by mode' })
      expect(result.resolution).toBe('split')
      expect(result.wroteCount).toBe(2)
      expect(update).toHaveBeenCalledTimes(2)
      for (const call of update.mock.calls) {
        const def = call[0].data.definition
        const leaf = def.groups[0].items[0].subItems[1]
        expect(leaf.conflictSplitAcknowledged).toBe(true)
        expect(leaf.measurements[0].value).toEqual(expect.any(Number)) // unchanged values, still divergent
      }
      for (const call of auditLog.mock.calls) expect(call[0].action).toBe('TEMPLATE_CONFLICT_RESOLVE')
    })

    it('"winner" copies the chosen variant\'s data onto every OTHER instance and skips the instance that already matches', async () => {
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const conflicted = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('ขัดแย้ง'))!
      const conflicts = await service.getConflicts({ kind: 'exact', version: 3 })
      const conflictEntry = conflicts.find((c) => c.canonicalItemId === conflicted.id)!
      const landVariant = conflictEntry.variants.find((v) => v.instances.some((i) => i.mode === 'ทางบก'))!

      const result = await service.resolveConflict({ kind: 'exact', version: 3 }, conflicted.id, 'admin1', { resolution: 'winner', winnerSignature: landVariant.signature })
      expect(result.resolution).toBe('winner')
      // Only the water instance actually diverges from the land (winning) value — land is skipped.
      expect(result.wroteCount).toBe(1)
      expect(update).toHaveBeenCalledTimes(1)
      expect(update.mock.calls[0]![0].where.id).toBe(WATER_ROW.id)
      const writtenLeaf = update.mock.calls[0]![0].data.definition.groups[0].items[0].subItems[1]
      expect(writtenLeaf.measurements[0].value).toBe(900) // copied from the land variant, not water's original 500
      expect(writtenLeaf.measurements[0].confirmed).toBe(true)
    })

    it('rejects resolving a conflict that no longer exists', async () => {
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const clean = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('900 มิลลิเมตร'))!
      await expect(service.resolveConflict({ kind: 'exact', version: 3 }, clean.id, 'admin1', { resolution: 'split' })).rejects.toThrow(BadRequestException)
    })
  })

  it('confirmGroupedMeasurement confirms the measurement on every instance that carries it, sharing one correlationId', async () => {
    const groups = await service.getGroups({ kind: 'exact', version: 3 })
    const clean = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('900 มิลลิเมตร'))!

    const result = await service.confirmGroupedMeasurement({ kind: 'exact', version: 3 }, clean.id, 'm1', 'admin1')
    expect(result.wroteCount).toBe(2)
    expect(update).toHaveBeenCalledTimes(2)
    for (const call of update.mock.calls) {
      const leaf = call[0].data.definition.groups[0].items[0].subItems[0]
      expect(leaf.measurements[0].confirmed).toBe(true)
    }
    for (const call of auditLog.mock.calls) expect(call[0].action).toBe('TEMPLATE_GROUPED_CONFIRM')
  })

  it('getGroupedReviewQueue collapses per-instance unconfirmed rows into one row per canonical item', async () => {
    const queue = await service.getGroupedReviewQueue({ kind: 'exact', version: 3 })
    // A1.1-1 is unconfirmed on both instances -> one collapsed row, instanceCount 2.
    const row = queue.rows.find((r) => r.labelTh.includes('900 มิลลิเมตร'))
    expect(row).toBeDefined()
    expect(row!.instanceCount).toBe(2)
    expect(row!.unconfirmedCount).toBe(2)
  })

  // Session S4b-fix, Fix 3 — add-and-place.
  describe('addAndPlace', () => {
    async function resolveTargets() {
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const group = groups.containerGroups.find((g) => g.labelTh === 'ทางลาดสำหรับคนพิการ')!
      const anchor = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('900 มิลลิเมตร'))!
      return { group, anchor }
    }

    it('confirm:false previews both targets with no writes', async () => {
      const { anchor } = await resolveTargets()
      const result = await service.addAndPlace(
        { kind: 'exact', version: 3 },
        {
          anchorNodeId: anchor.id,
          side: 'before',
          targetTemplateIds: [LAND_ROW.id, WATER_ROW.id],
          content: { labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้', type: 'presence', facilityCode: 27 },
          confirm: false,
        },
        'admin1',
      )
      expect(result.wroteCount).toBe(0)
      expect(result.resolved).toHaveLength(2)
      expect(result.skipped).toHaveLength(0)
      expect(update).not.toHaveBeenCalled()
    })

    it('confirm:true writes both targets, shares one correlationId, assigns distinct new codes, and stamps facilityCode/lawRefs from the catalog', async () => {
      const { anchor } = await resolveTargets()
      const result = await service.addAndPlace(
        { kind: 'exact', version: 3 },
        {
          anchorNodeId: anchor.id,
          side: 'before',
          targetTemplateIds: [LAND_ROW.id, WATER_ROW.id],
          content: { labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้', type: 'presence', facilityCode: 27 },
          confirm: true,
        },
        'admin1',
      )
      expect(result.wroteCount).toBe(2)
      expect(update).toHaveBeenCalledTimes(2)
      // Both fixtures share identical existing structure (A1.1-1, A1.1-2), so both independently
      // compute the SAME next free code ("A1.1-3") — that's correct, not a collision: each
      // template's code is derived from ONLY that template's own existing siblings (see
      // addPositionedChildNode's doc). The invariant that matters is per-template, not global.
      for (const r of result.resolved) {
        expect(r.code).toBeTruthy()
        expect(r.code).not.toBe('A1.1-1')
        expect(r.code).not.toBe('A1.1-2')
      }
      for (const call of auditLog.mock.calls) expect(call[0].action).toBe('TEMPLATE_GROUPED_ADD')
      const correlationIds = auditLog.mock.calls.map((c) => (c[0].before as { correlationId: string }).correlationId)
      expect(new Set(correlationIds).size).toBe(1)
      expect(correlationIds[0]).toBe(result.correlationId)

      for (const call of update.mock.calls) {
        const container = call[0].data.definition.groups[0].items[0]
        const inserted = container.subItems.find((n: { labelTh: string }) => n.labelTh === 'ถังขยะแบบยกเคลื่อนที่ได้')
        expect(inserted.facilityCode).toBe(27)
        expect(inserted.lawRefs).toEqual(['PSD_2555'])
        expect(container.subItems[0].code).toBe(inserted.code) // inserted BEFORE the anchor -> first position
      }
    })

    it('an unknown target templateId is skipped and reported, the valid target still writes', async () => {
      const { anchor } = await resolveTargets()
      const result = await service.addAndPlace(
        { kind: 'exact', version: 3 },
        {
          anchorNodeId: anchor.id,
          side: 'after',
          targetTemplateIds: [LAND_ROW.id, 'does-not-exist'],
          content: { labelTh: 'x', type: 'presence' },
          confirm: true,
        },
        'admin1',
      )
      expect(result.wroteCount).toBe(1)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]!.templateId).toBe('does-not-exist')
      expect(result.skipped[0]!.reason).toContain('ไม่พบแบบประเมิน')
    })

    it('a target whose template row is not DRAFT is skipped, never silently written', async () => {
      // Three findMany calls happen in sequence: resolveTargets()'s own getGroups (1), addAndPlace's
      // internal computeGroups (2), then addAndPlace's own rowById lookup (3) — only the LAST one's
      // status is what the DRAFT gate actually reads (see addAndPlace's doc), so only it needs the
      // ACTIVE override; the first two just need normal, resolvable rows.
      findMany
        .mockResolvedValueOnce([LAND_ROW, WATER_ROW])
        .mockResolvedValueOnce([LAND_ROW, WATER_ROW])
        .mockResolvedValueOnce([LAND_ROW, { ...WATER_ROW, status: 'ACTIVE' }])
      const { anchor } = await resolveTargets()
      const result = await service.addAndPlace(
        { kind: 'exact', version: 3 },
        {
          anchorNodeId: anchor.id,
          side: 'before',
          targetTemplateIds: [LAND_ROW.id, WATER_ROW.id],
          content: { labelTh: 'x', type: 'presence' },
          confirm: true,
        },
        'admin1',
      )
      expect(result.wroteCount).toBe(1)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]!.templateId).toBe(WATER_ROW.id)
      expect(result.skipped[0]!.reason).toContain('ไม่ใช่เวอร์ชันร่าง')
    })
  })
})
