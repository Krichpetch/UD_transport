/**
 * Session E3, Part E.1 — confirms APPROXIMATE/PENDING coordStatus stations are excluded from the
 * proximity hard-block: submit() must never throw OUT_OF_RANGE/LOCATION_REQUIRED for these, even
 * with no GPS reading at all, only locationVerified: false. Verification task — this is existing
 * ChecklistsService.submit behavior (station.coordStatus !== 'OK' skips the distance check
 * entirely), confirmed explicitly rather than only implicitly via other specs' fixtures.
 */
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'

describe('ChecklistsService.submit — Part E.1 APPROXIMATE/PENDING proximity exclusion', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const distanceToStationMeters = jest.fn()

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
            checklistTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
          },
        },
        { provide: StationsService, useValue: { findOne, distanceToStationMeters } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  it.each(['APPROXIMATE', 'PENDING', 'INVALID'] as const)(
    'coordStatus=%s never hard-blocks submit, even with no GPS at all',
    async (coordStatus) => {
      findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', railSubtype: null, coordStatus, yearBuilt: null })

      await expect(service.submit('s1', 'u1', [], undefined, undefined)).resolves.toBeDefined()

      expect(distanceToStationMeters).not.toHaveBeenCalled()
      expect(checklistCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ locationVerified: false }),
      }))
    },
  )

  it('coordStatus=OK still enforces the gate (GPS required)', async () => {
    findOne.mockResolvedValue({ id: 's2', mode: 'ทางบก', railSubtype: null, coordStatus: 'OK', yearBuilt: null })
    await expect(service.submit('s2', 'u1', [], undefined, undefined)).rejects.toMatchObject({
      response: { code: 'LOCATION_REQUIRED' },
    })
  })
})
