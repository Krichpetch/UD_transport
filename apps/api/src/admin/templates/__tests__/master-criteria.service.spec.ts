/**
 * Session S5, Part D — MasterCriteriaService.update: the atomic auto-push. Same Prisma/$transaction
 * mocking convention as approve-checklist-transaction.spec.ts: every write must route through the
 * tx-scoped client, never the root client, and a thrown error inside the callback must propagate
 * without any root write ever having happened.
 */
import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { MasterCriteriaService } from '../master-criteria.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditLogService } from '../../../audit/audit.service'

function defWithAttached(value: number) {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A1',
        labelTh: 'กลุ่ม',
        items: [
          {
            code: 'A1.1',
            labelTh: 'รายการ',
            subItems: [
              {
                code: 'A1.1-1',
                labelTh: 'ป้ายชื่อเดิม',
                answerType: 'presence_standard',
                masterId: 'master-1',
                measurements: [{ key: 'm1', operator: 'gte', value, unit: 'mm', autoGrade: true, confirmed: true }],
              },
            ],
          },
        ],
      },
    ],
  }
}

const MASTER_ROW = {
  id: 'master-1',
  labelTh: 'ป้ายชื่อเดิม',
  answerType: 'presence_standard',
  measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: true }],
  guidance: null,
  imageKeys: [] as string[],
  lawRefs: [] as string[],
  cabinetResolution: null,
  beyondLaw: null,
  facilityCode: null,
  updatedAt: new Date(),
  updatedBy: 'admin0',
  createdAt: new Date(),
}

const DRAFT_ROW = { id: 't-draft', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'DRAFT', definition: defWithAttached(900) }
const ACTIVE_ROW = { id: 't-active', mode: 'ทางราง', variantKey: 'rail_metro', version: 3, status: 'ACTIVE', definition: defWithAttached(900) }
const RETIRED_ROW = { id: 't-retired', mode: 'ทางน้ำ', variantKey: 'standard', version: 3, status: 'RETIRED', definition: defWithAttached(900) }

describe('MasterCriteriaService.update — Part D atomic auto-push', () => {
  let service: MasterCriteriaService
  const masterFindUnique = jest.fn()
  const masterUpdateRoot = jest.fn() // root — must NEVER be called
  const templateUpdateRoot = jest.fn() // root — must NEVER be called
  const templateFindManyRoot = jest.fn()
  const checklistCount = jest.fn()

  const txMasterUpdate = jest.fn()
  const txAuditCreate = jest.fn()
  const txTemplateFindMany = jest.fn()
  const txTemplateUpdate = jest.fn()
  const transactionMock = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      masterCriterion: { update: txMasterUpdate },
      auditLog: { create: txAuditCreate },
      checklistTemplate: { findMany: txTemplateFindMany, update: txTemplateUpdate },
    }),
  )

  beforeEach(async () => {
    jest.clearAllMocks()
    masterFindUnique.mockResolvedValue(MASTER_ROW)
    checklistCount.mockResolvedValue(3)
    templateFindManyRoot.mockResolvedValue([DRAFT_ROW, ACTIVE_ROW, RETIRED_ROW])
    txTemplateFindMany.mockResolvedValue([DRAFT_ROW, ACTIVE_ROW, RETIRED_ROW])
    txMasterUpdate.mockResolvedValue({})
    txTemplateUpdate.mockResolvedValue({})
    txAuditCreate.mockResolvedValue({})

    const moduleRef = await Test.createTestingModule({
      providers: [
        MasterCriteriaService,
        {
          provide: PrismaService,
          useValue: {
            masterCriterion: { findUnique: masterFindUnique, update: masterUpdateRoot },
            checklistTemplate: { update: templateUpdateRoot, findMany: templateFindManyRoot },
            checklist: { count: checklistCount },
            $transaction: transactionMock,
          },
        },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(MasterCriteriaService)
  })

  it('writes every attached non-RETIRED instance inside the transaction, skips RETIRED, and reports the ACTIVE re-grade count', async () => {
    const result = await service.update('master-1', { labelTh: 'ป้ายชื่อใหม่' }, 'admin1')

    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(txMasterUpdate).toHaveBeenCalledTimes(1)
    expect(txTemplateUpdate).toHaveBeenCalledTimes(2) // DRAFT + ACTIVE, never the RETIRED row
    expect(txTemplateUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't-draft' } }))
    expect(txTemplateUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't-active' } }))

    // Nothing ever escapes to the root client — under a real DB this is what makes the write atomic.
    expect(masterUpdateRoot).not.toHaveBeenCalled()
    expect(templateUpdateRoot).not.toHaveBeenCalled()

    expect(result.wroteCount).toBe(2)
    expect(result.skippedRetired).toEqual([{ templateId: 't-retired', mode: 'ทางน้ำ', variantKey: 'standard', nodeCode: 'A1.1-1' }])
    // Part 1b — informational, never a block: the ACTIVE template's re-grade count is surfaced.
    expect(result.activeRegrade).toEqual([{ templateId: 't-active', mode: 'ทางราง', variantKey: 'rail_metro', version: 3, count: 3 }])
    expect(checklistCount).toHaveBeenCalledWith({ where: { templateId: 't-active', status: { not: 'DRAFT' } } })
  })

  it('a bad patch throws mid-transaction — no root write happens under any circumstances', async () => {
    // operator:'range' requires a numeric value2 (checklist-template.ts#parseMeasurement) — this
    // patch is missing it, so pushMasterToInstance's parseTemplateDefinition call throws the moment
    // it processes the first attached instance inside the transaction callback.
    const badDto = { measurements: [{ key: 'm1', operator: 'range' as const, value: 900, unit: 'mm', autoGrade: true }] }

    await expect(service.update('master-1', badDto, 'admin1')).rejects.toThrow(BadRequestException)

    expect(masterUpdateRoot).not.toHaveBeenCalled()
    expect(templateUpdateRoot).not.toHaveBeenCalled()
  })

  it('shares one correlationId across the master row and every instance audit log', async () => {
    await service.update('master-1', { labelTh: 'x' }, 'admin1')
    const masterAuditCall = txAuditCreate.mock.calls.find((c) => (c[0].data.entityType as string) === 'MasterCriterion')!
    const instanceAuditCalls = txAuditCreate.mock.calls.filter((c) => (c[0].data.entityType as string) === 'ChecklistTemplate')
    const correlationId = (masterAuditCall[0].data.before as { correlationId: string }).correlationId
    expect(instanceAuditCalls).toHaveLength(2)
    for (const call of instanceAuditCalls) {
      expect((call[0].data.before as { correlationId: string }).correlationId).toBe(correlationId)
    }
  })

  it('D2 — detachedCount reflects nodes carrying detachedFromMasterId, never blocked by or counted in the push', async () => {
    const detachedRow = {
      id: 't-detached',
      mode: 'ทางอากาศ',
      variantKey: 'standard',
      version: 3,
      status: 'DRAFT',
      definition: {
        schemaVersion: 2,
        mode: 'ทางอากาศ',
        groups: [{ code: 'A1', labelTh: 'g', items: [{ code: 'A1.1', labelTh: 'i', subItems: [{ code: 'A1.1-1', labelTh: 'แยกออกแล้ว', answerType: 'presence', detachedFromMasterId: 'master-1' }] }] }],
      },
    }
    txTemplateFindMany.mockResolvedValue([DRAFT_ROW, ACTIVE_ROW, RETIRED_ROW, detachedRow])
    templateFindManyRoot.mockResolvedValue([DRAFT_ROW, ACTIVE_ROW, RETIRED_ROW, detachedRow])

    const result = await service.update('master-1', { labelTh: 'x' }, 'admin1')
    expect(result.detachedCount).toBe(1)
    expect(result.wroteCount).toBe(2) // the detached instance never received the push
  })
})

describe('MasterCriteriaService.create/list/get', () => {
  let service: MasterCriteriaService
  const masterFindUnique = jest.fn()
  const masterFindMany = jest.fn()
  const masterCreate = jest.fn()
  const templateFindMany = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    templateFindMany.mockResolvedValue([DRAFT_ROW, ACTIVE_ROW])
    const moduleRef = await Test.createTestingModule({
      providers: [
        MasterCriteriaService,
        {
          provide: PrismaService,
          useValue: {
            masterCriterion: { findUnique: masterFindUnique, findMany: masterFindMany, create: masterCreate },
            checklistTemplate: { findMany: templateFindMany },
          },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()
    service = moduleRef.get(MasterCriteriaService)
  })

  it('create writes a new MasterCriterion row and audit-logs TEMPLATE_MASTER_CREATE', async () => {
    masterCreate.mockResolvedValue(MASTER_ROW)
    const result = await service.create({ labelTh: 'ป้ายใหม่' }, 'admin1')
    expect(result).toEqual(MASTER_ROW)
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEMPLATE_MASTER_CREATE', entityType: 'MasterCriterion' }))
  })

  it('list returns attached/detached counts computed by scanning every template', async () => {
    masterFindMany.mockResolvedValue([MASTER_ROW])
    const result = await service.list()
    expect(result).toHaveLength(1)
    expect(result[0]!.attachedCount).toBe(2) // DRAFT_ROW + ACTIVE_ROW both carry masterId: 'master-1'
    expect(result[0]!.detachedCount).toBe(0)
  })

  it('get returns the master with its attached instances listed', async () => {
    masterFindUnique.mockResolvedValue(MASTER_ROW)
    const result = await service.get('master-1')
    expect(result.attached).toHaveLength(2)
    expect(result.attached.map((a) => a.templateId).sort()).toEqual(['t-active', 't-draft'])
  })
})
