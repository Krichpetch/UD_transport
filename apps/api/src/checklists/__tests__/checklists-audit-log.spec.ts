/**
 * Compliance regression test — CLAUDE.md: "Every data mutation (checklist
 * submit, station update) must write an AuditLog entry." submit() and
 * saveDraft() previously wrote to the DB with no AuditLogService call at
 * all.
 */

import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'

describe('ChecklistsService — AuditLog on write paths', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistUpdate = jest.fn()
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const distanceToStationMeters = jest.fn()
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
            },
            checklistTemplate: {
              // No ACTIVE template in this fixture — service degrades gracefully (Part A.4).
              findFirst: jest.fn().mockResolvedValue(null),
            },
          },
        },
        { provide: StationsService, useValue: { findOne, distanceToStationMeters } },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()

    service = moduleRef.get(ChecklistsService)
  })

  it('writes a SUBMIT_CHECKLIST audit log entry on submit()', async () => {
    checklistCreate.mockResolvedValue({ id: 'cl1', stationId: 's1', auditorId: 'u1', status: 'SUBMITTED' })

    await service.submit('s1', 'u1', [])

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'SUBMIT_CHECKLIST',
        entityType: 'Checklist',
        entityId: 'cl1',
      }),
    )
  })

  it('writes a SAVE_DRAFT audit log entry on saveDraft() — new draft', async () => {
    checklistFindFirst.mockResolvedValue(null)
    checklistCreate.mockResolvedValue({ id: 'cl2', stationId: 's1', auditorId: 'u1', status: 'DRAFT' })

    await service.saveDraft('s1', 'u1', [])

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'SAVE_DRAFT',
        entityType: 'Checklist',
        entityId: 'cl2',
      }),
    )
  })

  it('writes a SAVE_DRAFT audit log entry on saveDraft() — existing draft update', async () => {
    checklistFindFirst.mockResolvedValue({ id: 'cl3', stationId: 's1', auditorId: 'u1', status: 'DRAFT' })
    checklistUpdate.mockResolvedValue({ id: 'cl3', stationId: 's1', auditorId: 'u1', status: 'DRAFT' })

    await service.saveDraft('s1', 'u1', [])

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'SAVE_DRAFT',
        entityType: 'Checklist',
        entityId: 'cl3',
      }),
    )
  })
})
