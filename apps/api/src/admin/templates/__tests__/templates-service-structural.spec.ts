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
})
