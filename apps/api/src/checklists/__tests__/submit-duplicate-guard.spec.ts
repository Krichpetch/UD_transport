/**
 * E-form redesign (Session E1, Part D) — replaces the Session-2 10-minute read-then-write
 * stopgap with a real DB constraint: a partial unique index enforces at most one pending-review
 * (SUBMITTED, not yet APPROVED/REJECTED) checklist per (stationId, auditorId) — see
 * migrations/20260718170200_checklist_draft_submit_uniqueness. ChecklistsService.submit() now
 * relies on that constraint firing (Prisma error code P2002) rather than checking beforehand.
 */

import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

describe('ChecklistsService.submit — pending-review uniqueness (Part D partial unique index)', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  // Session E2, Part A — submit() now looks up the auditor's existing DRAFT (if any) to reuse
  // its era-resolution stamp; this suite only cares about P2002 handling, so "no existing draft"
  // (null) is the fixed answer for every test here.
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const distanceToStationMeters = jest.fn()
  const auditLog = jest.fn()
  const templateFindFirst = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', coordStatus: 'APPROXIMATE', yearBuilt: null })
    templateFindFirst.mockResolvedValue(null)
    checklistFindFirst.mockResolvedValue(null)

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
        { provide: StationsService, useValue: { findOne, distanceToStationMeters } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn().mockResolvedValue('https://example.test/photo'), remove: jest.fn() } },
      ],
    }).compile()

    service = moduleRef.get(ChecklistsService)
  })

  it('converts a P2002 unique-violation into a 409 DUPLICATE_SUBMIT, without retrying the write', async () => {
    checklistCreate.mockRejectedValue(p2002())

    await expect(service.submit('s1', 'u1', [])).rejects.toThrow(ConflictException)
    expect(checklistCreate).toHaveBeenCalledTimes(1)
  })

  it('allows submit when no pending duplicate exists', async () => {
    checklistCreate.mockResolvedValue({ id: 'cl1', stationId: 's1', auditorId: 'u1', status: 'SUBMITTED' })

    const result = await service.submit('s1', 'u1', [])

    expect(result.status).toBe('SUBMITTED')
    expect(checklistCreate).toHaveBeenCalledTimes(1)
  })

  it('re-throws non-P2002 errors unchanged', async () => {
    const otherError = new Error('connection reset')
    checklistCreate.mockRejectedValue(otherError)

    await expect(service.submit('s1', 'u1', [])).rejects.toBe(otherError)
  })
})
