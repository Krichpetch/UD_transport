/**
 * Regression test — approveChecklist() must only transition a SUBMITTED
 * checklist to APPROVED. Without a status guard, a DRAFT can be "approved"
 * (a checklist the auditor never submitted) and an already-APPROVED
 * checklist can be re-approved (re-running the score/station-status write
 * for no reason). Both should be rejected with 400.
 *
 * Session 2: the actual writes now run inside prisma.$transaction — every
 * assertion below routes through the tx-scoped mocks (txChecklistUpdate /
 * txStationUpdate), and the root-client mocks (checklistUpdate / stationUpdate)
 * must never be called directly, proving no write escapes the transaction.
 */

import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

describe('StationsService.approveChecklist — status guard', () => {
  let service: StationsService
  const findFirst = jest.fn()          // outer prisma.checklist.findFirst (pre-tx guard read)
  const checklistUpdate = jest.fn()    // root client — must NEVER be called
  const stationUpdate = jest.fn()      // root client — must NEVER be called
  const txFindFirst = jest.fn()        // tx.checklist.findFirst (in-tx re-check)
  const txChecklistUpdate = jest.fn()  // tx.checklist.update
  const txStationUpdate = jest.fn()    // tx.station.update
  const auditLog = jest.fn()
  const transactionMock = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      checklist: { findFirst: txFindFirst, update: txChecklistUpdate },
      station: { update: txStationUpdate },
    }),
  )

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
            $transaction: transactionMock,
          },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()

    service = moduleRef.get(StationsService)
  })

  it('rejects approving a DRAFT checklist (400) without writing anything or opening a transaction', async () => {
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'DRAFT', items: [] })

    await expect(service.approveChecklist('s1', 'cl1')).rejects.toThrow(BadRequestException)
    expect(transactionMock).not.toHaveBeenCalled()
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('rejects re-approving an already-APPROVED checklist (400) without writing anything or opening a transaction', async () => {
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'APPROVED', items: [] })

    await expect(service.approveChecklist('s1', 'cl1')).rejects.toThrow(BadRequestException)
    expect(transactionMock).not.toHaveBeenCalled()
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('approves a SUBMITTED checklist — all writes go through the tx client', async () => {
    const submittedAt = new Date()
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'SUBMITTED', items: [], submittedAt })
    txFindFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'SUBMITTED', items: [], submittedAt })
    txChecklistUpdate
      .mockResolvedValueOnce({ id: 'cl1', status: 'APPROVED', items: [], submittedAt })
      .mockResolvedValueOnce({})
    txStationUpdate.mockResolvedValue({})

    const result = await service.approveChecklist('s1', 'cl1')

    expect(result.status).toBe('APPROVED')
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(txChecklistUpdate).toHaveBeenCalledTimes(2)
    expect(txStationUpdate).toHaveBeenCalledTimes(1)
    // No write ever bypasses the transaction and hits the root client directly.
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(stationUpdate).not.toHaveBeenCalled()
  })
})
