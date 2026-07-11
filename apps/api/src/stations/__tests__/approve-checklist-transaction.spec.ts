/**
 * Session 2 (CODE_REVIEW.md 4.2, transaction half) — approveChecklist()'s three
 * writes (checklist status -> APPROVED, checklist.score, station.score/status)
 * must be atomic: a failure partway through must not leave the checklist flipped
 * to APPROVED while the station score is stale.
 *
 * Under a real database, prisma.$transaction(async tx => {...}) rolls back every
 * write in the callback automatically the moment the callback throws — that's
 * Prisma's guarantee, not something a unit test can re-verify without a live DB.
 * What these tests DO verify, with a mocked PrismaService: every write is routed
 * through the tx-scoped client (never the root client), and a thrown error inside
 * the callback propagates out of approveChecklist() rather than being swallowed —
 * i.e. the code asks Prisma for atomicity correctly.
 */

import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

describe('StationsService.approveChecklist — transaction atomicity', () => {
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

  it('propagates a failure on the station update — the checklist status write does not stand alone', async () => {
    const submittedAt = new Date()
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'SUBMITTED', items: [], submittedAt })
    txFindFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'SUBMITTED', items: [], submittedAt })
    txChecklistUpdate
      .mockResolvedValueOnce({ id: 'cl1', status: 'APPROVED', items: [], submittedAt }) // status write "succeeds"
      .mockResolvedValueOnce({}) // score write
    txStationUpdate.mockRejectedValue(new Error('db unavailable'))

    await expect(service.approveChecklist('s1', 'cl1')).rejects.toThrow('db unavailable')

    // The failure happened inside the $transaction callback — under a real DB this
    // means the checklist's status/score writes above are rolled back too, even
    // though the mocks recorded them as "called". No write ever escaped to the
    // root client, which is the property this test can actually assert.
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the checklist was approved by someone else between the outer read and the transaction (409-equivalent, no writes)', async () => {
    // Outer guard read (StationsController -> approveChecklist's pre-tx check) still
    // sees SUBMITTED — the race window is between that read and the transaction start.
    findFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'SUBMITTED', items: [] })
    // Inside the transaction, a concurrent approve already landed.
    txFindFirst.mockResolvedValue({ id: 'cl1', stationId: 's1', status: 'APPROVED', items: [] })

    await expect(service.approveChecklist('s1', 'cl1')).rejects.toThrow(BadRequestException)

    expect(txChecklistUpdate).not.toHaveBeenCalled()
    expect(txStationUpdate).not.toHaveBeenCalled()
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(stationUpdate).not.toHaveBeenCalled()
  })
})
