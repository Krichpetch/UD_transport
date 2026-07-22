/**
 * E-form redesign (Session E1, Part D) — one DRAFT per (stationId, auditorId), enforced by a
 * partial unique index (migrations/20260718170200_checklist_draft_submit_uniqueness). saveDraft()
 * does a plain find-then-create/update, but a concurrent double-create now loses the race via a
 * real DB constraint (P2002) instead of a read-then-write check — the loser falls back to
 * updating the row the winner just created, rather than surfacing an error to the auditor.
 */

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

describe('ChecklistsService.saveDraft — P2002 race handling (Part D partial unique index)', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistUpdate = jest.fn()
  const checklistFindFirst = jest.fn()
  const checklistFindFirstOrThrow = jest.fn()
  const findOne = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', coordStatus: 'APPROXIMATE' })

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: {
              create: checklistCreate,
              update: checklistUpdate,
              findFirst: checklistFindFirst,
              findFirstOrThrow: checklistFindFirstOrThrow,
            },
            checklistTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
          },
        },
        { provide: StationsService, useValue: { findOne } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn().mockResolvedValue('https://example.test/photo'), remove: jest.fn() } },
      ],
    }).compile()

    service = moduleRef.get(ChecklistsService)
  })

  it('falls back to updating the winner’s row when create() loses the P2002 race', async () => {
    checklistFindFirst.mockResolvedValue(null) // this request saw no existing draft...
    checklistCreate.mockRejectedValue(p2002()) // ...but lost the create race to a concurrent request
    checklistFindFirstOrThrow.mockResolvedValue({ id: 'winner-id', stationId: 's1', auditorId: 'u1', status: 'DRAFT' })
    checklistUpdate.mockResolvedValue({ id: 'winner-id', stationId: 's1', auditorId: 'u1', status: 'DRAFT' })

    const result = await service.saveDraft('s1', 'u1', [{ groupId: 'A', groupName: 'A', items: [] }])

    expect(result.id).toBe('winner-id')
    expect(checklistUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'winner-id' } }))
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'SAVE_DRAFT', entityId: 'winner-id' }))
  })

  it('re-throws non-P2002 create errors unchanged', async () => {
    checklistFindFirst.mockResolvedValue(null)
    const otherError = new Error('connection reset')
    checklistCreate.mockRejectedValue(otherError)

    await expect(service.saveDraft('s1', 'u1', [])).rejects.toBe(otherError)
  })
})
