/**
 * UDT-55 — revertApproval() undoes an accidental approval: APPROVED -> SUBMITTED (back into
 * the pending-review queue) and recomputes the station's denormalized score/status/lastInspected
 * from the previous latest-approved checklist, or resets them to the schema defaults when this
 * was the only approved checklist.
 *
 * Same shape as approve-checklist-transaction.spec.ts: a mocked PrismaService proves every write
 * is routed through the tx-scoped client and the status precondition is enforced (inside the tx
 * too, closing the race). The real rollback guarantee is Prisma's, not something a unit test can
 * re-verify without a live DB.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

describe('StationsService.revertApproval', () => {
  let service: StationsService
  const findFirst = jest.fn()
  const checklistUpdate = jest.fn()  // root client — must NEVER be called
  const stationUpdate = jest.fn()    // root client — must NEVER be called
  const txFindFirst = jest.fn()
  const txChecklistUpdate = jest.fn()
  const txStationUpdate = jest.fn()
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

  it('flips APPROVED -> SUBMITTED and recomputes the station denorm from the previous approved checklist', async () => {
    const prevSubmittedAt = new Date('2026-01-01T00:00:00Z')
    findFirst.mockResolvedValue({ id: 'cl2', stationId: 's1', status: 'APPROVED', items: [] })
    txFindFirst
      .mockResolvedValueOnce({ id: 'cl2', stationId: 's1', status: 'APPROVED', items: [] }) // in-tx status re-check
      .mockResolvedValueOnce({ id: 'cl1', stationId: 's1', status: 'APPROVED', items: [], submittedAt: prevSubmittedAt }) // previous approved
    txChecklistUpdate.mockResolvedValue({ id: 'cl2', status: 'SUBMITTED', score: null })

    await service.revertApproval('s1', 'cl2')

    // Checklist returned to the queue with its on-approve score dropped.
    expect(txChecklistUpdate).toHaveBeenCalledWith({
      where: { id: 'cl2', stationId: 's1' },
      data: { status: 'SUBMITTED', score: null },
    })
    // Station denorm falls back to the previous approved checklist's date.
    expect(txStationUpdate).toHaveBeenCalledTimes(1)
    const stationArg = txStationUpdate.mock.calls[0][0]
    expect(stationArg.where).toEqual({ id: 's1' })
    expect(stationArg.data.lastInspected).toBe(prevSubmittedAt)
    expect(stationArg.data).toHaveProperty('score')
    expect(stationArg.data).toHaveProperty('status')
    // Nothing escaped to the root client.
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('resets the station to schema defaults when no other approved checklist remains', async () => {
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'APPROVED', items: [] })
    txFindFirst
      .mockResolvedValueOnce({ id: 'cl1', stationId: 's1', status: 'APPROVED', items: [] }) // in-tx status re-check
      .mockResolvedValueOnce(null) // no previous approved checklist
    txChecklistUpdate.mockResolvedValue({ id: 'cl1', status: 'SUBMITTED', score: null })

    await service.revertApproval('s1', 'cl1')

    expect(txStationUpdate).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { score: 0, status: 'ต้องปรับปรุง', lastInspected: null },
    })
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('rejects a checklist that is not APPROVED (nothing to revert)', async () => {
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'SUBMITTED', items: [] })

    await expect(service.revertApproval('s1', 'cl1')).rejects.toThrow(BadRequestException)

    expect(transactionMock).not.toHaveBeenCalled()
    expect(txChecklistUpdate).not.toHaveBeenCalled()
    expect(txStationUpdate).not.toHaveBeenCalled()
  })

  it('404s when the checklist does not belong to the station (BOLA scope)', async () => {
    findFirst.mockResolvedValue(null)

    await expect(service.revertApproval('s1', 'nope')).rejects.toThrow(NotFoundException)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects when the approval was already reverted between the outer read and the transaction (no writes)', async () => {
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'APPROVED', items: [] })
    // Inside the tx, a concurrent revert already sent it back to SUBMITTED.
    txFindFirst.mockResolvedValueOnce({ id: 'cl1', stationId: 's1', status: 'SUBMITTED', items: [] })

    await expect(service.revertApproval('s1', 'cl1')).rejects.toThrow(BadRequestException)

    expect(txChecklistUpdate).not.toHaveBeenCalled()
    expect(txStationUpdate).not.toHaveBeenCalled()
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(stationUpdate).not.toHaveBeenCalled()
  })
})
