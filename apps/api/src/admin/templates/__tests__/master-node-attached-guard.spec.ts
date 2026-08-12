/**
 * Session S5, Part C — the NODE_IS_ATTACHED guard on every single-node edit path, plus the two
 * ways past it: detach (Part C.2) and attach/re-attach (Part C.3/D3). Same Prisma-mocking
 * convention as templates-service-structural.spec.ts.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { TemplatesAdminService } from '../templates.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditLogService } from '../../../audit/audit.service'
import { MinioService } from '../../../minio/minio.service'

function attachedFixture() {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A1',
        labelTh: 'ทางลาด',
        items: [
          {
            code: 'A1.1',
            labelTh: 'ทางลาด',
            subItems: [
              {
                code: 'A1.1-1',
                labelTh: 'ความกว้าง',
                answerType: 'presence_standard',
                masterId: 'master-1',
                measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: true }],
              },
              { code: 'A1.1-2', labelTh: 'พื้นผิว', answerType: 'presence' },
            ],
          },
        ],
      },
    ],
  }
}

describe('TemplatesAdminService — Part C.1 NODE_IS_ATTACHED guard', () => {
  let service: TemplatesAdminService
  const findUnique = jest.fn()
  const update = jest.fn()
  const masterFindUnique = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    findUnique.mockResolvedValue({ id: 't1', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'ACTIVE', definition: attachedFixture() })
    update.mockResolvedValue({})
    const moduleRef = await Test.createTestingModule({
      providers: [
        TemplatesAdminService,
        {
          provide: PrismaService,
          useValue: {
            checklistTemplate: { findUnique, update },
            masterCriterion: { findUnique: masterFindUnique },
            lawReference: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: {} },
      ],
    }).compile()
    service = moduleRef.get(TemplatesAdminService)
  })

  it('rejects a threshold edit on an attached node with a typed NODE_IS_ATTACHED error', async () => {
    await expect(
      service.editMeasurement('t1', 'A1.1-1', 'm1', { operator: 'gte', value: 950, unit: 'mm', autoGrade: true }, 'admin1'),
    ).rejects.toMatchObject({ response: { code: 'NODE_IS_ATTACHED' } })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects guidance/lawRefs/label edits on an attached node the same way', async () => {
    await expect(service.editGuidance('t1', 'A1.1-1', { text: 'new guidance' }, 'admin1')).rejects.toThrow(ForbiddenException)
    await expect(service.editLawRefs('t1', 'A1.1-1', { lawRefs: [], beyondLaw: false }, 'admin1')).rejects.toThrow(ForbiddenException)
    expect(update).not.toHaveBeenCalled()
  })

  it('an ordinary (unattached) sibling node is editable as normal', async () => {
    await service.editHidden('t1', 'A1.1-2', { hidden: true }, 'admin1')
    expect(update).toHaveBeenCalled()
  })

  it('detachMaster clears masterId, sets detachedFromMasterId, and does NOT strip the node values', async () => {
    const result = await service.detachMaster('t1', 'A1.1-1', 'admin1')
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n: { code: string }) => n.code === 'A1.1-1')!
    expect(node.masterId).toBeUndefined()
    expect(node.detachedFromMasterId).toBe('master-1')
    expect(node.measurements![0]!.value).toBe(900)
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEMPLATE_MASTER_DETACH' }))
  })

  it('after detach, the node is editable again through the ordinary edit path', async () => {
    const detached = await service.detachMaster('t1', 'A1.1-1', 'admin1')
    findUnique.mockResolvedValue({ id: 't1', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'ACTIVE', definition: detached.definition })
    await service.editMeasurement('t1', 'A1.1-1', 'm1', { operator: 'gte', value: 950, unit: 'mm', autoGrade: true }, 'admin1')
    expect(update).toHaveBeenCalled()
  })

  it('attachMaster (D3) wholesale-overwrites the node from the master\'s current state and re-links it', async () => {
    // Start from a node that is unattached (e.g. a fresh detach) with STALE values.
    const detachedDef = {
      ...attachedFixture(),
      groups: [
        {
          ...attachedFixture().groups[0],
          items: [
            {
              ...attachedFixture().groups[0]!.items[0],
              subItems: [
                { code: 'A1.1-1', labelTh: 'ค่าเก่า', answerType: 'presence_standard', detachedFromMasterId: 'master-1', measurements: [{ key: 'm1', operator: 'gte', value: 500, unit: 'mm', autoGrade: true, confirmed: false }] },
                attachedFixture().groups[0]!.items[0]!.subItems![1],
              ],
            },
          ],
        },
      ],
    }
    findUnique.mockResolvedValue({ id: 't1', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'ACTIVE', definition: detachedDef })
    masterFindUnique.mockResolvedValue({
      id: 'master-1', labelTh: 'ค่าล่าสุดจากต้นแบบ', answerType: 'presence_standard',
      measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: true }],
      guidance: null, imageKeys: [], lawRefs: [], cabinetResolution: null, beyondLaw: null, facilityCode: null,
    })

    const result = await service.attachMaster('t1', 'A1.1-1', { masterId: 'master-1' }, 'admin1')
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n: { code: string }) => n.code === 'A1.1-1')!
    expect(node.masterId).toBe('master-1')
    expect(node.detachedFromMasterId).toBeUndefined()
    expect(node.labelTh).toBe('ค่าล่าสุดจากต้นแบบ')
    expect(node.measurements![0]!.value).toBe(900) // overwritten, not merged with the stale 500
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEMPLATE_MASTER_REATTACH' }))
  })

  it('attachMaster refuses when the node is already attached to a (possibly different) master', async () => {
    findUnique.mockResolvedValue({ id: 't1', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'ACTIVE', definition: attachedFixture() })
    await expect(service.attachMaster('t1', 'A1.1-1', { masterId: 'master-2' }, 'admin1')).rejects.toThrow(BadRequestException)
  })

  it('attachMaster 404s on an unknown masterId', async () => {
    const detachedDef = attachedFixture()
    detachedDef.groups[0]!.items[0]!.subItems![0]!.masterId = undefined as unknown as string
    findUnique.mockResolvedValue({ id: 't1', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'ACTIVE', definition: detachedDef })
    masterFindUnique.mockResolvedValue(null)
    await expect(service.attachMaster('t1', 'A1.1-1', { masterId: 'ghost' }, 'admin1')).rejects.toThrow('not found')
  })
})
