/**
 * Regression test — approveChecklist() must only transition a SUBMITTED
 * checklist to APPROVED. Without a status guard, a DRAFT can be "approved"
 * (a checklist the auditor never submitted) and an already-APPROVED
 * checklist can be re-approved (re-running the score/station-status write
 * for no reason). Both should be rejected with 400.
 */

import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

describe('StationsService.approveChecklist — status guard', () => {
  let service: StationsService
  const findFirst = jest.fn()
  const checklistUpdate = jest.fn()
  const stationUpdate = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { findFirst, update: checklistUpdate },
            station: { update: stationUpdate },
          },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()

    service = moduleRef.get(StationsService)
  })

  it('rejects approving a DRAFT checklist (400) without writing anything', async () => {
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'DRAFT', items: [] })

    await expect(service.approveChecklist('s1', 'cl1')).rejects.toThrow(BadRequestException)
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('rejects re-approving an already-APPROVED checklist (400) without writing anything', async () => {
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'APPROVED', items: [] })

    await expect(service.approveChecklist('s1', 'cl1')).rejects.toThrow(BadRequestException)
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('approves a SUBMITTED checklist', async () => {
    const submittedAt = new Date()
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'SUBMITTED', items: [], submittedAt })
    checklistUpdate
      .mockResolvedValueOnce({ id: 'cl1', status: 'APPROVED', items: [], submittedAt })
      .mockResolvedValueOnce({})
    stationUpdate.mockResolvedValue({})

    const result = await service.approveChecklist('s1', 'cl1')

    expect(result.status).toBe('APPROVED')
    expect(checklistUpdate).toHaveBeenCalledTimes(2)
    expect(stationUpdate).toHaveBeenCalledTimes(1)
  })
})
