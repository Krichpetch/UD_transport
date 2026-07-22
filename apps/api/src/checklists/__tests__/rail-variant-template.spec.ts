/**
 * E-form redesign (Session E3, Part A) — rail subtype -> ChecklistTemplate.variantKey selection.
 * ChecklistsService.getActiveTemplate (private) is exercised indirectly via saveDraft(), which is
 * the same pattern submit-validation.spec.ts uses for template lookup. Covers: metro vs train
 * subtypes resolving different variantKeys, a non-rail mode staying on 'standard' with a single
 * lookup, an unknown/null rail subtype hitting the declared default, and the fallback-to-'standard'
 * behavior that keeps every other mode's (and today's real DB state's) v1 path unaffected.
 */
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'
import type { ChecklistTemplateDefinition } from '@repo/types'

const STANDARD_TEMPLATE: ChecklistTemplateDefinition = {
  schemaVersion: 1,
  mode: 'ทางราง',
  groups: [{ code: 'A1', labelTh: 'test', items: [{ code: 'A1.1', labelTh: 'x', answerType: 'choice' }] }],
}

describe('ChecklistsService — rail subtype variant template selection', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const templateFindFirst = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    checklistFindFirst.mockResolvedValue(null)
    checklistCreate.mockResolvedValue({ id: 'cl1' })

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { create: checklistCreate, findFirst: checklistFindFirst },
            checklistTemplate: { findFirst: templateFindFirst },
          },
        },
        { provide: StationsService, useValue: { findOne } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn().mockResolvedValue('https://example.test/photo'), remove: jest.fn() } },
      ],
    }).compile()

    service = moduleRef.get(ChecklistsService)
  })

  const emptyItems: unknown[] = []

  it('metro-subtype station queries variantKey rail_metro before falling back to standard', async () => {
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางราง', railSubtype: 'รถไฟฟ้า' })
    templateFindFirst
      .mockResolvedValueOnce(null) // no ACTIVE rail_metro row yet
      .mockResolvedValueOnce({ id: 't-std', version: 1, definition: STANDARD_TEMPLATE }) // fallback

    await service.saveDraft('s1', 'u1', emptyItems)

    expect(templateFindFirst).toHaveBeenCalledTimes(2)
    expect(templateFindFirst.mock.calls[0][0].where).toMatchObject({ mode: 'ทางราง', variantKey: 'rail_metro', status: 'ACTIVE' })
    expect(templateFindFirst.mock.calls[1][0].where).toMatchObject({ mode: 'ทางราง', variantKey: 'standard', status: 'ACTIVE' })
  })

  it('train-subtype station queries variantKey rail_train before falling back to standard', async () => {
    findOne.mockResolvedValue({ id: 's2', mode: 'ทางราง', railSubtype: 'รถไฟ' })
    templateFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 't-std', version: 1, definition: STANDARD_TEMPLATE })

    await service.saveDraft('s2', 'u1', emptyItems)

    expect(templateFindFirst.mock.calls[0][0].where).toMatchObject({ mode: 'ทางราง', variantKey: 'rail_train' })
    expect(templateFindFirst.mock.calls[1][0].where).toMatchObject({ mode: 'ทางราง', variantKey: 'standard' })
  })

  it('a mode !== rail station is untouched — resolves straight to standard, one lookup', async () => {
    findOne.mockResolvedValue({ id: 's3', mode: 'ทางบก', railSubtype: null })
    templateFindFirst.mockResolvedValueOnce({ id: 't-std', version: 1, definition: STANDARD_TEMPLATE })

    await service.saveDraft('s3', 'u1', emptyItems)

    expect(templateFindFirst).toHaveBeenCalledTimes(1)
    expect(templateFindFirst.mock.calls[0][0].where).toMatchObject({ mode: 'ทางบก', variantKey: 'standard', status: 'ACTIVE' })
  })

  it('unknown/null rail subtype hits the declared default (rail_train) rather than throwing', async () => {
    findOne.mockResolvedValue({ id: 's4', mode: 'ทางราง', railSubtype: null })
    templateFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 't-std', version: 1, definition: STANDARD_TEMPLATE })

    await expect(service.saveDraft('s4', 'u1', emptyItems)).resolves.toBeDefined()
    expect(templateFindFirst.mock.calls[0][0].where).toMatchObject({ mode: 'ทางราง', variantKey: 'rail_train' })
  })

  it('v1 path unaffected: with only a standard ACTIVE row seeded (today\'s real DB state), a rail station of either subtype ends up on the v1 anchor via fallback', async () => {
    findOne.mockResolvedValue({ id: 's5', mode: 'ทางราง', railSubtype: 'รถไฟฟ้า' })
    templateFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 't-std', version: 1, definition: STANDARD_TEMPLATE })

    await service.saveDraft('s5', 'u1', emptyItems)

    expect(checklistCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ templateId: 't-std', templateVersion: 1 }),
    }))
  })
})
