/**
 * Session S3b, Part C.1 — the versioning gate: clone-to-draft, and the DRAFT-only lockout on
 * every structural mutation (an ACTIVE or RETIRED template must reject them with
 * STRUCTURE_EDIT_REQUIRES_DRAFT, never silently apply).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { TemplatesAdminService } from '../templates.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditLogService } from '../../../audit/audit.service'
import { MinioService } from '../../../minio/minio.service'

function fixtureDef() {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      { code: 'A1', labelTh: 'ที่จอดรถ', items: [{ code: 'A1.1', labelTh: 'ทางลาด', answerType: 'presence' }] },
    ],
  }
}

describe('TemplatesAdminService — Part C.1 versioning gate', () => {
  let service: TemplatesAdminService
  const findUnique = jest.fn()
  const update = jest.fn()
  const create = jest.fn()
  const aggregate = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        TemplatesAdminService,
        {
          provide: PrismaService,
          useValue: {
            checklistTemplate: { findUnique, update, create, aggregate },
            lawReference: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: {} },
      ],
    }).compile()
    service = moduleRef.get(TemplatesAdminService)
  })

  it('clones an ACTIVE template into a new DRAFT at version+1', async () => {
    findUnique.mockResolvedValue({ id: 't1', mode: 'ทางบก', variantKey: 'standard', version: 2, status: 'ACTIVE', definition: fixtureDef() })
    aggregate.mockResolvedValue({ _max: { version: 2 } })
    create.mockResolvedValue({ id: 't-new', mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'DRAFT' })

    const result = await service.cloneToDraft('t1', 'admin1')

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: 'ทางบก', variantKey: 'standard', version: 3, status: 'DRAFT' }),
    }))
    expect(result.version).toBe(3)
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEMPLATE_CLONE_TO_DRAFT' }))
  })

  it('refuses to clone a DRAFT or RETIRED template', async () => {
    findUnique.mockResolvedValue({ id: 't1', mode: 'ทางบก', variantKey: 'standard', version: 2, status: 'DRAFT', definition: fixtureDef() })
    await expect(service.cloneToDraft('t1', 'admin1')).rejects.toThrow(BadRequestException)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects every structural mutation on an ACTIVE template', async () => {
    findUnique.mockResolvedValue({ id: 't1', status: 'ACTIVE', definition: fixtureDef() })

    await expect(service.setQuestionType('t1', 'A1.1', { type: 'presence_standard' }, 'admin1')).rejects.toThrow(ForbiddenException)
    await expect(service.addChild('t1', 'A1.1', { labelTh: 'x', type: 'presence' }, 'admin1')).rejects.toThrow(ForbiddenException)
    await expect(
      service.addTopLevelItem('t1', { containerCode: 'A1', anchorCode: 'A1.1', side: 'before', labelTh: 'x', type: 'presence' }, 'admin1'),
    ).rejects.toThrow(ForbiddenException)
    await expect(service.deleteNode('t1', 'A1.1', 'admin1')).rejects.toThrow(ForbiddenException)
    await expect(service.reorderNode('t1', 'A1.1', { direction: 'up' }, 'admin1')).rejects.toThrow(ForbiddenException)
    await expect(service.editLabel('t1', 'A1.1', { labelTh: 'x' }, 'admin1')).rejects.toThrow(ForbiddenException)
    await expect(service.reorderMeasurement('t1', 'A1.1', 'm1', { direction: 'up' }, 'admin1')).rejects.toThrow(ForbiddenException)
    expect(update).not.toHaveBeenCalled()
  })

  it('allows the same structural mutation once the template is a DRAFT', async () => {
    findUnique.mockResolvedValue({ id: 't1', status: 'DRAFT', definition: fixtureDef() })
    update.mockResolvedValue({})

    await expect(service.setQuestionType('t1', 'A1.1', { type: 'presence_standard' }, 'admin1')).resolves.toBeDefined()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('lawRefs editing is NOT gated by DRAFT-only — it works on ACTIVE too', async () => {
    findUnique.mockResolvedValue({ id: 't1', status: 'ACTIVE', definition: fixtureDef() })
    update.mockResolvedValue({})

    await expect(service.editLawRefs('t1', 'A1.1', { lawRefs: [], beyondLaw: false }, 'admin1')).resolves.toBeDefined()
    expect(update).toHaveBeenCalledTimes(1)
  })

  // Era-editor safety follow-up — addTopLevelItem: the individual-editor sibling of the grouped
  // editor's add-and-place, adding a brand-new item directly under a GROUP (not a child of an
  // already-selected node).
  describe('addTopLevelItem', () => {
    it('inserts a new top-level item at the requested position, renumbering the level to match display order', async () => {
      findUnique.mockResolvedValue({ id: 't1', status: 'DRAFT', definition: fixtureDef() })
      update.mockResolvedValue({})

      const result = await service.addTopLevelItem(
        't1',
        { containerCode: 'A1', anchorCode: 'A1.1', side: 'before', labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้', type: 'presence' },
        'admin1',
      )

      // Era-editor safety follow-up (live feedback) — a positioned insert now renumbers the whole
      // level so the new item's code matches where it visually lands: it takes over 'A1.1', and
      // the original 'A1.1' content shifts to 'A1.2'.
      expect(result.code).toBe('A1.1')
      expect(update).toHaveBeenCalledTimes(1)
      const written = update.mock.calls[0]![0].data.definition
      expect(written.groups[0].items).toHaveLength(2)
      expect(written.groups[0].items[0].code).toBe('A1.1')
      expect(written.groups[0].items[0].labelTh).toBe('ถังขยะแบบยกเคลื่อนที่ได้')
      expect(written.groups[0].items[1].code).toBe('A1.2')
      expect(written.groups[0].items[1].labelTh).toBe('ทางลาด') // the original A1.1's content, shifted
      expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEMPLATE_STRUCTURE_EDIT' }))
    })

    it('resolves lawRefs/cabinetResolution from FACILITY_CATALOG when facilityCode is supplied, unless explicit lawRefs are given', async () => {
      findUnique.mockResolvedValue({ id: 't1', status: 'DRAFT', definition: fixtureDef() })
      update.mockResolvedValue({})

      // facilityCode 3 = "ทางลาด", cabinetResolution: true, lawRefs: ['MHT_2548','PSD_2555','MOT_2556','MHT_2564']
      await service.addTopLevelItem(
        't1',
        { containerCode: 'A1', anchorCode: 'A1.1', side: 'after', labelTh: 'ทางลาดใหม่', type: 'presence', facilityCode: 3 },
        'admin1',
      )
      const written = update.mock.calls[0]![0].data.definition
      const inserted = written.groups[0].items[1]
      expect(inserted.facilityCode).toBe(3)
      expect(inserted.lawRefs).toEqual(['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564'])
      expect(inserted.cabinetResolution).toBe(true)
    })

    it('rejects an unknown facilityCode with no writes', async () => {
      findUnique.mockResolvedValue({ id: 't1', status: 'DRAFT', definition: fixtureDef() })

      await expect(
        service.addTopLevelItem(
          't1',
          { containerCode: 'A1', anchorCode: 'A1.1', side: 'before', labelTh: 'x', type: 'presence', facilityCode: 9999 },
          'admin1',
        ),
      ).rejects.toThrow(BadRequestException)
      expect(update).not.toHaveBeenCalled()
    })
  })

  // Era-editor safety follow-up — reorderNode now pins codes to their slot (core.reorderNode's
  // own spec covers the tree-editing logic in full); this just checks the service surfaces the
  // moved content's new code so a caller can keep an open editor pointed at it.
  describe('reorderNode', () => {
    it('returns the moved content\'s new code as `code`', async () => {
      const def = fixtureDef()
      def.groups[0]!.items.push({ code: 'A1.2', labelTh: 'ห้องน้ำ', answerType: 'presence' })
      findUnique.mockResolvedValue({ id: 't1', status: 'DRAFT', definition: def })
      update.mockResolvedValue({})

      const result = await service.reorderNode('t1', 'A1.2', { direction: 'up' }, 'admin1')

      expect(result.code).toBe('A1.1')
      const written = update.mock.calls[0]![0].data.definition
      expect(written.groups[0].items.map((n: { code: string }) => n.code)).toEqual(['A1.1', 'A1.2'])
      expect(written.groups[0].items[0].labelTh).toBe('ห้องน้ำ')
    })
  })
})
