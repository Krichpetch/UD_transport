// Session S5-fix (round 4) — a real gap found via live user feedback: leafDataSignature
// (isPropagatable's own gate) only compares answerType+measurements, never lawRefs/facilityCode/
// cabinetResolution/beyondLaw. Before this fix, editing ANYTHING on a canonical item whose
// instances disagreed on lawRefs (e.g. one correctly law-tagged, one not — a state the fuzzy
// conflict engine never flagged) would wholesale-push whichever instance happened to sort first as
// "representative" over every other instance, silently discarding real era-override/law-
// applicability data the admin never touched. extendedFieldsAgree (facility-grouping.core.ts) is
// the second gate that now blocks this. Also covers the related fix: lawRefs is a LEAF-ONLY field
// (facility-tagging.ts's own documented invariant — a container's own lawRefs is never seed-tagged
// and has zero effect on era-resolution.ts#isItemApplicable) — the grouped editor no longer offers
// it on a container at all.
import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { FacilityGroupsService } from '../facility-groups.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditLogService } from '../../../audit/audit.service'
import { MinioService } from '../../../minio/minio.service'

function leafDef(templateId: string, mode: 'ทางบก' | 'ทางน้ำ', lawRefs: string[] | undefined) {
  return {
    schemaVersion: 2 as const,
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
                labelTh: 'รายการทดสอบ lawRefs',
                answerType: 'presence_standard',
                lawRefs,
                measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: false }],
              },
            ],
          },
        ],
      },
    ],
  }
}

function containerDef(templateId: string, mode: 'ทางบก' | 'ทางน้ำ') {
  return {
    schemaVersion: 2 as const,
    mode,
    groups: [
      {
        code: 'A1',
        labelTh: 'กลุ่มทดสอบ',
        items: [
          {
            code: 'A1.1',
            labelTh: 'container ทดสอบ',
            subItems: [{ code: 'A1.1-1', labelTh: 'leaf ใต้ container', answerType: 'presence' as const }],
          },
        ],
      },
    ],
  }
}

describe('extendedFieldsAgree — round 4 gate', () => {
  let service: FacilityGroupsService
  const findMany = jest.fn()
  const findUnique = jest.fn()
  const update = jest.fn()
  const auditLog = jest.fn()
  const transactionMock = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    update.mockResolvedValue({})
    transactionMock.mockImplementation(async () => {
      throw new Error('transaction should never be reached when extendedFieldsAgree fails')
    })
    const moduleRef = await Test.createTestingModule({
      providers: [
        FacilityGroupsService,
        { provide: PrismaService, useValue: { checklistTemplate: { findMany, findUnique, update }, $transaction: transactionMock } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { upload: jest.fn(), getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(FacilityGroupsService)
  })

  describe('leaf-level lawRefs divergence', () => {
    const LAND_ROW = { id: 'land-1', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'DRAFT', definition: leafDef('land-1', 'ทางบก', ['PSD_2555', 'MOT_2556']) }
    const WATER_ROW_DIVERGED = { id: 'water-1', mode: 'ทางน้ำ', variantKey: 'standard', version: 3, status: 'DRAFT', definition: leafDef('water-1', 'ทางน้ำ', undefined) }
    const WATER_ROW_MATCHED = { id: 'water-1', mode: 'ทางน้ำ', variantKey: 'standard', version: 3, status: 'DRAFT', definition: leafDef('water-1', 'ทางน้ำ', ['PSD_2555', 'MOT_2556']) }

    it('diverged lawRefs: isPropagatable is still true (measurements match) but the SAME-data label edit is refused, never reaching the transaction', async () => {
      findMany.mockResolvedValue([LAND_ROW, WATER_ROW_DIVERGED])
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const roots = groups.containerGroups
      const item = roots[0]!.children.find((c) => c.isLeaf)!
      expect(item.propagatable).toBe(true) // isPropagatable alone doesn't see the lawRefs gap

      await expect(
        service.propagateItemEdit({ kind: 'exact', version: 3 }, item.id, 'admin1', {
          field: 'label',
          label: { labelTh: 'ชื่อใหม่' },
        }),
      ).rejects.toThrow(BadRequestException)
      expect(transactionMock).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    })

    it('diverged lawRefs: a measurement edit is ALSO refused (not just label/lawRefs edits)', async () => {
      findMany.mockResolvedValue([LAND_ROW, WATER_ROW_DIVERGED])
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const item = groups.containerGroups[0]!.children.find((c) => c.isLeaf)!

      await expect(
        service.propagateItemEdit({ kind: 'exact', version: 3 }, item.id, 'admin1', {
          field: 'measurement',
          measurementKey: 'm1',
          measurement: { operator: 'gte', value: 950, unit: 'mm', autoGrade: true },
        }),
      ).rejects.toThrow(BadRequestException)
      expect(transactionMock).not.toHaveBeenCalled()
    })

    it('matched lawRefs: the same edit succeeds normally once instances agree', async () => {
      findMany.mockResolvedValue([LAND_ROW, WATER_ROW_MATCHED])
      findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(id === LAND_ROW.id ? LAND_ROW : id === WATER_ROW_MATCHED.id ? WATER_ROW_MATCHED : null),
      )
      const txMasterCreate = jest.fn().mockResolvedValue({ id: 'new-master-1' })
      const txAuditCreate = jest.fn().mockResolvedValue({})
      const txTemplateFindUnique = jest.fn().mockImplementation(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(id === LAND_ROW.id ? LAND_ROW : id === WATER_ROW_MATCHED.id ? WATER_ROW_MATCHED : null),
      )
      const txTemplateUpdate = jest.fn().mockResolvedValue({})
      transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          masterCriterion: { create: txMasterCreate },
          auditLog: { create: txAuditCreate },
          checklistTemplate: { findUnique: txTemplateFindUnique, update: txTemplateUpdate },
        }),
      )

      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const item = groups.containerGroups[0]!.children.find((c) => c.isLeaf)!
      const result = await service.propagateItemEdit({ kind: 'exact', version: 3 }, item.id, 'admin1', {
        field: 'label',
        label: { labelTh: 'ชื่อใหม่' },
      })
      expect(result.wroteCount).toBe(2)
      expect(transactionMock).toHaveBeenCalledTimes(1)
    })

    it("'hidden' is unaffected by lawRefs divergence — it never touches the master", async () => {
      findMany.mockResolvedValue([LAND_ROW, WATER_ROW_DIVERGED])
      findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(id === LAND_ROW.id ? LAND_ROW : id === WATER_ROW_DIVERGED.id ? WATER_ROW_DIVERGED : null),
      )
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const item = groups.containerGroups[0]!.children.find((c) => c.isLeaf)!
      const result = await service.propagateItemEdit({ kind: 'exact', version: 3 }, item.id, 'admin1', {
        field: 'hidden',
        hidden: { hidden: true },
      })
      expect(result.wroteCount).toBe(2)
      expect(transactionMock).not.toHaveBeenCalled()
    })
  })

  describe('lawRefs is leaf-only — rejected outright on a container node', () => {
    const LAND_ROW = { id: 'land-1', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'DRAFT', definition: containerDef('land-1', 'ทางบก') }
    const WATER_ROW = { id: 'water-1', mode: 'ทางน้ำ', variantKey: 'standard', version: 3, status: 'DRAFT', definition: containerDef('water-1', 'ทางน้ำ') }

    it('propagateItemEdit refuses field="lawRefs" on the container root, before reaching any gate', async () => {
      findMany.mockResolvedValue([LAND_ROW, WATER_ROW])
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const container = groups.containerGroups[0]!
      expect(container.isLeaf).toBe(false)

      await expect(
        service.propagateItemEdit({ kind: 'exact', version: 3 }, container.id, 'admin1', {
          field: 'lawRefs',
          lawRefs: { lawRefs: ['PSD_2555'], beyondLaw: false },
        }),
      ).rejects.toThrow(BadRequestException)
      expect(transactionMock).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    })

    it('label/images/hidden still work on the same container', async () => {
      findMany.mockResolvedValue([LAND_ROW, WATER_ROW])
      findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(id === LAND_ROW.id ? LAND_ROW : id === WATER_ROW.id ? WATER_ROW : null),
      )
      const groups = await service.getGroups({ kind: 'exact', version: 3 })
      const container = groups.containerGroups[0]!
      const result = await service.propagateItemEdit({ kind: 'exact', version: 3 }, container.id, 'admin1', {
        field: 'hidden',
        hidden: { hidden: true },
      })
      expect(result.wroteCount).toBe(2)
    })
  })
})
