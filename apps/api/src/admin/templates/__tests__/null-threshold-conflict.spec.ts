// Session S5-fix, Part D.2 — a group's instances disagreeing on WHETHER a threshold exists (some
// have a real value, some carry null because it was never extracted from source) must be treated
// as a live conflict, never silently clobbered by a propagate/promote write. This is not new
// machinery: leafDataSignature (facility-grouping.core.ts) already folds `m.value ?? ''` into its
// comparison key, so null and any real number already produce DIFFERENT signatures — this suite is
// the regression guard proving that pre-existing behavior actually covers the null-threshold case,
// end to end through propagateItemEdit's promote-on-edit gate.
import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { buildFacilityGroups, detectConflicts, isPropagatable, type FacilityLoadedTemplate } from '../facility-grouping.core'
import { FacilityGroupsService, type GroupNodeDto } from '../facility-groups.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditLogService } from '../../../audit/audit.service'

// Session S5-fix (round 2) — service.getGroups() returns a recursive tree, not a flat
// canonicalItems list; flatten it the same way the frontend does to find a specific leaf.
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

function templateWith(templateId: string, mode: FacilityLoadedTemplate['mode'], value: number | null): FacilityLoadedTemplate {
  return {
    templateId,
    mode,
    variantKey: 'standard',
    version: 3,
    status: 'DRAFT',
    definition: {
      schemaVersion: 2,
      mode,
      groups: [
        {
          code: 'A1',
          labelTh: 'กลุ่มทดสอบ',
          items: [
            {
              code: 'A1.1',
              labelTh: 'container',
              subItems: [
                {
                  code: 'A1.1-1',
                  labelTh: 'เกณฑ์ที่ยังไม่สกัดค่า',
                  answerType: 'presence_standard',
                  measurements: [{ key: 'm1', operator: 'gte', value, unit: 'mm', autoGrade: true, confirmed: false }],
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

describe('null-threshold divergence — Part D.2', () => {
  it('all instances genuinely null: no conflict, propagatable (promotes cleanly)', () => {
    const result = buildFacilityGroups([templateWith('t0', 'ทางบก', null), templateWith('t1', 'ทางน้ำ', null)])
    const item = result.canonicalItems.find((it) => it.labelTh.includes('เกณฑ์'))!
    expect(detectConflicts(result)).toHaveLength(0)
    expect(isPropagatable(item)).toBe(true)
  })

  it('one null, one real value: a live conflict, NOT propagatable — never silently clobbered', () => {
    const result = buildFacilityGroups([templateWith('t0', 'ทางบก', null), templateWith('t1', 'ทางน้ำ', 300)])
    const item = result.canonicalItems.find((it) => it.labelTh.includes('เกณฑ์'))!
    const conflicts = detectConflicts(result)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.canonicalItemId).toBe(item.id)
    expect(isPropagatable(item)).toBe(false)
  })

  describe('end to end through propagateItemEdit', () => {
    const LAND_ROW = { id: 'land-1', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'DRAFT', definition: templateWith('land-1', 'ทางบก', null).definition }
    const WATER_ROW_MIXED = { id: 'water-1', mode: 'ทางน้ำ', variantKey: 'standard', version: 3, status: 'DRAFT', definition: templateWith('water-1', 'ทางน้ำ', 300).definition }
    const WATER_ROW_ALL_NULL = { id: 'water-1', mode: 'ทางน้ำ', variantKey: 'standard', version: 3, status: 'DRAFT', definition: templateWith('water-1', 'ทางน้ำ', null).definition }

    let service: FacilityGroupsService
    const findMany = jest.fn()
    const findUnique = jest.fn()
    const txMasterCreate = jest.fn()
    const txAuditCreate = jest.fn()
    const txTemplateFindUnique = jest.fn()
    const txTemplateUpdate = jest.fn()
    const transactionMock = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        masterCriterion: { create: txMasterCreate },
        auditLog: { create: txAuditCreate },
        checklistTemplate: { findUnique: txTemplateFindUnique, update: txTemplateUpdate },
      }),
    )

    beforeEach(async () => {
      jest.clearAllMocks()
      txMasterCreate.mockResolvedValue({ id: 'new-master-1' })
      txTemplateUpdate.mockResolvedValue({})
      txAuditCreate.mockResolvedValue({})
      const moduleRef = await Test.createTestingModule({
        providers: [
          FacilityGroupsService,
          { provide: PrismaService, useValue: { checklistTemplate: { findMany, findUnique }, $transaction: transactionMock } },
          { provide: AuditLogService, useValue: { log: jest.fn() } },
        ],
      }).compile()
      service = moduleRef.get(FacilityGroupsService)
    })

    it('a mixed null-vs-value group is blocked — propagateItemEdit refuses, never promotes/clobbers', async () => {
      findMany.mockResolvedValue([LAND_ROW, WATER_ROW_MIXED])
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const item = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('เกณฑ์'))!
      expect(item.propagatable).toBe(false)

      await expect(
        service.propagateItemEdit({ kind: 'exact', version: 3 }, item.id, 'admin1', {
          field: 'measurement',
          measurementKey: 'm1',
          measurement: { operator: 'gte', value: 300, unit: 'mm', autoGrade: true },
        }),
      ).rejects.toThrow(BadRequestException)
      expect(transactionMock).not.toHaveBeenCalled()
      expect(txMasterCreate).not.toHaveBeenCalled()
    })

    it('an all-null group promotes cleanly — a real edit through the master succeeds normally', async () => {
      findMany.mockResolvedValue([LAND_ROW, WATER_ROW_ALL_NULL])
      findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(id === LAND_ROW.id ? LAND_ROW : id === WATER_ROW_ALL_NULL.id ? WATER_ROW_ALL_NULL : null),
      )
      txTemplateFindUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(id === LAND_ROW.id ? LAND_ROW : id === WATER_ROW_ALL_NULL.id ? WATER_ROW_ALL_NULL : null),
      )
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const item = flattenLeaves(groups.containerGroups).find((it) => it.labelTh.includes('เกณฑ์'))!
      expect(item.propagatable).toBe(true)

      const result = await service.propagateItemEdit({ kind: 'exact', version: 3 }, item.id, 'admin1', {
        field: 'measurement',
        measurementKey: 'm1',
        measurement: { operator: 'gte', value: 300, unit: 'mm', autoGrade: true },
      })
      expect(result.promoted).toBe(true)
      expect(result.wroteCount).toBe(2)
    })
  })
})
