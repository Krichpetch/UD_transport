/**
 * Session S3b, Part A.2 — tutorial/example mode's server-enforced submit() overrides for a
 * training station (Station.isTraining, never a client-supplied flag):
 *   - proximity gate skipped entirely, even coordStatus=OK with no GPS at all
 *   - auto-finalizes straight to APPROVED (never rests at SUBMITTED) with a server-computed score
 *   - isTraining is stamped onto the Checklist row from the station
 *   - repeatable: since it never touches the SUBMITTED partial-unique index, a second submit for
 *     the same (station, auditor) never throws DUPLICATE_SUBMIT
 */
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'

describe('ChecklistsService.submit — Part A.2 training-station overrides', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const distanceToStationMeters = jest.fn()

  const trainingStation = {
    id: 'train-1',
    mode: 'ทางบก',
    railSubtype: null,
    coordStatus: 'OK', // deliberately OK — the gate must skip regardless, not because coords are unverified
    yearBuilt: 2560,
    isTraining: true,
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    checklistFindFirst.mockResolvedValue(null)
    checklistCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cl-1', ...data }))

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

  it('skips the proximity gate entirely — no GPS, coordStatus=OK, no distance lookup', async () => {
    findOne.mockResolvedValue(trainingStation)

    const result = await service.submit('train-1', 'u1', [], undefined, undefined)

    expect(distanceToStationMeters).not.toHaveBeenCalled()
    expect(result.locationVerified).toBeNull()
  })

  it('auto-finalizes straight to APPROVED, stamping isTraining and a computed score', async () => {
    findOne.mockResolvedValue(trainingStation)

    const result = await service.submit('train-1', 'u1', [], undefined, undefined)

    expect(checklistCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'APPROVED', isTraining: true }),
    }))
    expect(result.status).toBe('APPROVED')
    expect(typeof result.score).toBe('number')
  })

  it('is repeatable — a second submit for the same (station, auditor) never throws DUPLICATE_SUBMIT', async () => {
    findOne.mockResolvedValue(trainingStation)

    await expect(service.submit('train-1', 'u1', [], undefined, undefined)).resolves.toBeDefined()
    await expect(service.submit('train-1', 'u1', [], undefined, undefined)).resolves.toBeDefined()

    expect(checklistCreate).toHaveBeenCalledTimes(2)
  })

  it('a real (non-training) station still enforces the gate, unaffected by this branch', async () => {
    findOne.mockResolvedValue({ id: 's-real', mode: 'ทางบก', railSubtype: null, coordStatus: 'OK', yearBuilt: 2560, isTraining: false })

    await expect(service.submit('s-real', 'u1', [], undefined, undefined)).rejects.toMatchObject({
      response: { code: 'LOCATION_REQUIRED' },
    })
  })
})
