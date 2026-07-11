/**
 * Session 2 (CODE_REVIEW.md 4.6) — rejectChecklist()'s writes (checklist ->
 * REJECTED, then the draft upsert that carries the auditor's feedback forward)
 * must be atomic: a failure on the draft upsert must not leave the checklist
 * marked REJECTED with no draft for the auditor to resubmit from.
 *
 * Same testing strategy as approve-checklist-transaction.spec.ts: with a mocked
 * PrismaService, a real DB's automatic rollback-on-throw isn't observable, so
 * these tests verify (a) every write is routed through the tx-scoped client,
 * never the root client, and (b) a thrown error inside the callback propagates
 * out of rejectChecklist() rather than being swallowed.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

describe('StationsService.rejectChecklist — transaction atomicity', () => {
  let service: StationsService
  const findFirst = jest.fn()        // outer prisma.checklist.findFirst
  const checklistUpdate = jest.fn()  // root client — must NEVER be called
  const checklistCreate = jest.fn()  // root client — must NEVER be called
  const txFindFirst = jest.fn()      // tx.checklist.findFirst — both the in-tx status
                                      // re-check AND the draft lookup use this mock;
                                      // tests key on call order via mockResolvedValueOnce.
  const txChecklistUpdate = jest.fn()
  const txChecklistCreate = jest.fn()
  const auditLog = jest.fn()
  const transactionMock = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      checklist: { findFirst: txFindFirst, update: txChecklistUpdate, create: txChecklistCreate },
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
            checklist: { findFirst, update: checklistUpdate, create: checklistCreate },
            $transaction: transactionMock,
          },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()

    service = moduleRef.get(StationsService)
  })

  const submittedChecklist = {
    id: 'cl1', stationId: 's1', auditorId: 'auditor-1', status: 'SUBMITTED', items: [],
  }
  const rejectedChecklist = {
    id: 'cl1', stationId: 's1', auditorId: 'auditor-1', status: 'REJECTED', items: [],
  }

  it('rejects when the checklist is not SUBMITTED (400) without opening a transaction', async () => {
    findFirst.mockResolvedValue({ ...submittedChecklist, status: 'DRAFT' })

    await expect(service.rejectChecklist('s1', 'cl1', 'แก้ไข')).rejects.toThrow(BadRequestException)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects when the checklist does not belong to the station (404) without opening a transaction', async () => {
    findFirst.mockResolvedValue(null)

    await expect(service.rejectChecklist('s1', 'cl1', 'แก้ไข')).rejects.toThrow(NotFoundException)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('mirrors the SUBMITTED precondition inside the transaction — rejects a concurrent status change between the outer read and the tx', async () => {
    findFirst.mockResolvedValue(submittedChecklist)
    // Inside the transaction, the status has already moved on (e.g. another admin approved it).
    txFindFirst.mockResolvedValueOnce({ ...submittedChecklist, status: 'APPROVED' })

    await expect(service.rejectChecklist('s1', 'cl1', 'แก้ไข')).rejects.toThrow(BadRequestException)
    expect(txChecklistUpdate).not.toHaveBeenCalled()
    expect(txChecklistCreate).not.toHaveBeenCalled()
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(checklistCreate).not.toHaveBeenCalled()
  })

  it('propagates a failure creating the draft (no existing draft) — the REJECTED write does not stand alone', async () => {
    findFirst.mockResolvedValue(submittedChecklist)
    txFindFirst
      .mockResolvedValueOnce(submittedChecklist) // in-tx status re-check
      .mockResolvedValueOnce(null)               // draft lookup: no existing draft
    txChecklistUpdate.mockResolvedValue(rejectedChecklist) // REJECTED write "succeeds"
    txChecklistCreate.mockRejectedValue(new Error('db unavailable')) // draft create fails

    await expect(service.rejectChecklist('s1', 'cl1', 'แก้ไข')).rejects.toThrow('db unavailable')

    // No write ever escaped to the root client — under a real DB the REJECTED
    // write above is rolled back along with the failed draft create.
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(checklistCreate).not.toHaveBeenCalled()
  })

  it('propagates a failure updating an existing draft — the REJECTED write does not stand alone', async () => {
    findFirst.mockResolvedValue(submittedChecklist)
    const existingDraft = { id: 'draft-1', stationId: 's1', auditorId: 'auditor-1', status: 'DRAFT' }
    txFindFirst
      .mockResolvedValueOnce(submittedChecklist) // in-tx status re-check
      .mockResolvedValueOnce(existingDraft)      // draft lookup: existing draft found
    txChecklistUpdate
      .mockResolvedValueOnce(rejectedChecklist)      // REJECTED write "succeeds"
      .mockRejectedValueOnce(new Error('db unavailable')) // draft update fails

    await expect(service.rejectChecklist('s1', 'cl1', 'แก้ไข')).rejects.toThrow('db unavailable')

    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(checklistCreate).not.toHaveBeenCalled()
  })

  it('rejects a SUBMITTED checklist and creates a fresh draft — all writes go through the tx client', async () => {
    findFirst.mockResolvedValue(submittedChecklist)
    txFindFirst
      .mockResolvedValueOnce(submittedChecklist)
      .mockResolvedValueOnce(null)
    txChecklistUpdate.mockResolvedValue(rejectedChecklist)
    txChecklistCreate.mockResolvedValue({ id: 'draft-2', status: 'DRAFT' })

    const result = await service.rejectChecklist('s1', 'cl1', 'แก้ไข')

    expect(result.status).toBe('REJECTED')
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(txChecklistUpdate).toHaveBeenCalledTimes(1)
    expect(txChecklistCreate).toHaveBeenCalledTimes(1)
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(checklistCreate).not.toHaveBeenCalled()
  })
})
