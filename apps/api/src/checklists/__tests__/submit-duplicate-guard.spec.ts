/**
 * Session 2 (CODE_REVIEW.md 4.8, interim stopgap) — a double-tap on "ส่งรายงาน"
 * currently creates two SUBMITTED checklist rows for the same station/auditor.
 * This is a plain read-then-write guard, NOT a real uniqueness guarantee — the
 * real fix is the partial unique index landing with the E-form redesign.
 *
 * TODO(eform-redesign): remove when partial unique index lands (4.8)
 */

import { ConflictException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'

describe('ChecklistsService.submit — interim double-submit guard (4.8 stopgap)', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const distanceToStationMeters = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { create: checklistCreate, findFirst: checklistFindFirst },
          },
        },
        { provide: StationsService, useValue: { findOne, distanceToStationMeters } },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()

    service = moduleRef.get(ChecklistsService)
  })

  it('rejects a second submit within the dedupe window (409) without creating a new row', async () => {
    findOne.mockResolvedValue({ id: 's1', coordStatus: 'APPROXIMATE' })
    checklistFindFirst.mockResolvedValue({ id: 'cl-existing', status: 'SUBMITTED', submittedAt: new Date() })

    await expect(service.submit('s1', 'u1', [])).rejects.toThrow(ConflictException)
    expect(checklistCreate).not.toHaveBeenCalled()
  })

  it('allows submit when no recent duplicate exists', async () => {
    findOne.mockResolvedValue({ id: 's1', coordStatus: 'APPROXIMATE' })
    checklistFindFirst.mockResolvedValue(null)
    checklistCreate.mockResolvedValue({ id: 'cl1', stationId: 's1', auditorId: 'u1', status: 'SUBMITTED' })

    const result = await service.submit('s1', 'u1', [])

    expect(result.status).toBe('SUBMITTED')
    expect(checklistCreate).toHaveBeenCalledTimes(1)
  })

  it('scopes the duplicate check to this station + auditor + SUBMITTED status within the window', async () => {
    findOne.mockResolvedValue({ id: 's1', coordStatus: 'APPROXIMATE' })
    checklistFindFirst.mockResolvedValue(null)
    checklistCreate.mockResolvedValue({ id: 'cl1', stationId: 's1', auditorId: 'u1', status: 'SUBMITTED' })

    await service.submit('s1', 'u1', [])

    const whereArg = checklistFindFirst.mock.calls[0][0].where as {
      stationId: string; auditorId: string; status: string; submittedAt: { gte: Date }
    }
    expect(whereArg.stationId).toBe('s1')
    expect(whereArg.auditorId).toBe('u1')
    expect(whereArg.status).toBe('SUBMITTED')
    expect(whereArg.submittedAt.gte).toBeInstanceOf(Date)
  })
})
