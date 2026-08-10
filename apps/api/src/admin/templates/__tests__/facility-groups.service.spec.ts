// Session S4b — service-level tests for the facility-grouped editor: the conflict gate actually
// blocks a propagate write, "leave split" only stamps a flag, "pick winner" copies data and is
// self-resolving, and every write in a fan-out shares one correlationId. Same Prisma/AuditLog
// mocking convention as templates-service-structural.spec.ts.
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { FacilityGroupsService } from '../facility-groups.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditLogService } from '../../../audit/audit.service'

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

  beforeEach(async () => {
    jest.clearAllMocks()
    findMany.mockResolvedValue([LAND_ROW, WATER_ROW])
    findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve(id === LAND_ROW.id ? LAND_ROW : id === WATER_ROW.id ? WATER_ROW : null),
    )
    update.mockResolvedValue({})

    const moduleRef = await Test.createTestingModule({
      providers: [
        FacilityGroupsService,
        { provide: PrismaService, useValue: { checklistTemplate: { findMany, findUnique, update } } },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()
    service = moduleRef.get(FacilityGroupsService)
  })

  it('getGroups reports one SHARED non-conflicted item and one SHARED conflicted item', async () => {
    const result = await service.getGroups({ kind: 'exact', version: 3 })
    expect(result.canonicalItems).toHaveLength(2)

    const clean = result.canonicalItems.find((it) => it.labelTh.includes('900 มิลลิเมตร'))!
    expect(clean.classification).toBe('SHARED')
    expect(clean.hasConflict).toBe(false)
    expect(clean.propagatable).toBe(true)

    const conflicted = result.canonicalItems.find((it) => it.labelTh.includes('ขัดแย้ง'))!
    expect(conflicted.hasConflict).toBe(true)
    expect(conflicted.propagatable).toBe(false)
  })

  it('propagateItemEdit writes to every instance and shares one correlationId across audit rows', async () => {
    const groups = await service.getGroups({ kind: 'exact', version: 3 })
    const clean = groups.canonicalItems.find((it) => it.labelTh.includes('900 มิลลิเมตร'))!

    const result = await service.propagateItemEdit({ kind: 'exact', version: 3 }, clean.id, 'admin1', {
      field: 'measurement',
      measurementKey: 'm1',
      measurement: { operator: 'gte', value: 950, unit: 'mm', autoGrade: true },
    })

    expect(result.wroteCount).toBe(2)
    expect(update).toHaveBeenCalledTimes(2)
    expect(auditLog).toHaveBeenCalledTimes(2)
    const correlationIds = auditLog.mock.calls.map((c) => (c[0].before as { correlationId: string }).correlationId)
    expect(new Set(correlationIds).size).toBe(1) // one shared correlationId across the fan-out
    expect(correlationIds[0]).toBe(result.correlationId)
    for (const call of auditLog.mock.calls) {
      expect(call[0].action).toBe('TEMPLATE_GROUPED_EDIT')
    }
  })

  it('propagateItemEdit refuses a conflicted canonical item — the gate holds', async () => {
    const groups = await service.getGroups({ kind: 'exact', version: 3 })
    const conflicted = groups.canonicalItems.find((it) => it.labelTh.includes('ขัดแย้ง'))!

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
      const conflicted = groups.canonicalItems.find((it) => it.labelTh.includes('ขัดแย้ง'))!

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
      const conflicted = groups.canonicalItems.find((it) => it.labelTh.includes('ขัดแย้ง'))!
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
      const clean = groups.canonicalItems.find((it) => it.labelTh.includes('900 มิลลิเมตร'))!
      await expect(service.resolveConflict({ kind: 'exact', version: 3 }, clean.id, 'admin1', { resolution: 'split' })).rejects.toThrow(BadRequestException)
    })
  })

  it('confirmGroupedMeasurement confirms the measurement on every instance that carries it, sharing one correlationId', async () => {
    const groups = await service.getGroups({ kind: 'exact', version: 3 })
    const clean = groups.canonicalItems.find((it) => it.labelTh.includes('900 มิลลิเมตร'))!

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
})
